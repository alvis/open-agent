import { cronService } from '#adapters/guest/services/cron';

import { UPDATE_JOB } from '#adapters/guest/updates';

import type { ServiceDefinition, PeriodicJob } from '#domain/services';

/**
 * lists the services environment.json records for the provider to run:
 * cron, which runs the periodic jobs, then the agent's service
 * @param agent the agent's service
 * @returns the services, each after those it needs
 */
export function guestServices(agent: ServiceDefinition): ServiceDefinition[] {
  return [cronService, agent];
}

/**
 * lists the jobs environment.json records for cron to run: the hourly update
 * gate
 * @returns the jobs, in the order cron lists them
 */
export function guestJobs(): PeriodicJob[] {
  return [UPDATE_JOB];
}
