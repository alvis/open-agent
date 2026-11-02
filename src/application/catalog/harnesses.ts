import { harnessIds } from '#domain/harnesses';
import { recordOf } from '#kernel/records';

import type {
  AwakeHookCommand,
  DriverRegistry,
} from '#application/ports/drivers';
import type { GuestChannel } from '#application/ports/guest-channel';
import type { HarnessId } from '#domain/ids';

/** every registered harness driver */
export type AnyHarnessDriver = DriverRegistry['harnesses'][HarnessId];

/** harnesses and guest facilities needed to configure them */
interface ConfigureHarnessesParams {
  drivers: readonly AnyHarnessDriver[];
  awakeHook: AwakeHookCommand;
}

/**
 * resolves harness drivers by identifier
 * @param registry every registered driver
 * @param ids selected harness identifiers
 * @returns the selected drivers in the given order
 */
export function harnessDrivers(
  registry: Pick<DriverRegistry, 'harnesses'>,
  ids: readonly HarnessId[],
): AnyHarnessDriver[] {
  return ids.map((id) => registry.harnesses[id]);
}

/**
 * builds one value per registered harness, keyed by harness identifier
 * @param registry every registered driver
 * @param build derives the value from a harness driver
 * @returns the values keyed by harness identifier
 */
export function mapHarnesses<Value>(
  registry: Pick<DriverRegistry, 'harnesses'>,
  build: (driver: AnyHarnessDriver) => Value,
): Record<HarnessId, Value> {
  return recordOf(harnessIds(), (id) => build(registry.harnesses[id]));
}

/**
 * merges native configuration and installs work hooks for each selected
 * harness in turn
 * @param guest guest channel
 * @param params selected harness drivers and the command their hooks invoke
 * @param params.drivers selected harness drivers
 * @param params.awakeHook the idle-governor command the work hooks invoke
 */
export async function configureHarnesses(
  guest: GuestChannel,
  params: ConfigureHarnessesParams,
): Promise<void> {
  for (const driver of params.drivers) {
    await driver.configure(guest);
    await driver.hooks.install(guest, params.awakeHook);
  }
}
