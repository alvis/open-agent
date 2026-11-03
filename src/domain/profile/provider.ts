import { selectionLabel } from '#domain/selection-inputs';

import type { ProductDeclarations } from '#domain/declarations';
import type { ProviderId } from '#domain/ids';

import type {
  ProfileField,
  ProfileOptions,
  ProfileValidationOptions,
  ProfileViolation,
} from '../profile';

/** provider capabilities and requested values to validate */
export interface ProviderViolationsParams {
  declarations: ProductDeclarations;
  selected: { provider: ProviderId; options: ProfileOptions };
  options: ProfileValidationOptions;
}

/**
 * checks the requests only a provider's declared capabilities allow
 * @param params known provider, requested values and validation requests
 * @param params.declarations the data every registered driver declares
 * @param params.selected provider is the known provider id; options are the requested option values
 * @param params.options requests validated alongside the profile
 * @returns violations the selected provider's declarations raise
 */
export function providerViolations({
  declarations,
  selected,
  options,
}: ProviderViolationsParams): ProfileViolation[] {
  const { provider, options: candidateOptions } = selected;
  const { keepAwakeMode, maxAwakeDeadlineMinutes } =
    declarations.providers[provider].capabilities;

  return [
    ...(options.isIdleTimeoutRequested && keepAwakeMode === 'none'
      ? [
          {
            code: 'undeclared-capability' as const,
            message: `${selectionLabel('idleTimeoutMinutes')} needs a provider that keeps workstations awake; "${provider}" does not`,
            fields: ['provider', 'idleTimeoutMinutes'] as ProfileField[],
          },
        ]
      : []),
    ...(maxAwakeDeadlineMinutes === null
      ? []
      : (['idleTimeoutMinutes', 'holdMaxMinutes'] as const)
          .filter((key) => candidateOptions[key] > maxAwakeDeadlineMinutes)
          .map((key) => ({
            code: 'undeclared-capability' as const,
            message: `${selectionLabel(key)} of ${String(candidateOptions[key])} minutes is more than provider "${provider}" can keep a workstation awake: at most ${String(maxAwakeDeadlineMinutes)} minutes`,
            fields: ['provider', key] as ProfileField[],
          }))),
  ];
}
