import { execFile } from 'node:child_process';
import {
  chmod,
  mkdir,
  mkdtempDisposable,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { describe, expect, it, vi } from 'vitest';

import { inspectStorage } from '#adapters/guest/storage';

import type { GuestChannel } from '#application/ports/guest-channel';
import type { GuestCommand } from '#domain/guest-command';

// --- CONSTANTS --- //

const MEASURE = [
  'Filesystem     1024-blocks     Used Available Capacity Mounted on',
  '/dev/vdb          20971520 13736345   7235175      66% /data',
].join('\n');

const STATE = {
  version: 1,
  lastSizeGb: 19,
  sizeChangedAt: '2026-11-08T10:00:00.000Z',
  lastAttempt: {
    at: '2026-11-08T10:00:00.000Z',
    targetGb: 30,
    outcome: 'failed',
    detail: 'the provider refused the size',
  },
};

const execFileAsync = promisify(execFile);

const PARAMS = {
  path: '/data',
  policy: { state: 'off' },
} as const;

// --- HELPERS --- //

/**
 * builds a guest whose one command answers with an exit status and output
 * @param exitCode the command's exit status
 * @param stdout what the command prints
 * @returns the guest and its command recorder
 */
function guestAnswering(
  exitCode: number,
  stdout: string,
): {
  guest: GuestChannel;
  exec: ReturnType<typeof vi.fn<GuestChannel['exec']>>;
} {
  const exec = vi.fn<GuestChannel['exec']>(async () => ({
    exitCode,
    stdout,
    stderr: '',
  }));

  return {
    guest: {
      exec,
    } satisfies Partial<GuestChannel> as Partial<GuestChannel> as GuestChannel,
    exec,
  };
}

/**
 * builds a guest that runs the probe in a local shell with a stand-in df,
 * reading the watcher state from a local file instead of the guest root's
 * @param directory where the stand-in df and timeout are written
 * @param state path of the local file read in place of storage.json
 * @returns a guest whose exec runs the probe on this host
 */
async function shellGuest(
  directory: string,
  state: string,
): Promise<GuestChannel> {
  const bin = join(directory, 'bin');
  await mkdir(bin);
  await writeFile(
    join(bin, 'df'),
    `#!/bin/sh\ntest "$4" = /data || exit 1\nprintf '%s\\n' '${MEASURE.replaceAll('\n', "' '")}'\n`,
  );
  await writeFile(join(bin, 'timeout'), '#!/bin/sh\nshift\nexec "$@"\n');
  await chmod(join(bin, 'df'), 0o755);
  await chmod(join(bin, 'timeout'), 0o755);
  const exec: GuestChannel['exec'] = async ({ program, arguments: args }) => {
    try {
      const { stdout, stderr } = await execFileAsync(
        program,
        [...args.slice(0, -1), state],
        { env: { PATH: `${bin}:/usr/bin:/bin` } },
      );

      return { exitCode: 0, stdout, stderr };
    } catch (error) {
      const { code, stdout, stderr } = error as Error & {
        code: number;
        stdout: string;
        stderr: string;
      };

      return { exitCode: code, stdout, stderr };
    }
  };

  return {
    exec,
  } satisfies Partial<GuestChannel> as Partial<GuestChannel> as GuestChannel;
}

// --- TEST SUITES --- //

describe('fn:inspectStorage', () => {
  it('should measure the storage path and read the watcher state as root in one command', async () => {
    const { guest, exec } = guestAnswering(
      0,
      `${MEASURE}\n--- storage.json\n${JSON.stringify(STATE)}`,
    );

    const report = await inspectStorage(guest, PARAMS);

    expect(report).toEqual({
      sizeGb: 20,
      usedGb: 13.1,
      usedPercent: 66,
      policy: { state: 'off' },
      provisionedGb: 19,
      lastGrowth: {
        at: '2026-11-08T10:00:00.000Z',
        targetGb: 30,
        outcome: 'failed',
        detail: 'the provider refused the size',
      },
    });
    expect(exec.mock.calls).toEqual([
      [
        {
          program: '/bin/sh',
          arguments: [
            '-c',
            expect.stringContaining('df -P -k'),
            'oa-storage',
            '/data',
            '/opt/open-agent/run/storage.json',
          ],
          timeoutMs: expect.any(Number),
        } satisfies Partial<GuestCommand>,
      ],
    ]);
  });

  it('should report no last growth when the watcher never recorded a state', async () => {
    const { guest } = guestAnswering(0, `${MEASURE}\n`);

    await expect(inspectStorage(guest, PARAMS)).resolves.toEqual({
      sizeGb: 20,
      usedGb: 13.1,
      usedPercent: 66,
      policy: { state: 'off' },
    });
  });

  it('should read a watcher state that is a regular file through the shell probe', async () => {
    await using directory = await mkdtempDisposable(
      join(tmpdir(), 'open-agent-storage-probe-'),
    );
    const state = join(directory.path, 'storage.json');
    await writeFile(state, JSON.stringify(STATE));

    const report = await inspectStorage(
      await shellGuest(directory.path, state),
      PARAMS,
    );

    expect(report).toEqual(
      expect.objectContaining({ sizeGb: 20, lastGrowth: STATE.lastAttempt }),
    );
  });

  it('should never read a watcher state a link names through the shell probe', async () => {
    await using directory = await mkdtempDisposable(
      join(tmpdir(), 'open-agent-storage-probe-'),
    );
    const target = join(directory.path, 'elsewhere.json');
    const state = join(directory.path, 'storage.json');
    await writeFile(target, JSON.stringify(STATE));
    await symlink(target, state);

    const report = await inspectStorage(
      await shellGuest(directory.path, state),
      PARAMS,
    );

    expect(report).toEqual({
      sizeGb: 20,
      usedGb: 13.1,
      usedPercent: 66,
      policy: { state: 'off' },
    });
  });

  it('should fail through the shell probe when df fails', async () => {
    await using directory = await mkdtempDisposable(
      join(tmpdir(), 'open-agent-storage-probe-'),
    );

    await expect(
      inspectStorage(await shellGuest(directory.path, 'absent.json'), {
        ...PARAMS,
        path: '/elsewhere',
      }),
    ).rejects.toThrow(
      new Error('The storage at /elsewhere could not be measured'),
    );
  });
});
