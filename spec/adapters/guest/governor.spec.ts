import { describe, expect, it, vi } from 'vitest';

import {
  governorJobs,
  inspectGovernor,
  sessionAwakeHold,
} from '#adapters/guest/governor';

import type { GuestChannel } from '#application/ports/guest-channel';
import type { StorageCapability } from '#domain/declarations';
import type { StoragePolicy } from '#domain/storage';

const TICK = {
  name: 'governor-tick',
  everyMinutes: 1,
  run: {
    command: '/opt/open-agent/governor/awake.sh',
    arguments: ['tick'],
    account: 'root',
  },
};

const storageOf = (growth: StorageCapability['growth']): StorageCapability => ({
  persistence: 'volume',
  defaultGb: 10,
  maxGb: 500,
  path: '/data',
  growth,
  hostExtend: false,
});

const ON: StoragePolicy = {
  state: 'on',
  thresholdPercent: 80,
  stepGb: 10,
  limitGb: 100,
  mechanisms: ['guest-extend'],
};

describe('fn:governorJobs', () => {
  it('should run the tick on a governed provider whatever its storage', () => {
    expect(
      governorJobs({ keepAwakeMode: 'governed', storage: storageOf([]) }),
    ).toEqual([TICK]);
  });

  it.each([['provider-auto', 'guest-extend'], ['guest-extend']] as const)(
    'should run the tick for the storage watcher of a provider growing by %s',
    (...growth) => {
      expect(
        governorJobs(
          { keepAwakeMode: 'native-deadline', storage: storageOf(growth) },
          { ...ON, mechanisms: growth },
        ),
      ).toEqual([TICK]);
    },
  );

  it.each<[string, StorageCapability['growth'], StoragePolicy | undefined]>([
    ['no recorded policy', ['guest-extend'], undefined],
    ['a policy that is off', ['guest-extend'], { state: 'off' }],
    ['native growth alone', ['provider-auto'], ON],
    ['fixed storage', [], { state: 'unsupported' }],
  ])(
    'should run no tick on an ungoverned provider with %s',
    (_case, growth, policy) => {
      expect(
        governorJobs(
          { keepAwakeMode: 'native-deadline', storage: storageOf(growth) },
          policy,
        ),
      ).toEqual([]);
    },
  );
});

describe('fn:inspectGovernor', () => {
  it('should preserve the reason from a validated governor report', async () => {
    const report = {
      recorded: false,
      reason: 'the guest has no governor record yet',
    };
    const guest = {
      exec: vi.fn<GuestChannel['exec']>(async () => ({
        exitCode: 0,
        stdout: JSON.stringify(report),
        stderr: '',
      })),
    } satisfies Partial<GuestChannel> as Partial<GuestChannel> as GuestChannel;

    await expect(inspectGovernor(guest)).resolves.toEqual(report);
  });

  it.each([
    { exitCode: 1, stdout: 'not JSON' },
    { exitCode: 0, stdout: 'not JSON' },
    { exitCode: 0, stdout: '{}' },
  ])(
    'should report unavailable governor evidence for $exitCode / $stdout',
    async (result) => {
      const guest = {
        exec: vi.fn<GuestChannel['exec']>(async () => ({
          ...result,
          stderr: '',
        })),
      } satisfies Partial<GuestChannel> as Partial<GuestChannel> as GuestChannel;

      await expect(inspectGovernor(guest)).resolves.toEqual({
        recorded: false,
        reason: expect.any(String),
      });
    },
  );
});

describe('session awake holds', () => {
  it.each(['open', 'close'] as const)(
    'should %s a hold bound to the session process',
    (action) => {
      expect(sessionAwakeHold[action](42)).toEqual({
        argv: [
          '/opt/open-agent/governor/awake.sh',
          `hold-${action}`,
          '--source',
          'session',
          '--session',
          'session-42',
          '--pid',
          '42',
        ],
        account: 'root',
        timeoutMs: expect.any(Number),
      });
    },
  );
});
