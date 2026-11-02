import type { ServiceDefinition } from '#domain/services';

/**
 * lists the services environment.json records for the provider to run: the
 * agent's service
 * @param agent the agent's service
 * @returns the services, each after those it needs
 */
export function guestServices(agent: ServiceDefinition): ServiceDefinition[] {
  return [agent];
}
