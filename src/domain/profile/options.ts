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
  /** largest valid value, when the option has one */
  maximum?: number;
  /** unit used in the violation message */
  unit: 'minutes' | 'days';
}

/** option values to validate */
export interface OptionViolationsParams {
  options: ProfileOptions;
}

/** longest update due interval: one year */
export const MAX_UPDATE_DUE_DAYS = 365;

/** whole-number option bounds checked by validation */
export const OPTION_BOUNDS: readonly OptionBound[] = [
  {
    key: 'idleTimeoutMinutes',
    label: selectionLabel('idleTimeoutMinutes'),
    minimum: 0,
    unit: 'minutes',
  },
  {
    key: 'holdMaxMinutes',
    label: selectionLabel('holdMaxMinutes'),
    minimum: 1,
    unit: 'minutes',
  },
  {
    key: 'updateDueIntervalDays',
    label: selectionLabel('updateDueIntervalDays'),
    minimum: 1,
    maximum: MAX_UPDATE_DUE_DAYS,
    unit: 'days',
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
      ({ key, minimum, maximum }) =>
        !Number.isSafeInteger(options[key]) ||
        Number(options[key]) < minimum ||
        Number(options[key]) > (maximum ?? Number.MAX_SAFE_INTEGER),
    ).map(({ key, label, minimum, maximum, unit }) => ({
      code: 'invalid-option' as const,
      message: `${label} must be a whole number of ${unit} ${
        maximum === undefined
          ? `of at least ${String(minimum)}`
          : `from ${String(minimum)} to ${String(maximum)}`
      }`,
      fields: [key],
    })),
  ];
}
