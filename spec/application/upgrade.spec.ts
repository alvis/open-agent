import { mkdtempDisposable } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { SpritesClient } from '@fly/sprites';
import { describe, expect, it, vi } from 'vitest';

import { t3Service } from '#adapters/drivers/agents/t3/service';
import { tailscaleDaemon } from '#adapters/drivers/networks/tailscale/service';
import {
  MANAGED_LABEL,
  mergeMetadataLabels,
  SCHEMA_LABEL,
} from '#adapters/drivers/providers/sprite/labels';
import { exposeWhenServing } from '#application/setup/serving';
import { upgradeWorkstation } from '#application/upgrade';
import { resultExitCode } from '#cli/exit';
import { summarizeProfile } from '#domain/recorded';
import { InteractionExit } from '#kernel/navigation';
import { OPEN_AGENT_VERSION } from '#kernel/version';

import { environmentOf } from '../fixtures/environment';
import { DISABLED_NETWORK_PROFILE } from '../fixtures/profile';
import { dependencies, dependenciesWith } from '../mocks/dependencies';
import { createFilesystemSprite, providerOf } from '../mocks/sprites';

import type { CommandOptions } from '#application/contracts';
import type { ApplicationDependencies } from '#application/ports/dependencies';
import type { ProviderDriver } from '#application/ports/drivers';
import type { GuestMechanics } from '#application/ports/guest';
import type {
  GuestChannel,
  GuestServiceControl,
} from '#application/ports/guest-channel';
import type {
  Interaction,
  InteractionChoice,
} from '#application/ports/interaction';
import type { SetupSession } from '#application/ports/session';
import type { UpgradeClock } from '#application/upgrade';
import type {
  EnvironmentTool,
  GuestEnvironment,
} from '#domain/observations/environment';
import type { GovernorReport } from '#domain/observations/governor';
import type { GuestServiceState } from '#domain/services';

vi.mock(
  '#application/setup/serving',
  () =>
    ({
      exposeWhenServing: vi.fn(async () => undefined),
    }) satisfies Partial<typeof import('#application/setup/serving')>,
);

/** when the fake clock starts */
const START = Date.parse('2026-11-08T00:00:00.000Z');
/** when both services started, before any upgrade */
const SERVICES_STARTED = '2026-11-07T00:00:00.000Z';
/** when the upgrade installed a tool, after the services started */
const INSTALLED = '2026-11-07T12:00:00.000Z';
/** a hashed session identifier, as the governor records it */
const SESSION = 'a'.repeat(64);
/** the gate command the mechanics name */
const GATE = dependencies.guest.facts.updateGateCommand;

/** the services' observed state: both running since before the upgrade */
const STATES: readonly GuestServiceState[] = [
  {
    name: t3Service.name,
    status: 'running',
    needs: [],
    startedAt: SERVICES_STARTED,
  },
  {
    name: tailscaleDaemon.name,
    status: 'running',
    needs: [],
    startedAt: SERVICES_STARTED,
  },
];

/** an idle governor record, with only a managed hold open */
const IDLE: GovernorReport = governorReport([
  { source: 'update', session: SESSION, expiresAt: '2026-11-08T01:00:00.000Z' },
]);

/** a governor record with a Claude turn in flight */
const BUSY: GovernorReport = governorReport([
  { source: 'claude', session: SESSION, expiresAt: '2026-11-08T01:00:00.000Z' },
]);

/** what one upgrade run is driven with */
interface UpgradeRig {
  dependencies: ApplicationDependencies;
  provider: ProviderDriver;
  run: ReturnType<typeof vi.fn<SetupSession['run']>>;
  close: ReturnType<typeof vi.fn<SetupSession['close']>>;
  list: ReturnType<typeof vi.fn<GuestServiceControl['list']>>;
  restart: ReturnType<typeof vi.fn<GuestServiceControl['restart']>>;
  governor: ReturnType<typeof vi.fn<GuestMechanics['inspection']['governor']>>;
  readUpdateStatus: ReturnType<
    typeof vi.fn<GuestMechanics['environment']['readUpdateStatus']>
  >;
  clock: UpgradeClock & { waits: number[] };
}

/**
 * builds a governor record listing the given holds
 * @param holds the open holds it lists
 * @param openHolds how many holds it counts open, every listed one unless given
 * @returns a recorded governor report
 */
function governorReport(
  holds: Extract<GovernorReport, { recorded: true }>['state']['holds'],
  openHolds = holds.length,
): GovernorReport {
  return {
    recorded: true,
    state: {
      version: 1,
      updatedAt: '2026-11-08T00:00:00.000Z',
      idleTimeoutMinutes: 5,
      holdMaxMinutes: 60,
      holds,
      openHolds,
      sleepPermitted: false,
      diagnostics: [],
    },
  };
}

/**
 * builds a recorded brew tool
 * @param name what environment.json names the tool
 * @param installedAt when an upgrade last installed it, when one did
 * @returns the tool environment.json records
 */
function toolOf(name: string, installedAt?: string): EnvironmentTool {
  return {
    name,
    required: true,
    account: 'linuxbrew',
    executables: [name],
    source: { kind: 'brew', formula: name },
    ...(installedAt ? { installedAt } : {}),
  };
}

/**
 * builds the environment of a T3 workstation on Tailscale with Claude
 * @param installed the tools an upgrade installed after the services started
 * @returns the environment the guest records
 */
function environmentWith(installed: readonly string[]): GuestEnvironment {
  const base = environmentOf(DISABLED_NETWORK_PROFILE);

  return environmentOf(DISABLED_NETWORK_PROFILE, {
    tools: ['t3', 'bun', 'node', 'tailscale', 'git'].map((name) =>
      toolOf(name, installed.includes(name) ? INSTALLED : undefined),
    ),
    services: [t3Service, tailscaleDaemon],
    agent: {
      ...base.agent,
      harnesses: [{ id: 'claude', environment: {} }],
    },
  });
}

/**
 * builds a clock that moves only when the upgrade waits on it
 * @returns the clock and every wait it was asked for
 */
function createClock(): UpgradeClock & { waits: number[] } {
  const waits: number[] = [];

  return {
    waits,
    now: () => START + waits.reduce((total, wait) => total + wait, 0),
    wait: async (milliseconds) => {
      waits.push(milliseconds);
    },
  };
}

/**
 * builds a guest channel whose only working part is its service control
 * @param services the control its services are listed and restarted through
 * @returns a channel that throws on anything but its service control
 */
function channelOf(services: GuestServiceControl): GuestChannel {
  const unused = (): never => {
    throw new Error('an upgrade only controls services over the channel');
  };

  return {
    services,
    exec: unused,
    spawn: unused,
    exists: unused,
    read: unused,
    assertUnrestrictedNetwork: unused,
  };
}

/**
 * stands up a managed workstation whose guest records an environment
 * @param root directory standing for the guest filesystem
 * @param environment what the guest records
 * @returns the dependencies, provider, spies and clock of one upgrade run
 */
function upgradeRig(root: string, environment: GuestEnvironment): UpgradeRig {
  const sprite = Object.assign(createFilesystemSprite({ root }), {
    id: 'sprite-upgrade',
    organizationName: 'test',
    labels: mergeMetadataLabels([MANAGED_LABEL, SCHEMA_LABEL], {
      setup: 'ready',
      profile: summarizeProfile(DISABLED_NETWORK_PROFILE),
      version: OPEN_AGENT_VERSION,
    }),
  });
  const client = new SpritesClient('test-token');
  vi.spyOn(client, 'getSprite').mockResolvedValue(sprite);
  const list = vi.fn<GuestServiceControl['list']>(async () => [...STATES]);
  const restart = vi.fn<GuestServiceControl['restart']>(async () => true);
  const unused = async (): Promise<never> => {
    throw new Error('an upgrade only lists and restarts services');
  };
  const guest = channelOf({
    list,
    restart,
    ensure: unused,
    stop: unused,
    remove: unused,
  });
  const run = vi.fn<SetupSession['run']>(async () => ({
    exitCode: 0,
    stdout: '',
    stderr: '',
  }));
  const close = vi.fn<SetupSession['close']>(async () => undefined);
  const session: SetupSession = {
    release: {
      family: 'debian',
      id: 'debian',
      versionId: '12',
      codename: 'bookworm',
      arch: 'x86_64',
      libc: 'glibc',
    },
    pid: 4242,
    run,
    open: unused,
    reopen: unused,
    lend: unused,
    close,
    guest: async () => guest,
    [Symbol.asyncDispose]: close,
  };
  const governor = vi.fn<GuestMechanics['inspection']['governor']>(
    async () => IDLE,
  );
  const readUpdateStatus = vi.fn<
    GuestMechanics['environment']['readUpdateStatus']
  >(async () => ({
    startedAt: '2026-11-07T12:00:00.000Z',
    finishedAt: '2026-11-07T12:05:00.000Z',
    tools: [
      {
        name: 'tailscale',
        manager: 'brew',
        required: true,
        outcome: 'installed',
      },
    ],
  }));

  return {
    dependencies: dependenciesWith({
      guest: {
        ...dependencies.guest,
        session: { connect: () => session },
        environment: {
          ...dependencies.guest.environment,
          read: async () => environment,
          readUpdateStatus,
        },
        inspection: { ...dependencies.guest.inspection, governor },
        release: {
          ...dependencies.guest.release,
          assertSupported: async () => undefined,
        },
      },
    }),
    provider: providerOf(client),
    run,
    close,
    list,
    restart,
    governor,
    readUpdateStatus,
    clock: createClock(),
  };
}

/**
 * upgrades the rig's workstation
 * @param rig the upgrade run's dependencies, provider and clock
 * @param options parsed upgrade flags
 * @returns the upgrade result
 */
async function upgrade(
  rig: UpgradeRig,
  options: CommandOptions,
): ReturnType<typeof upgradeWorkstation> {
  return upgradeWorkstation(rig.dependencies, {
    request: { command: 'upgrade', machine: 'temporary', options },
    provider: rig.provider,
    clock: rig.clock,
  });
}

/**
 * builds an interaction that answers the upgrade's two questions
 * @param tools the tools left chosen
 * @param restart the restart mode chosen
 * @returns an interaction refusing any other prompt, and the tools it was offered
 */
function choiceInteraction(
  tools: readonly string[],
  restart: string,
): { interaction: Interaction; offered: InteractionChoice[] } {
  const offered: InteractionChoice[] = [];
  const refuse = async (): Promise<never> => {
    throw new Error('unexpected upgrade prompt');
  };

  return {
    offered,
    interaction: {
      input: refuse,
      secret: refuse,
      select: async (_prompt, choices) => {
        const choice = choices.find(({ value }) => value === restart);
        if (!choice) {
          throw new Error(`no restart choice ${restart}`);
        }

        return choice.value;
      },
      multiselect: async (_prompt, choices) => {
        offered.push(...choices);

        return choices
          .filter(({ value }) => tools.includes(value))
          .map(({ value }) => value);
      },
      confirm: refuse,
      progress: vi.fn(),
      status: vi.fn(),
    },
  };
}

describe('fn:upgradeWorkstation', () => {
  it('should upgrade every tool and touch no service without --restart', async () => {
    await using directory = await mkdtempDisposable(
      join(tmpdir(), 'open-agent-upgrade-plain-'),
    );
    const rig = upgradeRig(directory.path, environmentWith(['tailscale']));

    const result = await upgrade(rig, {});

    expect(result).toMatchObject({
      command: 'upgrade',
      ok: true,
      data: {
        selection: ['t3', 'bun', 'node', 'tailscale', 'git'],
        components: { installed: 1, skipped: 0, failed: 0 },
        tools: [{ name: 'tailscale', outcome: 'installed' }],
      },
    });
    expect(result.data).not.toHaveProperty('restarts');
    expect(rig.run.mock.calls.map(([command]) => command.argv)).toEqual([
      [GATE, '--force'],
    ]);
    expect([
      rig.list.mock.calls,
      rig.restart.mock.calls,
      rig.governor.mock.calls,
    ]).toEqual([[], [], []]);
    expect(rig.close).toHaveBeenCalled();
  });

  it('should forward the named tools to the gate as its selection', async () => {
    await using directory = await mkdtempDisposable(
      join(tmpdir(), 'open-agent-upgrade-only-'),
    );
    const rig = upgradeRig(directory.path, environmentWith([]));

    const result = await upgrade(rig, { tools: ['node', 't3'] });

    expect(result).toMatchObject({
      ok: true,
      data: { selection: ['node', 't3'] },
    });
    expect(rig.run.mock.calls.map(([command]) => command.argv)).toEqual([
      [GATE, '--force', '--only', 'node,t3'],
    ]);
  });

  it('should refuse a tool the workstation does not record before upgrading anything', async () => {
    await using directory = await mkdtempDisposable(
      join(tmpdir(), 'open-agent-upgrade-unknown-'),
    );
    const rig = upgradeRig(directory.path, environmentWith([]));

    await expect(
      upgrade(rig, { tools: ['node', 'bogus'] }),
    ).rejects.toMatchObject({
      code: 'USAGE',
      message: expect.stringContaining('bogus'),
    });
    expect(rig.run).not.toHaveBeenCalled();
    expect(rig.close).toHaveBeenCalled();
  });

  it('should name every unknown tool and say when the workstation records none', async () => {
    await using directory = await mkdtempDisposable(
      join(tmpdir(), 'open-agent-upgrade-unknown-tools-'),
    );
    const rig = upgradeRig(directory.path, {
      ...environmentWith([]),
      tools: [],
    });

    await expect(
      upgrade(rig, { tools: ['node', 'bogus'] }),
    ).rejects.toMatchObject({
      code: 'USAGE',
      message: 'Unknown tools: node, bogus',
      details: ['Recorded tools: none'],
    });
    expect(rig.run).not.toHaveBeenCalled();
  });

  it('should refuse a workstation an earlier open-agent set up, before upgrading anything', async () => {
    await using directory = await mkdtempDisposable(
      join(tmpdir(), 'open-agent-upgrade-earlier-setup-'),
    );
    const { runsOn: _runsOn, ...earlierAgent } = t3Service;
    const rig = upgradeRig(directory.path, {
      ...environmentWith(['t3']),
      services: [earlierAgent, tailscaleDaemon],
    });

    await expect(upgrade(rig, { restart: true })).rejects.toMatchObject({
      code: 'CONFLICT',
      message:
        'temporary was set up by an open-agent release that cannot upgrade its tools selectively',
      details: ['Run: open-agent setup "temporary"'],
    });
    expect(rig.run).not.toHaveBeenCalled();
    expect(rig.restart).not.toHaveBeenCalled();
    expect(rig.close).toHaveBeenCalled();
  });

  it('should report no tool outcomes when the update recorded nothing', async () => {
    await using directory = await mkdtempDisposable(
      join(tmpdir(), 'open-agent-upgrade-unrecorded-update-'),
    );
    const rig = upgradeRig(directory.path, environmentWith([]));
    rig.readUpdateStatus.mockResolvedValueOnce(undefined);

    const result = await upgrade(rig, {});

    expect(result).toEqual({
      command: 'upgrade',
      ok: true,
      data: {
        machine: expect.objectContaining({ name: 'temporary' }),
        selection: ['t3', 'bun', 'node', 'tailscale', 'git'],
        tools: [],
      },
    });
  });

  it('should restart the network daemon at once, never asking whether the agent is idle', async () => {
    await using directory = await mkdtempDisposable(
      join(tmpdir(), 'open-agent-upgrade-tailscale-'),
    );
    const rig = upgradeRig(directory.path, environmentWith(['tailscale']));
    rig.governor.mockResolvedValue(BUSY);

    const result = await upgrade(rig, { tools: ['tailscale'], restart: true });

    expect(result).toMatchObject({
      ok: true,
      data: {
        restarts: [
          { service: 'tailscaled', tools: ['tailscale'], outcome: 'restarted' },
        ],
      },
    });
    expect(rig.restart.mock.calls).toEqual([['tailscaled']]);
    expect(rig.governor).not.toHaveBeenCalled();
    expect(exposeWhenServing).not.toHaveBeenCalled();
  });

  it('should restart and expose the agent once two polls in a row show no turn in flight', async () => {
    await using directory = await mkdtempDisposable(
      join(tmpdir(), 'open-agent-upgrade-idle-'),
    );
    const rig = upgradeRig(directory.path, environmentWith(['t3', 'node']));
    rig.governor.mockResolvedValueOnce(BUSY);

    const result = await upgrade(rig, { restart: true });

    expect(result).toMatchObject({
      ok: true,
      data: {
        restarts: [
          {
            service: t3Service.name,
            tools: ['t3', 'node'],
            outcome: 'restarted',
          },
        ],
      },
    });
    expect(rig.governor).toHaveBeenCalledTimes(3);
    expect(rig.clock.waits).toEqual([15_000, 15_000]);
    expect(rig.restart.mock.calls).toEqual([[t3Service.name]]);
    expect(exposeWhenServing).toHaveBeenCalledExactlyOnceWith(
      rig.dependencies,
      expect.anything(),
      expect.objectContaining({ profile: DISABLED_NETWORK_PROFILE }),
    );
  });

  it('should defer the agent and fail when a turn stays in flight past the wait', async () => {
    await using directory = await mkdtempDisposable(
      join(tmpdir(), 'open-agent-upgrade-timeout-'),
    );
    const rig = upgradeRig(
      directory.path,
      environmentWith(['t3', 'tailscale']),
    );
    rig.governor.mockResolvedValue(BUSY);

    const result = await upgrade(rig, { restart: true, waitTimeout: 60_000 });

    expect(result).toMatchObject({
      command: 'upgrade',
      ok: false,
      error: {
        code: 'CONFLICT',
        machine: 'temporary',
        details: [
          `${t3Service.name} deferred: after 1 min, an agent turn is in flight (claude)`,
          'Retry: open-agent upgrade "temporary" --restart --wait-timeout 1m',
        ],
      },
      data: {
        restarts: [
          { service: 'tailscaled', outcome: 'restarted' },
          { service: t3Service.name, tools: ['t3'], outcome: 'deferred' },
        ],
      },
    });
    expect(resultExitCode(result)).toBe(1);
    expect(rig.clock.waits).toEqual([15_000, 15_000, 15_000, 15_000]);
    expect(rig.restart.mock.calls).toEqual([['tailscaled']]);
    expect(exposeWhenServing).not.toHaveBeenCalled();
  });

  it('should repeat the named tools and the wait in the retry of a deferred restart', async () => {
    await using directory = await mkdtempDisposable(
      join(tmpdir(), 'open-agent-upgrade-retry-'),
    );
    const rig = upgradeRig(directory.path, environmentWith(['t3']));
    rig.governor.mockResolvedValue(BUSY);

    const result = await upgrade(rig, {
      tools: ['t3', 'node'],
      restart: true,
      waitTimeout: 90_000,
    });

    expect(result).toMatchObject({
      ok: false,
      error: {
        details: expect.arrayContaining([
          'Retry: open-agent upgrade "temporary" t3,node --restart --wait-timeout 90s',
        ]),
      },
    });
  });

  it('should defer without claiming a turn in flight when the wait is too short for two polls', async () => {
    await using directory = await mkdtempDisposable(
      join(tmpdir(), 'open-agent-upgrade-short-'),
    );
    const rig = upgradeRig(directory.path, environmentWith(['t3']));

    const result = await upgrade(rig, { restart: true, waitTimeout: 10_000 });

    expect(result).toMatchObject({
      ok: false,
      data: {
        restarts: [
          {
            service: t3Service.name,
            outcome: 'deferred',
            reason:
              'after 10 s, the agent was idle on 1 of the 2 polls in a row a restart needs',
          },
        ],
      },
    });
    expect(rig.clock.waits).toEqual([]);
    expect(rig.restart).not.toHaveBeenCalled();
  });

  it('should fail the upgrade when a stale service does not run again', async () => {
    await using directory = await mkdtempDisposable(
      join(tmpdir(), 'open-agent-upgrade-failed-'),
    );
    const rig = upgradeRig(directory.path, environmentWith(['tailscale']));
    rig.restart.mockResolvedValueOnce(false);

    const result = await upgrade(rig, { restart: true });

    expect(result).toMatchObject({
      ok: false,
      error: { code: 'PROVIDER' },
      data: { restarts: [{ service: 'tailscaled', outcome: 'failed' }] },
    });
  });

  it('should keep waiting while the governor cannot tell whether a turn is in flight', async () => {
    await using directory = await mkdtempDisposable(
      join(tmpdir(), 'open-agent-upgrade-unrecorded-'),
    );
    const rig = upgradeRig(directory.path, environmentWith(['t3']));
    rig.governor.mockResolvedValueOnce({
      recorded: false,
      reason: 'the governor report is unavailable',
    });

    const result = await upgrade(rig, { restart: true });

    expect(result).toMatchObject({
      ok: true,
      data: { restarts: [{ service: t3Service.name, outcome: 'restarted' }] },
    });
    expect(rig.clock.waits).toEqual([15_000, 15_000]);
  });

  it('should treat a governor that lists only some of its open holds as busy', async () => {
    await using directory = await mkdtempDisposable(
      join(tmpdir(), 'open-agent-upgrade-partial-holds-'),
    );
    const rig = upgradeRig(directory.path, environmentWith(['t3']));
    rig.governor.mockResolvedValue(governorReport([], 1));

    const result = await upgrade(rig, { restart: true, waitTimeout: 60_000 });

    expect(result).toMatchObject({
      ok: false,
      error: { code: 'CONFLICT' },
      data: {
        restarts: [
          {
            service: t3Service.name,
            outcome: 'deferred',
            reason:
              'after 1 min, the idle governor lists only some of its open holds',
          },
        ],
      },
    });
    expect(rig.restart).not.toHaveBeenCalled();
  });

  it('should wait on the real clock when no clock is given', async () => {
    await using directory = await mkdtempDisposable(
      join(tmpdir(), 'open-agent-upgrade-system-clock-'),
    );
    const rig = upgradeRig(directory.path, environmentWith(['t3']));
    vi.useFakeTimers({ toFake: ['setTimeout', 'Date'], now: START });

    try {
      const pending = upgradeWorkstation(rig.dependencies, {
        request: {
          command: 'upgrade',
          machine: 'temporary',
          options: { restart: true },
        },
        provider: rig.provider,
      });
      await vi.advanceTimersByTimeAsync(14_999);
      expect(rig.governor).toHaveBeenCalledOnce();
      await vi.advanceTimersByTimeAsync(1);

      await expect(pending).resolves.toMatchObject({
        ok: true,
        data: { restarts: [{ service: t3Service.name, outcome: 'restarted' }] },
      });
      expect(rig.governor).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('should report the agent as failed when it is not ready to expose after its restart', async () => {
    await using directory = await mkdtempDisposable(
      join(tmpdir(), 'open-agent-upgrade-unready-'),
    );
    const rig = upgradeRig(directory.path, environmentWith(['t3']));
    vi.mocked(exposeWhenServing).mockRejectedValueOnce(
      new Error('the agent is not ready'),
    );

    const result = await upgrade(rig, { restart: true, force: true });

    expect(result).toMatchObject({
      ok: false,
      error: {
        code: 'PROVIDER',
        details: [
          `${t3Service.name} failed: the agent is not ready`,
          'Retry: open-agent upgrade "temporary" --restart --force',
        ],
      },
      data: {
        restarts: [
          {
            service: t3Service.name,
            outcome: 'failed',
            reason: 'the agent is not ready',
          },
        ],
      },
    });
  });

  it('should restart the agent without waiting when forced', async () => {
    await using directory = await mkdtempDisposable(
      join(tmpdir(), 'open-agent-upgrade-force-'),
    );
    const rig = upgradeRig(directory.path, environmentWith(['bun']));
    rig.governor.mockResolvedValue(BUSY);

    const result = await upgrade(rig, { restart: true, force: true });

    expect(result).toMatchObject({
      ok: true,
      data: {
        restarts: [
          { service: t3Service.name, tools: ['bun'], outcome: 'restarted' },
        ],
      },
    });
    expect(rig.governor).not.toHaveBeenCalled();
    expect(rig.clock.waits).toEqual([]);
    expect(exposeWhenServing).toHaveBeenCalledTimes(1);
  });

  it('should carry on past a failed tool and fail the upgrade naming it', async () => {
    await using directory = await mkdtempDisposable(
      join(tmpdir(), 'open-agent-upgrade-tool-failed-'),
    );
    const rig = upgradeRig(directory.path, environmentWith(['tailscale']));
    rig.readUpdateStatus.mockResolvedValueOnce({
      startedAt: '2026-11-07T12:00:00.000Z',
      finishedAt: '2026-11-07T12:05:00.000Z',
      tools: [
        {
          name: 'tailscale',
          manager: 'brew',
          required: true,
          outcome: 'installed',
        },
        {
          name: 'git',
          manager: 'brew',
          required: false,
          outcome: 'failed',
          reason: 'its brew upgrade failed',
        },
      ],
    });

    const result = await upgrade(rig, {});

    expect(result).toMatchObject({
      command: 'upgrade',
      ok: false,
      error: {
        code: 'PROVIDER',
        machine: 'temporary',
        details: [
          'git failed: its brew upgrade failed',
          'Retry: open-agent upgrade "temporary"',
        ],
      },
      data: { components: { installed: 1, skipped: 0, failed: 1 } },
    });
    expect(resultExitCode(result)).toBe(1);
  });

  it('should still restart the stale services when a tool failed to upgrade', async () => {
    await using directory = await mkdtempDisposable(
      join(tmpdir(), 'open-agent-upgrade-tool-failed-restart-'),
    );
    const rig = upgradeRig(directory.path, environmentWith(['tailscale']));
    rig.readUpdateStatus.mockResolvedValueOnce({
      startedAt: '2026-11-07T12:00:00.000Z',
      finishedAt: '2026-11-07T12:05:00.000Z',
      tools: [
        {
          name: 'tailscale',
          manager: 'brew',
          required: true,
          outcome: 'installed',
        },
        { name: 'node', manager: 'brew', required: true, outcome: 'failed' },
      ],
    });

    const result = await upgrade(rig, {
      tools: ['tailscale', 'node'],
      restart: true,
    });

    expect(result).toMatchObject({
      ok: false,
      error: {
        code: 'PROVIDER',
        details: [
          'node failed: its upgrade failed',
          'Retry: open-agent upgrade "temporary" tailscale,node --restart',
        ],
      },
      data: { restarts: [{ service: 'tailscaled', outcome: 'restarted' }] },
    });
    expect(rig.restart.mock.calls).toEqual([['tailscaled']]);
  });

  it('should count every failed tool and every stale service left running', async () => {
    await using directory = await mkdtempDisposable(
      join(tmpdir(), 'open-agent-upgrade-shortfall-'),
    );
    const rig = upgradeRig(
      directory.path,
      environmentWith(['t3', 'tailscale']),
    );
    rig.readUpdateStatus.mockResolvedValueOnce({
      startedAt: '2026-11-07T12:00:00.000Z',
      finishedAt: '2026-11-07T12:05:00.000Z',
      tools: [
        { name: 'bun', manager: 'brew', required: true, outcome: 'failed' },
        { name: 'git', manager: 'brew', required: false, outcome: 'failed' },
      ],
    });
    rig.restart.mockResolvedValueOnce(false);
    rig.governor.mockResolvedValue(BUSY);

    const result = await upgrade(rig, { restart: true, waitTimeout: 60_000 });

    expect(result).toMatchObject({
      ok: false,
      error: {
        code: 'PROVIDER',
        message:
          '2 tools failed to upgrade; 2 services still run an older tool',
      },
      data: {
        restarts: [
          { service: 'tailscaled', outcome: 'failed' },
          { service: t3Service.name, outcome: 'deferred' },
        ],
      },
    });
  });

  it('should offer every recorded tool when asked, then upgrade and restart as chosen', async () => {
    await using directory = await mkdtempDisposable(
      join(tmpdir(), 'open-agent-upgrade-ask-'),
    );
    const rig = upgradeRig(directory.path, environmentWith(['t3']));
    const { interaction, offered } = choiceInteraction(['t3', 'node'], 'idle');

    const result = await upgradeWorkstation(rig.dependencies, {
      request: { command: 'upgrade', machine: 'temporary', options: {} },
      provider: rig.provider,
      interaction,
      clock: rig.clock,
      ask: true,
    });

    expect(
      offered.map(({ value, isPreselected }) => [value, isPreselected]),
    ).toEqual([
      ['t3', true],
      ['bun', true],
      ['node', true],
      ['tailscale', true],
      ['git', true],
    ]);
    expect(rig.run.mock.calls.map(([command]) => command.argv)).toEqual([
      [GATE, '--force', '--only', 't3,node'],
    ]);
    expect(result).toMatchObject({
      ok: true,
      data: {
        selection: ['t3', 'node'],
        restarts: [{ service: t3Service.name, outcome: 'restarted' }],
      },
    });
    expect(rig.governor).toHaveBeenCalledTimes(2);
  });

  it('should upgrade every tool and restart without waiting when every tool stays chosen and the restart is forced', async () => {
    await using directory = await mkdtempDisposable(
      join(tmpdir(), 'open-agent-upgrade-ask-all-'),
    );
    const rig = upgradeRig(directory.path, environmentWith(['t3']));
    rig.governor.mockResolvedValue(BUSY);
    const { interaction } = choiceInteraction(
      ['t3', 'bun', 'node', 'tailscale', 'git'],
      'force',
    );

    const result = await upgradeWorkstation(rig.dependencies, {
      request: { command: 'upgrade', machine: 'temporary', options: {} },
      provider: rig.provider,
      interaction,
      clock: rig.clock,
      ask: true,
    });

    expect(rig.run.mock.calls.map(([command]) => command.argv)).toEqual([
      [GATE, '--force'],
    ]);
    expect(result).toMatchObject({
      ok: true,
      data: { restarts: [{ service: t3Service.name, outcome: 'restarted' }] },
    });
    expect(rig.governor).not.toHaveBeenCalled();
  });

  it('should leave every service alone when asked and no restart is chosen', async () => {
    await using directory = await mkdtempDisposable(
      join(tmpdir(), 'open-agent-upgrade-ask-none-'),
    );
    const rig = upgradeRig(directory.path, environmentWith(['t3']));
    const { interaction } = choiceInteraction(['t3'], 'none');

    const result = await upgradeWorkstation(rig.dependencies, {
      request: { command: 'upgrade', machine: 'temporary', options: {} },
      provider: rig.provider,
      interaction,
      clock: rig.clock,
      ask: true,
    });

    expect(result).toMatchObject({ ok: true, data: { selection: ['t3'] } });
    expect(result.data).not.toHaveProperty('restarts');
    expect(rig.restart).not.toHaveBeenCalled();
  });

  it('should go back without upgrading anything when no tool is chosen', async () => {
    await using directory = await mkdtempDisposable(
      join(tmpdir(), 'open-agent-upgrade-ask-empty-'),
    );
    const rig = upgradeRig(directory.path, environmentWith([]));
    const { interaction } = choiceInteraction([], 'idle');

    await expect(
      upgradeWorkstation(rig.dependencies, {
        request: { command: 'upgrade', machine: 'temporary', options: {} },
        provider: rig.provider,
        interaction,
        clock: rig.clock,
        ask: true,
      }),
    ).rejects.toEqual(new InteractionExit('back'));
    expect(rig.run).not.toHaveBeenCalled();
    expect(rig.close).toHaveBeenCalled();
  });
});
