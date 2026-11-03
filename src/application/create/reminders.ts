import { harnessLabel } from '#domain/harnesses';

import type { ResolvedInputs } from '#application/input/types';
import type { ApplicationDependencies } from '#application/ports/dependencies';

import type { CreatePreflight } from './context';

/**
 * distinguishes verified caller checks from readiness requiring the new guest
 * @param dependencies the registered drivers
 * @param input resolved selections without serializing their credentials
 * @returns non-secret checks and actionable reminders
 */
export function createPreflightSummary(
  dependencies: Pick<ApplicationDependencies, 'registry'>,
  input: ResolvedInputs,
): CreatePreflight {
  const { profile } = input;
  const provider =
    dependencies.registry.providers[profile.provider].displayName;

  return {
    checks: [
      'Required inputs',
      `${provider} prerequisites, authentication and target-name availability`,
    ],
    reminders: [
      `${profile.harnesses.map((id) => harnessLabel(id)).join(' and ')} use native sign-in; configure their credentials on the guest before model work.`,
    ],
  };
}
