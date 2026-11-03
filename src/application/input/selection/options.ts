import { isDriverId } from '#domain/profile';

import type { ApplicationDependencies } from '#application/ports/dependencies';
import type { ProfileOptions } from '#domain/profile';
import type { SelectionField } from '#domain/selection-inputs';

import type { Prompts } from './sources';
import type { SuppliedSelection } from './supplied';

/** facts the option steps depend on */
interface OptionContext {
  /** drivers already selected */
  selected: {
    provider: string;
    agent: string;
  };
  /** options the caller supplied */
  supplied: SuppliedSelection['options'];
  /** fields the run owns; every other option keeps its base value */
  fields: readonly SelectionField[];
  prompts?: Prompts;
  /** recorded options for setup, default options for a new workstation */
  base: ProfileOptions;
}

/**
 * resolves the capability-driven options the run owns: idle minutes only when the provider keeps workstations awake; hold-max
 * and the update due interval are never asked
 * @param dependencies the registered drivers
 * @param context selected drivers, supplied values, prompts and base options
 * @returns the profile options
 */
export async function resolveOptions(
  dependencies: Pick<ApplicationDependencies, 'registry'>,
  context: OptionContext,
): Promise<ProfileOptions> {
  const { base, fields, supplied } = context;

  return {
    ...base,
    idleTimeoutMinutes: fields.includes('idleTimeoutMinutes')
      ? await resolveIdleMinutes(dependencies, context)
      : base.idleTimeoutMinutes,
    holdMaxMinutes: supplied.holdMaxMinutes ?? base.holdMaxMinutes,
    updateDueIntervalDays:
      supplied.updateDueIntervalDays ?? base.updateDueIntervalDays,
  };
}

/**
 * resolves idle minutes, asked only when the provider keeps workstations awake
 * @param dependencies the registered drivers
 * @param context selected drivers, supplied values and prompts
 * @returns minutes before suspension, 0 for never
 */
async function resolveIdleMinutes(
  dependencies: Pick<ApplicationDependencies, 'registry'>,
  context: OptionContext,
): Promise<number> {
  const { selected, supplied, prompts, base } = context;
  if (supplied.idleTimeoutMinutes !== undefined) {
    return supplied.idleTimeoutMinutes;
  }
  const keepsAwake = isDriverId(selected.provider, {
    declarations: dependencies.registry,
    kind: 'providers',
  })
    ? dependencies.registry.providers[selected.provider].capabilities
        .keepAwakeMode !== 'none'
    : false;

  return (
    (keepsAwake
      ? await prompts?.number(
          'Suspend after idle (minutes, 0 = never)',
          base.idleTimeoutMinutes,
        )
      : undefined) ?? base.idleTimeoutMinutes
  );
}
