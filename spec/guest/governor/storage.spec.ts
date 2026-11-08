import { describe, expect, it } from 'vitest';

import {
  relayLine,
  runGovernorTick,
  runStorageWatcher,
} from '../../mocks/governor';

import type { StorageMeasure, StorageScenario } from '../../mocks/governor';

/** KB in a GB, as df -k counts it */
const GB = 1024 * 1024;
const MINUTE = 60_000;
const NOW = Date.parse('2026-11-08T12:00:00.000Z');

const iso = (at: number): string => new Date(at).toISOString();

const WATCHER = {
  state: 'on',
  thresholdPercent: 80,
  stepGb: 10,
  limitGb: 100,
  mechanisms: ['guest-extend'],
} as const;
const NATIVE_FIRST = {
  ...WATCHER,
  mechanisms: ['provider-auto', 'guest-extend'],
} as const;

/**
 * a filesystem df shows at a size, a share of it used
 * @param sizeGb the size df shows, in GB
 * @param usedPercent the share used
 * @returns the measure df reports
 */
const filesystem = (sizeGb: number, usedPercent: number): StorageMeasure => {
  const sizeKb = Math.floor(sizeGb * GB);
  const usedKb = Math.floor((sizeKb * usedPercent) / 100);

  return { sizeKb, usedKb, availableKb: sizeKb - usedKb };
};

const watch = async (scenario: Partial<StorageScenario>) =>
  runStorageWatcher({
    policy: WATCHER,
    measure: filesystem(19.4, 85),
    now: NOW,
    ...scenario,
  });

const LOG_TIME = String.raw`\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z`;

describe('fn:oa_storage_watch', () => {
  it('should grow the provisioned size one step and record the attempt root-only', async () => {
    const run = await watch({});

    expect(run.attempts).toEqual(['storage-size', 'extend-storage 30']);
    expect(run.calls).toContainEqual(
      expect.stringMatching(
        /^timeout -k 5 120 \/bin\/sh .*\/drivers\/providers\/fixture\/storage\.sh extend-storage 30$/,
      ),
    );
    expect(run.calls).toContain('df -P -k /data');
    expect(run.state).toEqual({
      version: 1,
      lastSizeGb: 30,
      sizeChangedAt: iso(NOW),
      lastAttempt: {
        at: iso(NOW),
        targetGb: 30,
        outcome: 'grown',
        sizeGb: 30,
        detail: expect.stringContaining('30 GB'),
      },
    });
    expect(run.stateMode).toBe(0o600);
    expect(run.log).toEqual([
      expect.stringMatching(
        new RegExp(
          `^open-agent-awake ${LOG_TIME} event=extend-storage source=storage outcome=grown target-gb=30$`,
        ),
      ),
    ]);
    expect(run.notes).toEqual([]);
  });

  it('should start df and the adapter without the governor lock descriptors', async () => {
    const run = await watch({});

    expect(run.descriptors).toEqual(['fds -', 'fds -', 'fds -']);
  });

  it('should grow at the threshold exactly', async () => {
    const run = await watch({ measure: filesystem(20, 80) });

    expect(run.attempts).toEqual(['storage-size', 'extend-storage 30']);
  });

  it('should count a partly used percent as a whole one, as df does', async () => {
    const run = await watch({ measure: filesystem(20, 79.5) });

    expect(run.attempts).toEqual(['storage-size', 'extend-storage 30']);
  });

  it('should neither ask for the size nor record it below the threshold', async () => {
    const run = await watch({ measure: filesystem(20, 79) });

    expect(run.attempts).toEqual([]);
    expect(run.stateText).toBe('');
    expect(run.log).toEqual([]);
  });

  it('should grow a 10 GB volume df shows as 9.7 GB by a step of 1 to 11 GB', async () => {
    const run = await watch({
      policy: { ...WATCHER, stepGb: 1, limitGb: 12 },
      measure: filesystem(9.7, 90),
      adapter: { size: 'size 10', answer: 'grown 11' },
    });

    expect(run.attempts).toEqual(['storage-size', 'extend-storage 11']);
    expect(run.state).toEqual(
      expect.objectContaining({
        lastSizeGb: 11,
        lastAttempt: expect.objectContaining({ targetGb: 11, sizeGb: 11 }),
      }),
    );
  });

  it('should cap a step at the limit from the provisioned size, not the size df shows', async () => {
    const run = await watch({
      policy: { ...WATCHER, stepGb: 5, limitGb: 503 },
      measure: filesystem(492, 90),
      adapter: { size: 'size 500', answer: 'grown 503' },
    });

    expect(run.attempts).toEqual(['storage-size', 'extend-storage 503']);
  });

  it.each([
    ['at the limit', 'size 100'],
    ['already above the limit', 'size 120'],
  ])(
    'should never grow the storage %s, whatever df shows',
    async (_case, size) => {
      const run = await watch({
        measure: filesystem(97.8, 90),
        adapter: { size },
      });

      expect(run.attempts).toEqual(['storage-size']);
      expect(run.state).toEqual({
        version: 1,
        lastSizeGb: Number(size.slice('size '.length)),
        sizeChangedAt: iso(NOW),
      });
    },
  );

  it.each([
    ['a failure', { size: 'failure the API is down' }, /the API is down/],
    ['no size', { size: 'size lots' }, /without a whole size/],
    [
      'a size beyond seven digits',
      { size: 'size 12345678' },
      /without a whole size/,
    ],
    ['an exit status', { size: 'size 20', sizeExitCode: 2 }, /exited 2/],
    ['no answer in time', { size: '', sizeExitCode: 124 }, /did not finish/],
  ])(
    'should record a failed attempt without growth for a size query with %s',
    async (_case, adapter, detail) => {
      const run = await watch({
        adapter,
        state: JSON.stringify({
          version: 1,
          lastSizeGb: 20,
          sizeChangedAt: iso(NOW - 30 * MINUTE),
        }),
      });

      expect(run.attempts).toEqual(['storage-size']);
      expect(run.state).toEqual({
        version: 1,
        lastSizeGb: 20,
        sizeChangedAt: iso(NOW - 30 * MINUTE),
        lastAttempt: {
          at: iso(NOW),
          outcome: 'failed',
          detail: expect.stringMatching(detail),
        },
      });
      expect(run.log).toEqual([
        expect.stringMatching(
          / event=extend-storage source=storage outcome=failed reason=size-unknown$/,
        ),
      ]);
    },
  );

  it('should wait five minutes after a failed size query before asking again', async () => {
    const failed = await watch({ adapter: { size: 'failure busy' } });
    const soon = await watch({
      state: failed.stateText,
      now: NOW + 4 * MINUTE,
    });
    const later = await watch({
      state: failed.stateText,
      now: NOW + 5 * MINUTE,
    });

    expect(failed.state).toEqual({
      version: 1,
      lastAttempt: expect.objectContaining({ outcome: 'failed' }),
    });
    expect(soon.attempts).toEqual([]);
    expect(later.attempts).toEqual(['storage-size', 'extend-storage 30']);
  });

  it('should leave the first five minutes of a size to native growth', async () => {
    const run = await watch({ policy: NATIVE_FIRST });

    expect(run.attempts).toEqual(['storage-size']);
    expect(run.state).toEqual({
      version: 1,
      lastSizeGb: 20,
      sizeChangedAt: iso(NOW),
    });
  });

  it('should wait while native growth changed the size within five minutes', async () => {
    const run = await watch({
      policy: NATIVE_FIRST,
      state: JSON.stringify({
        version: 1,
        lastSizeGb: 10,
        sizeChangedAt: iso(NOW - 30 * MINUTE),
      }),
    });

    expect(run.attempts).toEqual(['storage-size']);
    expect(run.state).toEqual(
      expect.objectContaining({ lastSizeGb: 20, sizeChangedAt: iso(NOW) }),
    );
  });

  it('should take a size change recorded in the future as happening now', async () => {
    const run = await watch({
      policy: NATIVE_FIRST,
      state: JSON.stringify({
        version: 1,
        lastSizeGb: 20,
        sizeChangedAt: iso(NOW + 30 * MINUTE),
      }),
    });

    expect(run.attempts).toEqual(['storage-size']);
    expect(run.state).toEqual(
      expect.objectContaining({ sizeChangedAt: iso(NOW) }),
    );
  });

  it.each([
    [4, ['storage-size']],
    [5, ['storage-size', 'extend-storage 30']],
  ])(
    'should grow alongside native growth once the size held for %i minutes only from five',
    async (minutes, attempts) => {
      const run = await watch({
        policy: NATIVE_FIRST,
        state: JSON.stringify({
          version: 1,
          lastSizeGb: 20,
          sizeChangedAt: iso(NOW - minutes * MINUTE),
        }),
      });

      expect(run.attempts).toEqual(attempts);
    },
  );

  it('should record a failed growth and retry it only five minutes later', async () => {
    const failed = await watch({
      adapter: { answer: 'failure the volume is busy' },
    });
    const soon = await watch({
      state: failed.stateText,
      now: NOW + 4 * MINUTE,
    });
    const later = await watch({
      state: failed.stateText,
      now: NOW + 5 * MINUTE,
    });

    expect(failed.state).toEqual({
      version: 1,
      lastSizeGb: 20,
      sizeChangedAt: iso(NOW),
      lastAttempt: {
        at: iso(NOW),
        targetGb: 30,
        outcome: 'failed',
        detail: 'the volume is busy',
      },
    });
    expect(failed.log).toEqual([
      expect.stringMatching(
        / event=extend-storage source=storage outcome=failed target-gb=30 reason=adapter-failed$/,
      ),
    ]);
    expect(soon.attempts).toEqual([]);
    expect(soon.stateText).toBe(failed.stateText);
    expect(later.attempts).toEqual(['storage-size', 'extend-storage 30']);
  });

  it('should wait five minutes after a grown attempt before growing again', async () => {
    const grown = await watch({});
    const soon = await watch({ state: grown.stateText, now: NOW + MINUTE });
    const later = await watch({
      state: grown.stateText,
      adapter: { size: 'size 30', answer: 'grown 40' },
      now: NOW + 5 * MINUTE,
    });

    expect(soon.attempts).toEqual([]);
    expect(later.attempts).toEqual(['storage-size', 'extend-storage 40']);
    expect(later.state).toEqual(
      expect.objectContaining({
        lastSizeGb: 40,
        sizeChangedAt: iso(NOW + 5 * MINUTE),
      }),
    );
  });

  it.each([
    [
      'an adapter that did not finish',
      { answer: '', exitCode: 124 },
      /did not finish within 120 s/,
    ],
    [
      'an adapter that named no size',
      { answer: 'done', exitCode: 3 },
      /exited 3/,
    ],
    [
      'a grown answer without a whole size',
      { answer: 'grown 30GB' },
      /without a whole size/,
    ],
    [
      'a grown answer from an adapter that exited with a failure',
      { answer: 'grown 30', exitCode: 1 },
      /exited 1/,
    ],
  ])('should record %s as failed', async (_case, adapter, detail) => {
    const run = await watch({ adapter });

    expect(run.state).toEqual(
      expect.objectContaining({
        lastSizeGb: 20,
        lastAttempt: {
          at: iso(NOW),
          targetGb: 30,
          outcome: 'failed',
          detail: expect.stringMatching(detail),
        },
      }),
    );
  });

  it('should keep a failure detail to one line of recordable text', async () => {
    const run = await watch({
      adapter: { answer: `failure ${'x'.repeat(300)}\ttab` },
    });

    expect(run.state).toEqual(
      expect.objectContaining({
        lastAttempt: expect.objectContaining({ detail: 'x'.repeat(240) }),
      }),
    );
  });

  it.each([
    ['no state', JSON.stringify({ version: 1 })],
    ['not JSON', 'not JSON'],
    [
      'an attempt in the future',
      JSON.stringify({
        version: 1,
        lastSizeGb: 20,
        sizeChangedAt: iso(NOW - 30 * MINUTE),
        lastAttempt: { at: iso(NOW + MINUTE), targetGb: 30, outcome: 'failed' },
      }),
    ],
    [
      'an attempt of another shape',
      JSON.stringify({
        version: 1,
        lastAttempt: { at: iso(NOW), targetGb: 30, outcome: 'unknown' },
      }),
    ],
    [
      'a grown attempt without a target',
      JSON.stringify({
        version: 1,
        lastAttempt: { at: iso(NOW), outcome: 'grown' },
      }),
    ],
    ['an oversized state', JSON.stringify({ padding: 'x'.repeat(5000) })],
  ])('should start afresh from %s', async (_case, state) => {
    const run = await watch({ state });

    expect(run.attempts).toEqual(['storage-size', 'extend-storage 30']);
  });

  it.each([
    ['no policy', undefined],
    ['a policy that is off', { state: 'off' }],
    ['an unsupported policy', { state: 'unsupported' }],
    [
      'native growth alone',
      { ...WATCHER, mechanisms: ['provider-auto'] as const },
    ],
    ['a policy without a step', { ...WATCHER, stepGb: 0 }],
  ])('should run nothing for %s', async (_case, policy) => {
    const run = await watch({ policy });

    expect(run.attempts).toEqual([]);
    expect(run.calls).not.toContainEqual(expect.stringMatching(/^df /));
    expect(run.stateText).toBe('');
  });

  it.each([
    ['beside the guest root', { isBesideRoot: true }],
    ['leaving the guest root', { path: 'drivers/../../storage.sh' }],
    ['writable by its group', { mode: 0o720 }],
    ['writable by everyone', { mode: 0o702 }],
    ['a link', { isLink: true }],
  ])('should run nothing with an adapter %s', async (_case, adapter) => {
    const run = await watch({ adapter });

    expect(run.attempts).toEqual([]);
    expect(run.calls).not.toContainEqual(expect.stringMatching(/^df /));
    expect(run.stateText).toBe('');
  });

  it('should run nothing with an adapter another account owns', async () => {
    const run = await watch({ uid: 4242 });

    expect(run.attempts).toEqual([]);
    expect(run.stateText).toBe('');
  });

  it.each(['data', '/data/../etc', '/data/', '/data//disk', '/./data'])(
    'should run nothing for the storage path %s',
    async (storagePath) => {
      const run = await watch({ storagePath });

      expect(run.calls).not.toContainEqual(expect.stringMatching(/^df /));
      expect(run.stateText).toBe('');
    },
  );

  it('should measure a storage path holding a space as one mount point', async () => {
    const run = await watch({ storagePath: '/mnt/agent data' });

    expect(run.calls).toContain('df -P -k /mnt/agent data');
    expect(run.attempts).toEqual(['storage-size', 'extend-storage 30']);
  });

  it.each(['//nas/agent data', 'agent data on /dev/vdb'])(
    'should measure a filesystem whose name %s holds a space by the fields around its capacity',
    async (name) => {
      const run = await watch({
        storagePath: '/mnt/agent data',
        measure: { ...filesystem(19.4, 85), filesystem: name },
      });

      expect(run.notes).toEqual([]);
      expect(run.attempts).toEqual(['storage-size', 'extend-storage 30']);
    },
  );

  it('should leave storage that is not mounted at its path as it is, with a note', async () => {
    const run = await watch({
      measure: { ...filesystem(19.4, 85), mountPoint: '/' },
    });

    expect(run.attempts).toEqual([]);
    expect(run.stateText).toBe('');
    expect(run.notes).toEqual([expect.stringContaining('not a mount point')]);
  });

  it('should leave the state as it is, with a note, when the storage cannot be measured', async () => {
    const run = await runStorageWatcher({
      policy: WATCHER,
      now: NOW,
      state: 'earlier',
    });

    expect(run.attempts).toEqual([]);
    expect(run.stateText).toBe('earlier');
    expect(run.notes).toEqual([expect.stringContaining('did not measure')]);
  });

  it('should leave the storage as it is, with a note, when df reports no measure it can read', async () => {
    const run = await watch({
      measure: { sizeKb: 2e16, usedKb: 1e16, availableKb: 1e16 },
    });

    expect(run.attempts).toEqual([]);
    expect(run.notes).toEqual([expect.stringContaining('did not measure')]);
  });

  it.each([
    [
      'an idle-form call holds the governor lock',
      { isGovernorHeld: true },
      /idle-form call held/,
    ],
    [
      'the governor lock is missing',
      { isGovernorMissing: true },
      /lock .* is missing/,
    ],
    [
      'an earlier watcher holds the storage lock',
      { isStorageHeld: true },
      /earlier watcher/,
    ],
  ])(
    'should leave the storage as it is, with a note, while %s',
    async (_case, locks, note) => {
      const run = await watch({ locks, state: 'earlier' });

      expect(run.attempts).toEqual([]);
      expect(run.calls).not.toContainEqual(expect.stringMatching(/^df /));
      expect(run.stateText).toBe('earlier');
      expect(run.notes).toEqual([expect.stringMatching(note)]);
    },
  );

  it('should take the governor lock shared, then the storage lock without waiting', async () => {
    const run = await watch({});

    expect(run.calls.filter((call) => call.startsWith('flock '))).toEqual([
      'flock -s -w 3 7',
      'flock -n 6',
    ]);
  });
});

describe('fn:oa_idle_tick', () => {
  it('should run the storage watcher before the idle decisions on a governed provider', async () => {
    const ran = await runGovernorTick({
      keepAwakeMode: 'governed',
      hasWatcher: true,
    });

    expect(ran).toEqual([
      'watch 1000',
      'locked oa_idle_tick_decide',
      'recompute keep record',
    ]);
  });

  it.each(['native-deadline', 'none'] as const)(
    'should run only the storage watcher on a %s provider',
    async (keepAwakeMode) => {
      const ran = await runGovernorTick({ keepAwakeMode, hasWatcher: true });

      expect(ran).toEqual(['watch 1000']);
    },
  );

  it('should skip a watcher that is not installed', async () => {
    const ran = await runGovernorTick({
      keepAwakeMode: 'governed',
      hasWatcher: false,
    });

    expect(ran).toEqual([
      'locked oa_idle_tick_decide',
      'recompute keep record',
    ]);
  });
});

describe('fn:oa_idle_relay_line', () => {
  const AT = '2026-11-08T12:00:00Z';

  it('should relay a storage attempt only from root', async () => {
    const record = `${AT} extend-storage storage - failed 30 adapter-failed`;

    await expect(relayLine(record, 0)).resolves.toBe(
      `open-agent-awake ${AT} event=extend-storage source=storage outcome=failed target-gb=30 reason=adapter-failed`,
    );
    await expect(relayLine(record, 1000)).resolves.toBeUndefined();
  });

  it.each([
    [
      'a storage outcome on an awake event',
      `${AT} heartbeat claude - grown - -`,
    ],
    [
      'a storage reason on an awake event',
      `${AT} heartbeat claude - failed - adapter-failed`,
    ],
    [
      'an awake outcome on a storage attempt',
      `${AT} extend-storage storage - recorded 30 -`,
    ],
    [
      'a deadline on a storage attempt',
      `${AT} extend-storage storage - grown 2026-11-08T12:00:00.000Z -`,
    ],
    ['a target of no size', `${AT} extend-storage storage - grown 0 -`],
    [
      'a grown attempt of no target',
      `${AT} extend-storage storage - grown - -`,
    ],
    [
      'a size reason on an awake event',
      `${AT} heartbeat claude - failed - size-unknown`,
    ],
    ['a grown outcome on an awake event', `${AT} heartbeat claude - grown - -`],
    ['an oversized target', `${AT} extend-storage storage - grown 12345678 -`],
  ])('should refuse %s', async (_case, record) => {
    await expect(relayLine(record, 0)).resolves.toBeUndefined();
  });

  it('should relay a failed size query without a target', async () => {
    await expect(
      relayLine(`${AT} extend-storage storage - failed - size-unknown`, 0),
    ).resolves.toBe(
      `open-agent-awake ${AT} event=extend-storage source=storage outcome=failed reason=size-unknown`,
    );
  });

  it('should still relay an awake event with its deadline', async () => {
    await expect(
      relayLine(
        `${AT} heartbeat claude - recorded 2026-11-08T12:05:00.000Z -`,
        1000,
      ),
    ).resolves.toBe(
      `open-agent-awake ${AT} event=heartbeat source=claude outcome=recorded deadline=2026-11-08T12:05:00.000Z`,
    );
  });
});
