import type { DriverRegistry, NetworkDriver } from '#application/ports/drivers';
import type { NetworkId } from '#domain/ids';

/** a registered network driver, whatever it declares */
export type RegisteredNetwork = NetworkDriver<NetworkId>;

/**
 * resolves the driver of a selected network
 * @param registry every registered driver
 * @param id selected network
 * @returns the network driver, whose declared facts say what the network installs, takes and runs
 */
export function networkDriver(
  registry: Pick<DriverRegistry, 'networks'>,
  id: NetworkId,
): RegisteredNetwork {
  return registry.networks[id];
}
