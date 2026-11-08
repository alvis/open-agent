import { commandError } from '#application/failures';
import { selectManagedMachine } from '#application/inspection';
import { summarizeMachine } from '#application/machine';
import { exposeWhenServing } from '#application/setup/serving';
import { countOutcomes, runUpdate } from '#application/update';
import {
  assertRecordedTools,
  assertUpgradable,
} from '#application/upgrade/checks';
import { chooseUpgrade } from '#application/upgrade/choice';
import { upgradeResult } from '#application/upgrade/result';
import {
  formatSpan,
  MILLISECONDS_PER_MINUTE,
  SPOKEN_UNITS,
} from '#application/upgrade/span';
import { staleServices } from '#domain/services';
import { checkOperation, runOperation } from '#kernel/operation';

import type {
  CommandOptions,
  WorkstationCommandParams,
} from '#application/contracts';
import type {
  ServiceRestart,
  UnrestartedService,
  UpgradeData,
} from '#application/data';
import type { ApplicationDependencies } from '#application/ports/dependencies';
import type { ProviderDriver } from '#application/ports/drivers';
import type { GuestChannel } from '#application/ports/guest-channel';
import type { Interaction } from '#application/ports/interaction';
import type { CommandResult } from '#application/result';
import type { GuestEnvironment } from '#domain/observations/environment';
import type { GovernorReport } from '#domain/observations/governor';
import type { StaleService } from '#domain/services';
import type { WorkstationRecord } from '#domain/workstation';

/** how the upgrade tells the time and waits, so a spec can drive both */
export interface UpgradeClock {
  /**
   * reads the current time
   * @returns milliseconds since the epoch
   */
  now(): number;
  /**
   * waits, giving up when the operation is cancelled
   * @param milliseconds how long to wait
   */
  wait(milliseconds: number): Promise<void>;
}

/** the request, provider and interaction an upgrade runs with, and its clock */
export interface UpgradeParams extends WorkstationCommandParams {
  /** the clock the idle wait reads and waits on; the system's when absent */
  clock?: UpgradeClock;
  /** asks through the interaction which tools to upgrade and how to restart, in place of the request's flags */
  ask?: boolean;
}

/** what restarting the stale services works with */
interface RestartContext {
  /** guest channel of the workstation */
  guest: GuestChannel;
  /** the provider, which exposes the agent again once it serves */
  provider: ProviderDriver;
  /** the workstation upgraded */
  workstation: WorkstationRecord;
  /** parsed upgrade flags */
  options: CommandOptions;
  /** optional progress boundary */
  interaction?: Interaction;
  /** the clock the idle wait reads and waits on */
  clock: UpgradeClock;
}

/** one stale service to restart, with what the update recorded */
interface RestartParams extends RestartContext {
  /** the environment as the update left it */
  environment: GuestEnvironment;
  /** the service and the tools installed since it started */
  candidate: StaleService;
}

/** what the wait for an idle agent reads */
interface IdleWaitParams {
  /** guest channel of the workstation */
  guest: GuestChannel;
  /** name of the service that waits */
  service: string;
  /** the harnesses whose holds mean a turn is in flight */
  harnesses: ReadonlySet<string>;
  /** longest the wait lasts, in milliseconds */
  timeoutMs: number;
  /** the clock the wait reads and waits on */
  clock: UpgradeClock;
  /** optional progress boundary */
  interaction?: Interaction;
}

/** progress stage every upgrade message reports under */
const UPGRADE_STAGE = 'upgrade';
/** how often the governor is asked whether an agent turn is in flight */
const IDLE_POLL_MS = 15_000;
/** consecutive idle polls that let a waiting service restart */
const IDLE_POLLS = 2;
/** longest a restart waits for an idle agent unless --wait-timeout says otherwise */
const DEFAULT_WAIT_MINUTES = 30;
const DEFAULT_WAIT_MS = DEFAULT_WAIT_MINUTES * MILLISECONDS_PER_MINUTE;

/** the real clock, whose wait the operation's cancellation cuts short */
const systemClock: UpgradeClock = {
  now: () => Date.now(),
  wait: async (milliseconds) =>
    runOperation(
      async () =>
        new Promise<void>((resolve) => {
          setTimeout(resolve, milliseconds);
        }),
    ),
};

/**
 * upgrades the named managed tools, or every one, in place and, with
 * --restart, restarts each service still running an older tool: a service
 * that cuts agent turns short waits until no turn is in flight, unless forced
 * @param dependencies the registered drivers, the guest mechanics
 * @param params the request, provider, interaction, optional clock, and whether to ask for the tools and the restart
 * @returns the update's outcome and each restart, failed when a tool failed to upgrade or a stale service was left running
 */
export async function upgradeWorkstation(
  dependencies: Pick<ApplicationDependencies, 'registry' | 'guest'>,
  params: UpgradeParams,
): Promise<CommandResult> {
  const { request, provider, interaction, clock = systemClock } = params;
  const workstation = await selectManagedMachine(dependencies, {
    provider,
    requestedName: request.machine,
    interaction,
    release: 'guest',
  });
  const connection = dependencies.guest.session.connect({
    provider,
    workstation,
  });
  try {
    const guest = await connection.guest();
    const environment = await dependencies.guest.environment.read(guest);
    assertUpgradable(environment, workstation);
    const options = await upgradeOptions(params, environment);
    const named = options.tools?.length ? options.tools : undefined;
    assertRecordedTools(environment, named);
    interaction?.progress({
      stage: UPGRADE_STAGE,
      message: `Upgrading ${named ? named.join(', ') : 'every managed tool'} in place; this may take several minutes`,
    });
    const status = await runUpdate(dependencies, {
      connection,
      guest,
      stage: 'upgrade.update',
      only: named,
    });
    const data: UpgradeData = {
      machine: summarizeMachine(dependencies, workstation),
      selection: named ?? environment.tools.map(({ name }) => name),
      ...(status?.finishedAt ? { components: countOutcomes(status) } : {}),
      tools: status?.tools ?? [],
    };
    const restarts = options.restart
      ? await restartStaleServices(dependencies, {
          guest,
          provider,
          workstation,
          options,
          interaction,
          clock,
        })
      : undefined;

    return upgradeResult({
      workstation,
      data: { ...data, ...(restarts ? { restarts } : {}) },
      named,
      restart: options,
    });
  } finally {
    await connection.close();
  }
}

/**
 * reads the tools and the restart from the request's flags or, when the
 * upgrade asks, from the user's answers over the recorded tools
 * @param params the request, its interaction and whether to ask
 * @param environment what the guest records, whose tools are offered
 * @returns the request's options with any answers in place of its flags
 */
async function upgradeOptions(
  params: UpgradeParams,
  environment: GuestEnvironment,
): Promise<CommandOptions> {
  const { request, interaction } = params;
  if (!params.ask || !interaction) {
    return request.options;
  }

  return {
    ...request.options,
    ...(await chooseUpgrade(interaction, {
      recorded: environment.tools.map(({ name }) => name),
      wait: formatSpan(DEFAULT_WAIT_MS, SPOKEN_UNITS),
    })),
  };
}

/**
 * restarts every service still running an older tool, one at a time, those
 * that restart at once first so none of them waits behind the agent
 * @param dependencies the registered drivers, the guest mechanics
 * @param context the guest, provider, workstation, flags, progress and clock
 * @returns what became of each stale service
 */
async function restartStaleServices(
  dependencies: Pick<ApplicationDependencies, 'registry' | 'guest'>,
  context: RestartContext,
): Promise<ServiceRestart[]> {
  const { guest } = context;
  // the update recorded in environment.json when it installed each tool
  const environment = await dependencies.guest.environment.read(guest);
  const stale = staleServices(
    environment.services,
    await guest.services.list(),
    environment.tools,
  );
  const ordered = [
    ...stale.filter(({ service }) => !service.waitsForIdle),
    ...stale.filter(({ service }) => service.waitsForIdle),
  ];
  const restarts: ServiceRestart[] = [];
  for (const candidate of ordered) {
    restarts.push(
      await restartService(dependencies, {
        ...context,
        environment,
        candidate,
      }),
    );
  }

  return restarts;
}

/**
 * restarts one stale service, waiting first for an idle agent when the
 * service cuts turns short, and exposes the agent again once it serves
 * @param dependencies the registered drivers, the guest mechanics
 * @param params the stale service, the recorded environment and the restart context
 * @returns what became of the service
 */
async function restartService(
  dependencies: Pick<ApplicationDependencies, 'registry' | 'guest'>,
  params: RestartParams,
): Promise<ServiceRestart> {
  const { guest, environment, options, interaction } = params;
  const { service, tools } = params.candidate;
  const timeoutMs = options.waitTimeout ?? DEFAULT_WAIT_MS;
  const left = (
    outcome: UnrestartedService['outcome'],
    reason: string,
  ): ServiceRestart => ({ service: service.name, tools, outcome, reason });
  const busy =
    service.waitsForIdle && !options.force
      ? await waitForIdle(dependencies, {
          guest,
          service: service.name,
          harnesses: new Set(environment.agent.harnesses.map(({ id }) => id)),
          timeoutMs,
          clock: params.clock,
          interaction,
        })
      : undefined;
  if (busy !== undefined) {
    return left(
      'deferred',
      `after ${formatSpan(timeoutMs, SPOKEN_UNITS)}, ${busy}`,
    );
  }
  interaction?.progress({
    stage: UPGRADE_STAGE,
    message: `Restarting ${service.name} to run the upgraded ${tools.join(', ')}`,
  });
  try {
    if (!(await guest.services.restart(service.name))) {
      return left('failed', 'it did not run again in time');
    }
    if (service.name === environment.agent.service) {
      await exposeWhenServing(dependencies, guest, {
        provider: params.provider,
        workstation: params.workstation,
        profile: environment.profile,
      });
    }
  } catch (error) {
    checkOperation();

    return left('failed', commandError(error).message);
  }

  return { service: service.name, tools, outcome: 'restarted' };
}

/**
 * polls the idle governor until it shows no agent turn in flight on two
 * polls in a row, or the wait runs out
 * @param dependencies the guest mechanics
 * @param params the guest, the waiting service, the harnesses, the bound, the clock and progress
 * @returns nothing once the agent stayed idle, or why the agent was not yet seen idle when the wait ran out
 */
async function waitForIdle(
  dependencies: Pick<ApplicationDependencies, 'guest'>,
  params: IdleWaitParams,
): Promise<string | undefined> {
  const { guest, service, harnesses, clock, interaction } = params;
  const deadline = clock.now() + params.timeoutMs;
  let idlePolls = 0;
  for (;;) {
    const report = await dependencies.guest.inspection.governor(guest);
    const busy = busyReason(report, harnesses, clock.now());
    idlePolls = busy === undefined ? idlePolls + 1 : 0;
    if (idlePolls >= IDLE_POLLS) {
      return undefined;
    }
    if (clock.now() + IDLE_POLL_MS > deadline) {
      return (
        busy ??
        `the agent was idle on ${idlePolls} of the ${IDLE_POLLS} polls in a row a restart needs`
      );
    }
    interaction?.progress({
      stage: UPGRADE_STAGE,
      message: `${service} waits to restart: ${busy ?? 'checking the agent stays idle'}; checking again in ${formatSpan(IDLE_POLL_MS, SPOKEN_UNITS)}`,
    });
    await clock.wait(IDLE_POLL_MS);
  }
}

/**
 * tells why the agent may be busy: a harness's unexpired hold means a turn is
 * in flight, and an unreadable record or unlisted holds may hide one
 * @param report the governor's report
 * @param harnesses the harnesses whose holds mean a turn is in flight
 * @param now the current time, in milliseconds since the epoch
 * @returns why the agent may be busy, or nothing when it is idle
 */
function busyReason(
  report: GovernorReport,
  harnesses: ReadonlySet<string>,
  now: number,
): string | undefined {
  if (!report.recorded) {
    return `the idle governor cannot tell whether a turn is in flight (${report.reason})`;
  }
  const { holds, openHolds } = report.state;
  const turns = holds.filter(
    ({ source, expiresAt }) =>
      harnesses.has(source) && Date.parse(expiresAt) > now,
  );
  if (turns.length > 0) {
    const sources = [...new Set(turns.map(({ source }) => source))];

    return `an agent turn is in flight (${sources.join(', ')})`;
  }

  return openHolds > holds.length
    ? 'the idle governor lists only some of its open holds'
    : undefined;
}
