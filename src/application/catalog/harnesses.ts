import type { DriverRegistry } from '#application/ports/drivers';
import type { GuestChannel } from '#application/ports/guest-channel';
import type { HarnessId } from '#domain/ids';

/** every registered harness driver */
export type AnyHarnessDriver = DriverRegistry['harnesses'][HarnessId];

/** harnesses to configure */
interface ConfigureHarnessesParams {
  drivers: readonly AnyHarnessDriver[];
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
 * merges native configuration for each selected harness in turn
 * @param guest guest channel
 * @param params selected harness drivers
 * @param params.drivers selected harness drivers
 */
export async function configureHarnesses(
  guest: GuestChannel,
  params: ConfigureHarnessesParams,
): Promise<void> {
  for (const driver of params.drivers) {
    await driver.configure(guest);
  }
}
