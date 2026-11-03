import { selectionLabel } from '#domain/selection-inputs';

import type { ProfileOptions, ProfileViolation } from '../profile';

/** a whole-number option's bound */
interface OptionBound {
  /** option key */
  key: keyof ProfileOptions;
  /** how the caller names the option */
  label: string;
  /** smallest valid value */
  minimum: number;
}

/** option values to validate */
export interface OptionViolationsParams {
  options: ProfileOptions;
}

/** whole-number option bounds checked by validation */
export const OPTION_BOUNDS: readonly OptionBound[] = [
  {
    key: 'idleTimeoutMinutes',
    label: selectionLabel('idleTimeoutMinutes'),
    minimum: 0,
  },
  {
    key: 'holdMaxMinutes',
    label: selectionLabel('holdMaxMinutes'),
    minimum: 1,
  },
];

/**
 * checks option bounds
 * @param params options to check
 * @param params.options requested options
 * @returns violations for out-of-bound options
 */
export function optionViolations({
  options,
}: OptionViolationsParams): ProfileViolation[] {
  return [
    ...OPTION_BOUNDS.filter(
      ({ key, minimum }) =>
        !Number.isSafeInteger(options[key]) || Number(options[key]) < minimum,
    ).map(({ key, label, minimum }) => ({
      code: 'invalid-option' as const,
      message: `${label} must be a whole number of minutes of at least ${String(minimum)}`,
      fields: [key],
    })),
  ];
}
