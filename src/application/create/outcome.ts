import { summarizeMachine } from '#application/machine';
import { assessReadiness } from '#application/readiness';

import type { ApplicationDependencies } from '#application/ports/dependencies';
import type { CommandResult } from '#application/result';
import type { GuestInspection } from '#domain/observations/inspection';
import type { WorkstationRecord } from '#domain/workstation';

import type { CreatePreflight } from './context';

/** what the successful create result reports */
export interface ResultContext {
  workstation: WorkstationRecord;
  observed: GuestInspection;
  preflight: CreatePreflight;
}

/**
 * returns a successful create
 * @param dependencies the registered drivers
 * @param context ready workstation and guest evidence
 * @returns final structured create result
 */
export function createResult(
  dependencies: Pick<ApplicationDependencies, 'registry'>,
  context: ResultContext,
): CommandResult {
  const { workstation, observed, preflight } = context;

  return {
    command: 'create',
    ok: true,
    data: {
      machine: summarizeMachine(dependencies, workstation),
      preflight,
      profile: observed.environment.profile,
      readiness: assessReadiness(dependencies, observed),
      network: {
        online: observed.network.online,
        skipped: observed.network.skipped,
        reason: observed.network.reason,
      },
      services: observed.services.map((service) => ({
        name: service.name,
        state: service.status,
      })),
      native: observed.native,
    },
  };
}
