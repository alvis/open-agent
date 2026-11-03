import { registeredSummary } from '#domain/profile';

import { CommandFault } from '#kernel/faults';

import type { ApplicationDependencies } from '#application/ports/dependencies';
import type { ProfileSummary } from '#domain/profile';
import type {
  WorkstationRecord,
  WorkstationSetupState,
} from '#domain/workstation';

const DNS_LABEL_MAX_LENGTH = 63;

/** control-plane details only; guest state is never inferred from this projection */
export interface MachineSummary {
  id: string;
  name: string;
  organization: string;
  createdAt?: string;
  state: string;
  agentUrl?: string;
  setup: WorkstationSetupState;
  /** driver selection recorded in provider metadata; absent when unrecorded */
  profile?: ProfileSummary;
  readiness: 'not inspected';
}

/**
 * explains why a user-selected hostname cannot name a workstation
 * @param name requested DNS-compatible machine name
 * @returns the problem, or undefined for a valid name
 */
export function machineNameProblem(name: string): string | undefined {
  return name.length > DNS_LABEL_MAX_LENGTH ||
    !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(name)
    ? 'Workstation name must be a lowercase DNS label of at most 63 characters'
    : undefined;
}

/**
 * validates a user-selected hostname before provisioning
 * @param name requested DNS-compatible machine name
 */
export function validateMachineName(name: string): void {
  const problem = machineNameProblem(name);
  if (problem) {
    throw new CommandFault({ code: 'INPUT', message: problem });
  }
}

/**
 * converts a live provider record into control-plane data
 * @param dependencies the registered drivers
 * @param workstation freshly fetched provider record
 * @returns a control-plane summary with guest readiness marked uninspected
 */
export function summarizeMachine(
  dependencies: Pick<ApplicationDependencies, 'registry'>,
  workstation: WorkstationRecord,
): MachineSummary {
  if (!workstation.id || !workstation.organization) {
    throw new CommandFault({
      code: 'PROVIDER',
      message: `Workstation ${workstation.name} lacks immutable provider identity`,
    });
  }

  return {
    id: workstation.id,
    name: workstation.name,
    organization: workstation.organization,
    createdAt: workstation.createdAt,
    state: workstation.state,
    agentUrl: workstation.url,
    setup: workstation.metadata.setup,
    profile: registeredSummary(
      dependencies.registry,
      workstation.metadata.profile,
    ),
    readiness: 'not inspected',
  };
}

/**
 * returns the canonical provider URL or fails rather than inventing one
 * @param workstation workstation with a provider URL
 * @returns canonical provider URL
 */
export function requireWorkstationUrl(workstation: WorkstationRecord): string {
  if (!workstation.url) {
    throw new CommandFault({
      code: 'PROVIDER',
      message: `Workstation ${workstation.name} has no provider URL`,
    });
  }

  return workstation.url;
}
