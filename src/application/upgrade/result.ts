import { FLAG_UNITS, formatSpan } from './span';

import type { CommandOptions } from '#application/contracts';
import type {
  ServiceRestart,
  UnrestartedService,
  UpgradeData,
} from '#application/data';
import type { CommandResult } from '#application/result';
import type { WorkstationRecord } from '#domain/workstation';

/** what an upgrade's verdict is drawn from */
export interface UpgradeVerdict {
  /** the workstation upgraded */
  workstation: WorkstationRecord;
  /** each tool's outcome and, when a restart was asked for, each restart */
  data: UpgradeData;
  /** the tools the request named, absent for every tool */
  named: readonly string[] | undefined;
  /** how the request asked the stale services to restart */
  restart: Pick<CommandOptions, 'force' | 'waitTimeout'>;
}

/**
 * reports an upgrade as failed when a tool failed to upgrade or a stale
 * service was left running, so the exit status shows the workstation is not
 * yet fully upgraded; the other tools and the restarts have still run
 * @param verdict the workstation, the upgrade's outcome and the tools named
 * @returns success when every tool upgraded and every stale service restarted, else a failure whose retry repeats the request
 */
export function upgradeResult(verdict: UpgradeVerdict): CommandResult {
  const { workstation, data, named, restart } = verdict;
  const failed = data.tools.filter(({ outcome }) => outcome === 'failed');
  const left = (data.restarts ?? []).filter(isUnrestarted);
  if (failed.length === 0 && left.length === 0) {
    return { command: 'upgrade', ok: true, data };
  }
  const retry = [
    JSON.stringify(workstation.name),
    ...(named ? [named.join(',')] : []),
    ...(data.restarts ? restartFlags(restart) : []),
  ];

  return {
    command: 'upgrade',
    ok: false,
    data,
    error: {
      code:
        failed.length > 0 || left.some(({ outcome }) => outcome === 'failed')
          ? 'PROVIDER'
          : 'CONFLICT',
      message: describeShortfall(failed.length, left.length),
      machine: workstation.name,
      machineId: workstation.id,
      details: [
        ...failed.map(
          ({ name, reason }) =>
            `${name} failed: ${reason ?? 'its upgrade failed'}`,
        ),
        ...left.map(
          ({ service, outcome, reason }) => `${service} ${outcome}: ${reason}`,
        ),
        `Retry: open-agent upgrade ${retry.join(' ')}`,
      ],
    },
  };
}

/**
 * words what an upgrade left undone
 * @param tools how many tools failed to upgrade
 * @param services how many stale services were left running
 * @returns one sentence naming both counts that are not zero
 */
function describeShortfall(tools: number, services: number): string {
  const parts = [
    ...(tools === 0
      ? []
      : [
          tools === 1
            ? 'a tool failed to upgrade'
            : `${tools} tools failed to upgrade`,
        ]),
    ...(services === 0
      ? []
      : [
          services === 1
            ? 'a service still runs an older tool'
            : `${services} services still run an older tool`,
        ]),
  ];
  const sentence = parts.join('; ');

  return `${sentence.charAt(0).toUpperCase()}${sentence.slice(1)}`;
}

/**
 * repeats the restart a request asked for as its command-line flags
 * @param restart whether the restart was forced and how long it waited
 * @returns `--restart`, then `--force` and `--wait-timeout` when the request gave them
 */
function restartFlags(
  restart: Pick<CommandOptions, 'force' | 'waitTimeout'>,
): string[] {
  const { force, waitTimeout } = restart;

  return [
    '--restart',
    ...(force ? ['--force'] : []),
    ...(waitTimeout === undefined
      ? []
      : ['--wait-timeout', formatSpan(waitTimeout, FLAG_UNITS)]),
  ];
}

/**
 * tells a stale service the upgrade left running from one it restarted
 * @param restart what became of one stale service
 * @returns true when the service still runs an older tool
 */
function isUnrestarted(restart: ServiceRestart): restart is UnrestartedService {
  return restart.outcome !== 'restarted';
}
