import { harnessLabel } from '#domain/harnesses';
import { publishStatus } from '#kernel/operation';

import type { CommandRequest } from '#application/contracts';
import type { ResolvedInputs } from '#application/input/types';
import type { ApplicationDependencies } from '#application/ports/dependencies';
import type { Interaction } from '#application/ports/interaction';
import type { WorkstationProfile } from '#domain/profile';

import type { CreatePreflight } from './context';

/** values every create run must have once inputs are resolved */
export interface RequiredCreateValues {
  name: string;
  token: string;
}

/** verified inputs and selections a create run presents for review */
export interface ReviewContext {
  values: RequiredCreateValues;
  input: ResolvedInputs;
  interaction?: Interaction;
  preflight: CreatePreflight;
}

/** what the creation confirmation names */
interface ConfirmationContext {
  name: string;
  request: CommandRequest;
  profile: WorkstationProfile;
}

/**
 * presents non-secret values for review
 * @param dependencies the registered drivers
 * @param context required create values and optional status reporter
 */
export function reviewCreatePlan(
  dependencies: Pick<ApplicationDependencies, 'registry'>,
  context: ReviewContext,
): void {
  const { values, input, interaction, preflight } = context;
  const { profile } = input;
  const provider = dependencies.registry.providers[profile.provider];
  const { credential } = provider.prerequisites;
  publishStatus(
    {
      kind: 'info',
      message: [
        `Create ${values.name} on ${provider.displayName}`,
        ...releaseSummary(dependencies, profile),
        `Harnesses: ${profile.harnesses.map((id) => harnessLabel(id)).join(', ')}`,
        'No private network',
        `Suspend after idle: ${idleSummary(profile.options.idleTimeoutMinutes)}`,
        `${dependencies.registry.agents[profile.agent].displayName} exposed after readiness`,
        `${credential.label}: ${input.sources[credential.environment] ?? 'prompt/session'}`,
      ].join('\n'),
    },
    interaction,
  );
  for (const message of preflight.reminders) {
    publishStatus({ kind: 'warning', message }, interaction);
  }
}

/**
 * confirms provider provisioning
 * @param dependencies the registered drivers
 * @param context exact name and parsed consent flags
 * @param interaction optional confirmation prompts
 * @returns cancellation reason when a confirmation was declined
 */
export async function confirmCreation(
  dependencies: Pick<ApplicationDependencies, 'registry'>,
  context: ConfirmationContext,
  interaction?: Interaction,
): Promise<string | undefined> {
  const { name, request, profile } = context;
  if (interaction && !request.options.nonInteractive && !request.options.yes) {
    const accepted = await interaction.confirm({
      message: `Create ${name} on ${dependencies.registry.providers[profile.provider].displayName} and expose authenticated ${dependencies.registry.agents[profile.agent].displayName} at its provider URL?`,
    });
    if (!accepted) {
      return 'Create was cancelled before provisioning';
    }
  }

  return undefined;
}

/**
 * names the release channel the agent follows
 * @param dependencies the registered drivers
 * @param profile validated selection
 * @returns one review line, none when the agent declares no channels
 */
function releaseSummary(
  dependencies: Pick<ApplicationDependencies, 'registry'>,
  profile: WorkstationProfile,
): string[] {
  const { agentRelease } = profile.options;

  return agentRelease === undefined
    ? []
    : [
        `${dependencies.registry.agents[profile.agent].displayName} release: ${agentRelease}`,
      ];
}

/**
 * describes the idle suspension the profile records
 * @param minutes minutes before suspension, 0 for never
 * @returns review text
 */
function idleSummary(minutes: number): string {
  return minutes ? `${minutes} minutes` : 'never';
}
