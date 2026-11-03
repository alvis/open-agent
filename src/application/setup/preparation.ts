import { requireValidProfile, resolveInputs } from '#application/input';
import { resolveSetupSelection } from '#application/input/selection';
import { CommandFault } from '#kernel/faults';
import { promptUnavailableDetail, traceStage } from '#kernel/operation';

import { persistSetupProfile, profileUpdateSelected } from './integrations';
import {
  assertSameWorkstationKind,
  readSetupEnvironment,
  unrecordedProfile,
} from './recorded';
import { isAgentReleaseChanged } from './release';

import type { CommandOptions, SetupSection } from '#application/contracts';
import type { SuppliedSelection } from '#application/input/selection/supplied';
import type { InputSources } from '#application/input/sources';
import type { ApplicationDependencies } from '#application/ports/dependencies';
import type { ProviderDriver } from '#application/ports/drivers';
import type { GuestChannel } from '#application/ports/guest-channel';
import type { Interaction } from '#application/ports/interaction';
import type { SetupSession } from '#application/ports/session';
import type { WorkstationProfile } from '#domain/profile';
import type { WorkstationRecord } from '#domain/workstation';

import type { SetupContext, SetupProgress } from './context';

/** what a setup run is prepared from */
interface SetupPreparationParams {
  /** authenticated provider driver */
  provider: ProviderDriver;
  /** values the run's flags and section-scoped environment supply, already validated */
  supplied: SuppliedSelection;
  /** sources the supplied values were read from */
  sources: InputSources;
  /** machine the section is applied to */
  workstation: WorkstationRecord;
  /** the root setup session opened to the machine */
  connection: SetupSession;
  /** channel over that session */
  guest: GuestChannel;
  /** targeted setup area */
  section: SetupSection;
  /** parsed setup flags */
  options: CommandOptions;
  /** active prompts, when the run is interactive */
  interaction?: Interaction;
  /** diagnostic state shared with failure reporting */
  mutation: SetupProgress;
}

/** a setup run ready to apply its section */
interface PreparedSetup {
  /** complete setup context for the selected section */
  context: SetupContext;
  /** guest channel to apply the section through */
  guest: GuestChannel;
}

/** setup inputs before a guest channel exists */
type GuestPreparationParams = Omit<
  Parameters<typeof prepareSetupContext>[1],
  'guest'
>;

/** the recorded state of a machine and the setup selection resolved against it */
interface ResolvedSetup {
  /** what the machine records, when it records anything */
  environment: Awaited<ReturnType<typeof readSetupEnvironment>>;
  /** the profile the machine records */
  recorded: WorkstationProfile;
  /** the validated profile this run applies */
  profile: WorkstationProfile;
  /** whether the run writes the profile back */
  persistsProfile: boolean;
  /** whether this run moves the agent's installed release */
  isReleaseChanged: boolean;
  /** the inputs the run needs, resolved */
  input: Awaited<ReturnType<typeof resolveInputs>>;
}

/** the named inputs of resolveSetupInputs */
interface SetupInputsParams {
  /** target, selected section and input choices */
  setup: SetupPreparationParams;
  /** the validated profile this run applies */
  profile: WorkstationProfile;
}

/**
 * opens the root guest channel and prepares the requested setup section
 * @param dependencies application facilities
 * @param params section inputs before a guest channel exists
 * @returns prepared setup context and guest channel
 */
export async function prepareGuestSection(
  dependencies: ApplicationDependencies,
  params: GuestPreparationParams,
): ReturnType<typeof prepareSetupContext> {
  return traceStage({
    stage: 'setup.preparation',
    action: async () =>
      prepareSetupContext(dependencies, {
        ...params,
        guest: await params.connection.guest(),
      }),
  });
}

/**
 * resolves, validates and persists the setup selection before section mutations
 * @param dependencies the registered drivers, the profile defaults, the guest mechanics, what this computer provides
 * @param params target, selected section, input choices, and diagnostic state
 * @returns complete setup context for the selected section and the channel to apply it through
 */
export async function prepareSetupContext(
  dependencies: ApplicationDependencies,
  params: SetupPreparationParams,
): Promise<PreparedSetup> {
  const resolved = await resolveSetup(dependencies, params);
  await persistPreparedProfile(dependencies, {
    resolved,
    guest: params.guest,
    mutation: params.mutation,
  });

  return {
    guest: params.guest,
    context: setupContextOf(params, resolved),
  };
}

/**
 * persists a changed selection only when the guest already records a profile
 * @param dependencies registered drivers and guest profile storage
 * @param params resolved selection, current channel and mutation state
 * @param params.resolved validated selection and previously recorded environment
 * @param params.guest current guest channel
 * @param params.mutation diagnostic mutation state
 */
async function persistPreparedProfile(
  dependencies: Pick<ApplicationDependencies, 'registry' | 'guest'>,
  {
    resolved,
    guest,
    mutation,
  }: {
    resolved: ResolvedSetup;
    guest: GuestChannel;
    mutation: SetupProgress;
  },
): Promise<void> {
  if (resolved.persistsProfile && resolved.environment) {
    await persistSetupProfile(dependencies, {
      guest,
      profile: resolved.profile,
      context: { mutation },
    });
  }
}

/**
 * assembles the context a section is applied with
 * @param params target, selected section, input choices, and diagnostic state
 * @param resolved the recorded state, validated profile and resolved inputs
 * @returns complete setup context for the selected section
 */
function setupContextOf(
  params: SetupPreparationParams,
  resolved: ResolvedSetup,
): SetupContext {
  const { profile, input } = resolved;

  return {
    provider: params.provider,
    workstation: params.workstation,
    connection: params.connection,
    options: params.options,
    interaction: params.interaction,
    input,
    profile,
    persistsProfile: resolved.persistsProfile,
    isReleaseChanged: resolved.isReleaseChanged,
    mutation: params.mutation,
  };
}

/**
 * resolves every input the setup run needs, refusing when any stays unresolved
 * @param dependencies the registered drivers, the profile defaults, what this computer provides
 * @param params the call's inputs: setup, profile
 * @returns the resolved inputs
 */
async function resolveSetupInputs(
  dependencies: Pick<ApplicationDependencies, 'registry' | 'defaults' | 'host'>,
  params: SetupInputsParams,
): Promise<ResolvedSetup['input']> {
  const { setup, profile } = params;
  const { options, interaction, sources } = setup;
  const input = await resolveInputs(dependencies, {
    options,
    interaction,
    requirementSelection: {
      required: [],
      profile,
      sources,
    },
  });
  if (input.missing.length > 0) {
    throw missingSetupInputs(input.missing);
  }

  return input;
}

/**
 * reads what the machine records, then resolves and validates the selection
 * and every input it needs, and tells whether the agent's release moves
 * @param dependencies the registered drivers, the profile defaults, the guest mechanics, what this computer provides
 * @param params target, selected section and input choices
 * @returns the recorded environment and profile, the validated profile, whether the release moves and the resolved inputs
 */
async function resolveSetup(
  dependencies: ApplicationDependencies,
  params: SetupPreparationParams,
): Promise<ResolvedSetup> {
  const { workstation, section, options, interaction, sources } = params;
  const environment = await readSetupEnvironment(
    dependencies,
    params.guest,
    section,
  );
  const recorded =
    environment?.profile ?? unrecordedProfile(dependencies, workstation);
  assertSameWorkstationKind(recorded, params.supplied);
  const profile = requireValidProfile(
    dependencies,
    await resolveSetupSelection(dependencies, {
      options,
      sources,
      interaction,
      recorded,
      section,
      supplied: params.supplied,
    }),
    options,
  );
  const persistsProfile = profileUpdateSelected(section, profile, recorded);
  const input = await resolveSetupInputs(dependencies, {
    setup: params,
    profile,
  });

  return {
    environment,
    recorded,
    profile,
    persistsProfile,
    isReleaseChanged: await isAgentReleaseChanged(dependencies, {
      section,
      connection: params.connection,
      guest: params.guest,
      interaction,
      resolved: { environment, recorded, profile },
    }),
    input,
  };
}

/**
 * reports every unresolved setup input, adding terminal guidance only when an
 * implicit blocker hid a required prompt
 * @param missing one actionable line per unresolved setup input
 * @returns the INPUT fault
 */
export function missingSetupInputs(missing: readonly string[]): CommandFault {
  const promptHint = promptUnavailableDetail();

  return new CommandFault({
    code: 'INPUT',
    message: 'Required setup inputs are missing',
    details: [...missing, ...(promptHint ? [promptHint] : [])],
  });
}
