import type { DriverRegistry } from '#application/ports/drivers';

/**
 * labels every managed service for human output
 * @param registry every registered driver
 * @returns display names keyed by service name
 */
export function serviceLabels(
  registry: Pick<DriverRegistry, 'agents'>,
): Record<string, string> {
  return Object.fromEntries(
    Object.values(registry.agents).map(({ service, displayName }) => [
      service.name,
      displayName,
    ]),
  );
}
