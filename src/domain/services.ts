import { CommandFault } from '#kernel/faults';

import type { ProductDeclarations } from '#domain/declarations';
import type { GuestAccount } from '#domain/guest-command';
import type { AgentId, NetworkId } from '#domain/ids';

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
  /** tools whose upgrade leaves the running service on an older version until it restarts; none when absent */
  runsOn?: readonly string[];
  /** whether a restart waits until no agent turn is in flight, since it would cut one short */
  waitsForIdle?: boolean;
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

/** a command the service backend runs on a fixed schedule */
export interface PeriodicJob {
  /** job identifier */
  name: string;
  /** minutes between two runs */
  everyMinutes: number;
  /** program, arguments and account each run executes */
  run: Pick<ServiceDefinition, 'command' | 'arguments' | 'account'>;
}

/** a tool's name and when an upgrade last installed it */
export interface ToolInstall {
  /** tool name */
  name: string;
  /** ISO 8601 instant an upgrade last installed it; absent when none did */
  installedAt?: string;
}

/** a service that still runs an older version of a tool it runs on */
export interface StaleService {
  /** the service */
  service: ServiceDefinition;
  /** the tools installed since the service started, in `runsOn` order */
  tools: string[];
}

/**
 * finds the running services that started before a tool they run on was
 * installed, so they still run its older version; a service whose start time
 * is unknown is never one, since nothing shows it is behind
 * @param services the services the guest runs
 * @param states each service's observed state
 * @param tools each tool and when it was last installed
 * @returns the stale services, in `services` order
 */
export function staleServices(
  services: readonly ServiceDefinition[],
  states: readonly GuestServiceState[],
  tools: readonly ToolInstall[],
): StaleService[] {
  const installs = new Map(
    tools.flatMap(({ name, installedAt }) => {
      const at = installedAt === undefined ? NaN : Date.parse(installedAt);

      return Number.isNaN(at) ? [] : [[name, at] as const];
    }),
  );

  return services.flatMap((service) => {
    const state = states.find(({ name }) => name === service.name);
    const started =
      state?.status === 'running' && state.startedAt !== undefined
        ? Date.parse(state.startedAt)
        : NaN;
    if (Number.isNaN(started)) {
      return [];
    }
    const behind = (service.runsOn ?? []).filter(
      (tool) => (installs.get(tool) ?? -Infinity) > started,
    );

    return behind.length > 0 ? [{ service, tools: behind }] : [];
  });
}

/** name of the periodic-job scheduler service every backend runs */
export const CRON_SERVICE_NAME = 'open-agent-cron';

/**
 * lists the daemon the agent service depends on for a network
 * @param declarations the data every registered driver declares
 * @param network selected network identifier
 * @returns the daemon, or undefined when the network runs none
 */
export function networkDaemon(
  declarations: ProductDeclarations,
  network: NetworkId,
): ServiceDefinition | undefined {
  return declarations.networks[network].daemon;
}

/**
 * builds the agent service, depending on the daemon of the selected network
 * @param declarations the data every registered driver declares
 * @param selection selected agent and network identifiers
 * @param selection.agent selected ACP agent
 * @param selection.network selected network
 * @returns the service definition core registers
 */
export function agentService(
  declarations: ProductDeclarations,
  selection: { agent: AgentId; network: NetworkId },
): ServiceDefinition {
  return dependOnDaemon(
    declarations.agents[selection.agent].service,
    networkDaemon(declarations, selection.network),
  );
}

/**
 * adds a network daemon to what a service already waits for, once
 * @param service service with its own dependencies
 * @param daemon daemon the selected network runs, if any
 * @returns the service waiting for its own dependencies and the daemon
 */
export function dependOnDaemon(
  service: ServiceDefinition,
  daemon: ServiceDefinition | undefined,
): ServiceDefinition {
  return {
    ...service,
    needs: [...new Set([...service.needs, ...(daemon ? [daemon.name] : [])])],
  };
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
