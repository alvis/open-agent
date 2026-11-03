import { CommandFault } from '#kernel/faults';

import type { ProductDeclarations } from '#domain/declarations';
import type { GuestAccount } from '#domain/guest-command';
import type { AgentId } from '#domain/ids';

/** provider-neutral definition of one long-running guest service */
export interface ServiceDefinition {
  /** service identifier */
  name: string;
  /** program the service runs */
  command: string;
  /** program arguments */
  arguments: readonly string[];
  /** account the service runs as */
  account: GuestAccount;
  /** services that must be running first */
  needs: readonly string[];
  /** port routed to the service, for the ACP agent only */
  httpPort?: number;
  /** whether the service writes the machine's log itself, as its stderr, on a backend that has one */
  machineLog?: boolean;
}

/** observed state of one guest service */
export interface GuestServiceState {
  /** service identifier */
  name: string;
  /** current status; absent when the provider reports no runtime state */
  status?: 'stopped' | 'starting' | 'running' | 'stopping' | 'failed';
  /** services it depends on */
  needs: readonly string[];
  /** start time as an ISO 8601 timestamp */
  startedAt?: string;
}

/**
 * reads the service core registers for the selected agent
 * @param declarations the data every registered driver declares
 * @param selection selected agent identifier
 * @param selection.agent selected ACP agent
 * @returns the service definition core registers
 */
export function agentService(
  declarations: ProductDeclarations,
  selection: { agent: AgentId },
): ServiceDefinition {
  return declarations.agents[selection.agent].service;
}

/**
 * reads the port the provider publishes for an agent
 * @param declarations the data every registered driver declares
 * @param agent selected agent identifier
 * @returns the port the agent service listens on
 * @throws {CommandFault} when the agent publishes no port
 */
export function agentPort(
  declarations: ProductDeclarations,
  agent: AgentId,
): number {
  const { httpPort } = declarations.agents[agent].service;
  if (httpPort === undefined) {
    throw new CommandFault({
      code: 'UNEXPECTED',
      message: `Agent ${agent} publishes no port`,
    });
  }

  return httpPort;
}
