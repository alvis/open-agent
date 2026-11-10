import { t3Service } from '#adapters/drivers/agents/t3/service';
import { tailscaleDaemon } from '#adapters/drivers/networks/tailscale/service';
import { registry } from '#composition/registry';
import {
  effectiveStoragePolicy,
  initialStorageGb,
  supportsAutoGrowth,
} from '#domain/storage';

import { successData } from '../../cli';
import {
  BREW_TOOLS,
  checkManagedHold,
  readAwakeInstall,
  readHomebrewGit,
  sendAwakeEvents,
} from '../../guest';
import { HOMEBREW } from '../../layout';
import { foreignIdentifiers } from '../../ownership';
import {
  CREATE_TIMEOUT_MS,
  COMMAND_TIMEOUT_MS,
  DEVICE_TIMEOUT_MS,
  DEVICE_POLL_MS,
  MACHINE_SIZE_FLAGS,
  READ_TIMEOUT_MS,
} from '../limits';

import type { StorageReport } from '#domain/observations/storage';

import type { ServiceProcess } from '../../providers';
import type { CreatedLifecycle, LifecycleContext } from '../context';

const UPDATE_DUE_DAYS = 3;
/** the least share of its provisioned size a filesystem shows, its own metadata taking the rest */
const FILESYSTEM_SHARE = 0.9;
/** inspection rounds the measured size to a tenth of a GB, and a provider may provision a little more */
const SIZE_ALLOWANCE_GB = 1;

/**
 * creates and checks the ready workstation
 * @param context run drivers and prior observations
 * @returns the created workstation payload
 */
export async function createWorkstation(
  context: LifecycleContext,
): Promise<CreatedLifecycle['create']> {
  const { cli, name, signal, expect, harness } = context;
  const type = harness.provider.name;
  const create = successData(
    await cli.json(
      [
        'create',
        '--name',
        name,
        '--no-git-identity',
        '--update-due-days',
        String(UPDATE_DUE_DAYS),
        // the shortest hold maximum, so a managed hold is refreshed
        // within one update
        '--hold-max-minutes',
        '1',
        // the lifecycle runs on a private network, so every command is
        // proven against an enrolled device
        '--network',
        'tailscale',
        '--provider',
        type,
        ...MACHINE_SIZE_FLAGS[type],
      ],
      CREATE_TIMEOUT_MS[type],
      signal,
    ),
    'create',
  );
  expect(create).toMatchObject({
    profile: { network: 'tailscale' },
    machine: { name, setup: 'ready' },
    readiness: { ready: true, failures: [] },
    pairing: { status: 'not requested' },
  });

  // with no storage flags, growth is on wherever the provider's storage grows
  // automatically and unsupported elsewhere, at the provider's default size
  const { storage } = registry.providers[type].capabilities;

  expect(create.storage).toEqual({
    sizeGb: initialStorageGb(storage, create.profile.options),
    policy: effectiveStoragePolicy(storage, create.profile.options),
  });
  expect(create.storage.policy.state).toBe(
    supportsAutoGrowth(storage) ? 'on' : 'unsupported',
  );

  return create;
}

/**
 * checks Homebrew ownership and the enrolled device
 * @param context run drivers and prior observations
 */
export async function checkHomebrew(context: CreatedLifecycle): Promise<void> {
  const { name, expect, annotate, harness } = context;
  const { provider, cleanup } = harness;
  // Git, jj and gh are Homebrew's bottles at the default prefix, which
  // the agent's PATH searches first; the agent runs them but can change
  // nothing under the prefix, and Homebrew poured every keg from a bottle
  const homebrewGit = await readHomebrewGit(provider, name);

  await annotate(`Git ${homebrewGit.kegVersion} from Homebrew`);
  expect(homebrewGit).toEqual({
    agentVersion: homebrewGit.kegVersion,
    agentGit: `${HOMEBREW.prefix}/bin/git`,
    // the login profile names Homebrew's nano as the agent's editor
    agentEditor: ['nano', 'nano', `${HOMEBREW.prefix}/bin/nano`],
    kegVersion: expect.stringMatching(/^\d+\.\d+\.\d+$/),
    links: Object.fromEntries(
      BREW_TOOLS.map((tool) => [
        tool,
        expect.stringMatching(
          new RegExp(
            `^${HOMEBREW.prefix.replaceAll('.', '\\.')}/Cellar/${tool}/`,
          ),
        ),
      ]),
    ),
    agentWritable: [],
    owners: [
      `${HOMEBREW.account} ${HOMEBREW.account} 755 ${HOMEBREW.home}`,
      `${HOMEBREW.account} ${HOMEBREW.account} 755 ${HOMEBREW.prefix}`,
      expect.stringMatching(
        new RegExp(`^${HOMEBREW.account} ${HOMEBREW.account} 7[57]5 `),
      ),
    ],
    unbottledKegs: [],
  });

  await expect
    .poll(async () => (await cleanup.devicesOf(name)).length, {
      timeout: DEVICE_TIMEOUT_MS,
      interval: DEVICE_POLL_MS,
    })
    .toBe(1);
}

/**
 * checks setup, list and show commands
 * @param context run drivers and prior observations
 */
export async function checkCommands(context: CreatedLifecycle): Promise<void> {
  const { cli, name, signal, expect, id } = context;
  const setup = successData(
    await cli.json(
      ['setup', name, '--section', 'agent', '--yes'],
      COMMAND_TIMEOUT_MS,
      signal,
    ),
    'setup',
  );

  expect(setup).toMatchObject({
    section: 'agent',
    service: 'configured',
    machine: { name, id },
  });

  const list = successData(
    await cli.json(['list'], READ_TIMEOUT_MS, signal),
    'list',
  );

  expect(list.machines).toContainEqual(
    expect.objectContaining({ name, id, setup: 'ready' }),
  );

  const show = successData(
    await cli.json(['show', name], READ_TIMEOUT_MS, signal),
    'show',
  );

  expect(show).toEqual({
    machine: expect.objectContaining({
      name,
      id,
      setup: 'ready',
      readiness: 'not inspected',
    }),
  });

  // the agent account reports activity as a harness hook does, through
}

/**
 * checks awake command ownership and managed holds
 * @param context run drivers and prior observations
 */
export async function checkAwakeInstallation(
  context: CreatedLifecycle,
): Promise<void> {
  const { name, expect, harness } = context;
  const { provider } = harness;
  const { keepAwakeMode, wakeMode, supportsCliWakeSleep } =
    registry.providers[provider.name].capabilities;
  // the governor may initiate sleep only for a governed provider with a wake
  // path; the lifecycle keeps the default idle timeout, which is above 0
  const isSleepPermitted =
    keepAwakeMode === 'governed' &&
    (wakeMode === 'url-traffic' ||
      (wakeMode === 'cli-restore' && supportsCliWakeSleep));
  const awakeInstall = await readAwakeInstall(provider, name);
  const awakeSteps = await sendAwakeEvents(provider, name, name);

  expect(awakeInstall).toEqual({
    command: 'root 755',
    directory: 'root agent 1770',
    managedDirectory: 'root agent 2750',
  });
  expect(awakeSteps).toEqual([
    {
      exitCode: 0,
      state: expect.objectContaining({
        lastHeartbeat: expect.any(String),
        openHolds: 0,
        holds: [],
        sleepPermitted: isSleepPermitted,
      }),
    },
    {
      exitCode: 0,
      state: expect.objectContaining({
        openHolds: 1,
        holds: [expect.objectContaining({ source: 'e2e' })],
        sleepPermitted: isSleepPermitted,
      }),
    },
    {
      exitCode: 0,
      state: expect.objectContaining({ openHolds: 0, holds: [] }),
    },
  ]);

  // a hold root opens for a managed operation is beyond the agent
  // account's reach: it can neither remove it nor end it early
  const managedHold = await checkManagedHold(provider, name, name);

  expect(managedHold).toEqual({
    removeExitCode: 1,
    managedHolders: 1,
    state: expect.objectContaining({
      openHolds: 1,
      holds: [expect.objectContaining({ source: 'e2e-root' })],
    }),
  });

  // both harnesses carry the exact awake commands in their hook files
}

/**
 * checks the storage an inspection measured against what create reported:
 * the policy recorded at creation, and a filesystem showing nearly all of the
 * size the provider gave it
 * @param context run drivers and the create payload
 * @param storage the storage the inspection reported
 */
function checkInspectedStorage(
  context: CreatedLifecycle,
  storage: StorageReport | undefined,
): void {
  const { expect, create } = context;

  expect(storage).toEqual(
    expect.objectContaining({
      sizeGb: expect.any(Number),
      usedGb: expect.any(Number),
      usedPercent: expect.any(Number),
      policy: create.storage.policy,
    }),
  );
  expect(storage?.sizeGb).toBeGreaterThanOrEqual(
    create.storage.sizeGb * FILESYSTEM_SHARE,
  );
  expect(storage?.sizeGb).toBeLessThanOrEqual(
    create.storage.sizeGb + SIZE_ALLOWANCE_GB,
  );
}

/**
 * checks the inspected workstation and running services
 * @param context run drivers and prior observations
 * @returns the original service snapshot
 */
export async function inspectServices(
  context: CreatedLifecycle,
): Promise<ServiceProcess[]> {
  const { cli, name, signal, expect, id, create, harness } = context;
  const { provider } = harness;
  const inspected = successData(
    await cli.json(['show', name, '--inspect'], COMMAND_TIMEOUT_MS, signal),
    'show',
  );

  expect(inspected).toMatchObject({
    machine: { name, id },
    inspection: {
      environment: { profile: create.profile },
      readiness: { ready: true },
      native: {
        claude: { awakeHooksInstalled: true },
        codex: { awakeHooksInstalled: true },
      },
      governor: {
        recorded: true,
        state: {
          lastHeartbeat: expect.any(String),
          openHolds: 0,
          holds: [],
        },
      },
    },
  });

  checkInspectedStorage(context, inspected.inspection?.storage);

  expect(foreignIdentifiers(await provider.inspectIdentity(name))).toEqual([]);

  // the updater installs in place: the agent and the network daemon keep
  // their process through a forced run
  const before = await provider.snapshotServices(name);
  const watched = [t3Service.name, tailscaleDaemon.name];

  expect(before.map((service) => service.name)).toEqual(
    expect.arrayContaining(watched),
  );
  expect(before.filter((service) => watched.includes(service.name))).toEqual(
    watched.map((service) =>
      expect.objectContaining({
        name: service,
        status: 'running',
        pid: expect.any(Number),
        startedAt: expect.any(String),
      }),
    ),
  );

  return before;
}
