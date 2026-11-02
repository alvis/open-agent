import {
  agentChoices,
  defaultHarnesses,
  harnessChoices,
  networkChoices,
  providerChoices,
} from './selection/choices';
import { resolveOptions } from './selection/options';
import { activePrompts } from './selection/sources';
import { readSelection } from './selection/supplied';

import type { SetupSection } from '#application/contracts';
import type { ApplicationDependencies } from '#application/ports/dependencies';
import type { ProfileCandidate, WorkstationProfile } from '#domain/profile';
import type { SelectionField } from '#domain/selection-inputs';

import type { Prompts, Resolved, SelectionContext } from './selection/sources';
import type { SuppliedSelection } from './selection/supplied';

/** what an existing workstation's setup run reads before reaching the workstation */
interface SetupReadContext extends Omit<SelectionContext, 'interaction'> {
  /** setup area the run targets */
  section: SetupSection;
}

/** what an existing workstation's setup run may change */
interface SetupSelectionContext extends SelectionContext {
  /** the profile the workstation recorded */
  recorded: WorkstationProfile;
  /** setup area the run targets */
  section: SetupSection;
  /** values the run's flags and section-scoped environment supply */
  supplied: SuppliedSelection;
}

/** a resolved, not yet validated selection */
export interface SelectionResolution {
  /** selection to validate against the catalog */
  candidate: ProfileCandidate;
  /** environment values that could not be read */
  problems: readonly string[];
  /** whether the caller supplied the idle timeout rather than taking the default */
  isIdleTimeoutRequested: boolean;
}

/** every field a new workstation's selection reads */
const CREATE_FIELDS: readonly SelectionField[] = [
  'provider',
  'agent',
  'harnesses',
  'network',
  'idleTimeoutMinutes',
  'holdMaxMinutes',
];

/** the fields each setup section reads and saves; every other field keeps its recorded value */
const SECTION_FIELDS: Readonly<
  Partial<Record<SetupSection, readonly SelectionField[]>>
> = {
  all: ['harnesses', 'network', 'idleTimeoutMinutes', 'holdMaxMinutes'],
  network: ['network'],
};

/**
 * lists the profile fields a setup section reads and saves
 * @param section setup area the run targets
 * @returns the owned fields; empty when the section leaves the profile unchanged
 */
export function sectionFields(
  section: SetupSection,
): readonly SelectionField[] {
  return SECTION_FIELDS[section] ?? [];
}

/** the named inputs of resolveCreateNetwork */
interface CreateNetworkParams {
  /** network named by a flag or the environment */
  supplied: string | undefined;
  /** active prompts, absent when none may be asked */
  prompts: Prompts | undefined;
}

/**
 * resolves the network of a new workstation: the supplied value, a prompt,
 * then the default
 * @param dependencies the registered drivers, the profile defaults
 * @param params the call's inputs: supplied, prompts
 * @returns the selected network
 */
async function resolveCreateNetwork(
  dependencies: Pick<ApplicationDependencies, 'registry' | 'defaults'>,
  params: CreateNetworkParams,
): Promise<string> {
  const { supplied, prompts } = params;

  return (
    supplied ??
    (await prompts?.choose('Network', networkChoices(dependencies))) ??
    dependencies.defaults.selection.network
  );
}

/**
 * reads the values a create run supplies
 * @param dependencies the registered drivers, which declare the selection inputs
 * @param context flags and sources
 * @returns the supplied values and every unreadable environment value
 */
function readCreateSelection(
  dependencies: Pick<ApplicationDependencies, 'registry'>,
  context: Omit<SelectionContext, 'interaction'>,
): Resolved<SuppliedSelection> {
  return readSelection(dependencies, context, CREATE_FIELDS);
}

/**
 * resolves a new workstation's selection in dependency order: provider, ACP
 * agent, harnesses the agent supports, network, then the options the selected
 * drivers support; each step takes the flag, the environment, the selected
 * credential file, a prompt, then the default, and a step with one choice is skipped;
 * every supplied value is read before the first prompt, and an unreadable one
 * suppresses prompting so it is reported at once
 * @param dependencies the registered drivers, the profile defaults
 * @param context flags, sources and optional prompts
 * @returns the selection and every unreadable environment value
 */
export async function resolveCreateSelection(
  dependencies: Pick<ApplicationDependencies, 'registry' | 'defaults'>,
  context: SelectionContext,
): Promise<SelectionResolution> {
  const { value: supplied, problems } = readCreateSelection(
    dependencies,
    context,
  );
  const prompts = problems.length === 0 ? activePrompts(context) : undefined;
  const provider =
    supplied.provider ??
    (await prompts?.choose('Provider', providerChoices(dependencies))) ??
    dependencies.defaults.selection.provider;
  const agent =
    supplied.agent ??
    (await prompts?.choose('ACP agent', agentChoices(dependencies))) ??
    dependencies.defaults.selection.agent;
  const harnesses =
    supplied.harnesses ??
    (await prompts?.chooseMany(
      'Harnesses',
      harnessChoices(dependencies, agent),
    )) ??
    defaultHarnesses(dependencies, agent);
  const network = await resolveCreateNetwork(dependencies, {
    supplied: supplied.network,
    prompts,
  });

  return {
    candidate: {
      provider,
      agent,
      harnesses,
      network,
      options: await resolveOptions(dependencies, {
        selected: { provider, agent },
        supplied: supplied.options,
        fields: CREATE_FIELDS,
        prompts,
        base: dependencies.defaults.options,
      }),
    },
    problems,
    isIdleTimeoutRequested: supplied.options.idleTimeoutMinutes !== undefined,
  };
}

/**
 * reads the values a setup run supplies, without the recorded profile: the
 * provider and agent only from flags so a mismatch can be refused, and every
 * other field only when the targeted section owns it
 * @param dependencies the registered drivers, which declare the selection inputs
 * @param context flags, sources and targeted section
 * @returns the supplied values and every unreadable environment value
 */
export function readSetupSelection(
  dependencies: Pick<ApplicationDependencies, 'registry'>,
  context: SetupReadContext,
): Resolved<SuppliedSelection> {
  return readSelection(dependencies, context, sectionFields(context.section));
}

/**
 * merges a setup run's supplied values with the workstation's recorded
 * profile; only the fields the targeted section owns may change, and prompts
 * run only when every section is targeted
 * @param dependencies the registered drivers, the profile defaults
 * @param context recorded profile, targeted section, supplied values and prompts
 * @returns the selection to validate
 */
export async function resolveSetupSelection(
  dependencies: Pick<ApplicationDependencies, 'registry' | 'defaults'>,
  context: SetupSelectionContext,
): Promise<SelectionResolution> {
  const { recorded, section, supplied } = context;
  const prompts = section === 'all' ? activePrompts(context) : undefined;
  const harnesses =
    supplied.harnesses ??
    (await prompts?.chooseMany(
      'Harnesses',
      harnessChoices(dependencies, recorded.agent, recorded.harnesses),
    )) ??
    recorded.harnesses;
  const network = await resolveSetupNetwork(dependencies, context, prompts);

  return {
    candidate: {
      provider: supplied.provider ?? recorded.provider,
      agent: supplied.agent ?? recorded.agent,
      harnesses,
      network,
      options: await resolveOptions(dependencies, {
        selected: {
          provider: recorded.provider,
          agent: recorded.agent,
        },
        supplied: supplied.options,
        fields: sectionFields(section),
        prompts,
        base: recorded.options,
      }),
    },
    problems: [],
    isIdleTimeoutRequested: supplied.options.idleTimeoutMinutes !== undefined,
  };
}

/**
 * resolves the network a setup run applies
 * @param dependencies the registered drivers
 * @param context recorded profile, targeted section and supplied values
 * @param prompts prompts when the run targets every section
 * @returns the network id, validated later against the catalog
 */
async function resolveSetupNetwork(
  dependencies: Pick<ApplicationDependencies, 'registry'>,
  context: SetupSelectionContext,
  prompts: Prompts | undefined,
): Promise<string> {
  const { recorded, supplied } = context;

  return (
    supplied.network ??
    (await prompts?.choose('Network', networkChoices(dependencies))) ??
    recorded.network
  );
}
