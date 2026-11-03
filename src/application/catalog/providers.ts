import type {
  DriverRegistry,
  ProviderDriver,
} from '#application/ports/drivers';
import type { ProviderId } from '#domain/ids';

/** a provider bound to its management credential */
export interface BoundProvider {
  /** provider identifier */
  id: ProviderId;
  /** provider bound to a credential */
  driver: ProviderDriver;
}

/**
 * binds a provider to its management credential and to the agent services a
 * provider may stop and restore while replacing a service they depend on
 * @param registry every registered driver
 * @param id selected provider identifier
 * @param credential provider management credential kept on this computer
 * @returns the bound provider
 */
export function bindProvider(
  registry: Pick<DriverRegistry, 'agents' | 'providers'>,
  id: ProviderId,
  credential: string,
): ProviderDriver<ProviderId> {
  return registry.providers[id].authenticate({
    credential,
    restorableServices: Object.values(registry.agents).map(
      ({ service }) => service.name,
    ),
  });
}
