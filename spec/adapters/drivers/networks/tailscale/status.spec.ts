import { mkdtempDisposable } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import {
  inspectTailscale,
  parseTailnetStatus,
} from '#adapters/drivers/networks/tailscale/status';
import { OperationContext, withOperation } from '#kernel/operation';
import { rememberSecret } from '#kernel/redaction';

import { createFilesystemSprite, guestOf } from '../../../../mocks/sprites';

import type { ExecResult, Sprite } from '@fly/sprites';

/**
 * runs real status parsing against an isolated fake guest command boundary
 * @param outputs result or rejection for each executable the subject may run
 * @returns observed tailnet status and executed command names
 */
async function inspectWithCommands(
  outputs: Record<string, ExecResult | Error>,
) {
  await using directory = await mkdtempDisposable(
    join(tmpdir(), 'open-agent-tailscale-live-status-'),
  );
  const execute = vi.fn<Sprite['execFile']>(async (file, args = []) => {
    const command =
      file === '/usr/bin/sudo' ? args.slice(args.indexOf('--') + 1) : [file];
    const program = command[0];
    const output = program ? outputs[program] : undefined;
    if (!output) {
      throw new TypeError(`Unexpected guest command: ${program}`);
    }
    if (output instanceof Error) {
      throw output;
    }

    return output;
  });
  const sprite = createFilesystemSprite({ root: directory.path, execute });
  const status = await inspectTailscale(guestOf(sprite));
  const invocations = execute.mock.calls.map(([file, args = []]) =>
    file === '/usr/bin/sudo'
      ? args.slice(args.indexOf('--') + 1)
      : [file, ...args],
  );

  return { status, commands: invocations.map(([file]) => file) };
}

/**
 * makes a successful fake guest command response
 * @param stdout captured command output
 * @returns successful SDK result
 */
function succeeded(stdout: string): ExecResult {
  return { stdout, stderr: '', exitCode: 0 };
}

describe('fn:inspectTailscale unavailable status', () => {
  it('should use the generic offline reason when an operational error has no diagnostic', async () => {
    await using directory = await mkdtempDisposable(
      join(tmpdir(), 'open-agent-tailscale-empty-error-'),
    );
    const execute = vi
      .fn<Sprite['execFile']>()
      .mockRejectedValue(new Error(''));
    const sprite = createFilesystemSprite({ root: directory.path, execute });

    expect(await inspectTailscale(guestOf(sprite))).toStrictEqual({
      online: false,
      skipped: false,
      reason: 'Tailscale status unavailable',
    });
  });

  it.each([null, { message: 'untrusted SDK detail' }])(
    'should use a generic offline reason for a non-Error SDK rejection',
    async (rejection) => {
      await using directory = await mkdtempDisposable(
        join(tmpdir(), 'open-agent-tailscale-rejection-'),
      );
      const execute = vi.fn<Sprite['execFile']>().mockRejectedValue(rejection);
      const sprite = createFilesystemSprite({
        root: directory.path,
        execute,
      });

      const status = await inspectTailscale(guestOf(sprite));

      expect(status).toEqual({
        online: false,
        skipped: false,
        reason: 'Tailscale status unavailable',
      });
    },
  );

  it('should record nonzero and operational transport failures as bounded offline evidence', async () => {
    await using directory = await mkdtempDisposable(
      join(tmpdir(), 'open-agent-tailscale-offline-'),
    );
    const secret = 'cor02-private-tailnet-key';
    rememberSecret(secret);
    const execute = vi
      .fn<Sprite['execFile']>()
      .mockResolvedValueOnce({
        stdout: '',
        stderr: `unavailable ${secret} ${'x'.repeat(700)}`,
        exitCode: 7,
      })
      .mockRejectedValueOnce(new Error(`transport rejected ${secret}`));
    const sprite = createFilesystemSprite({
      root: directory.path,
      execute,
    });

    for (const status of [
      await inspectTailscale(guestOf(sprite)),
      await inspectTailscale(guestOf(sprite)),
    ]) {
      expect(status).toMatchObject({
        online: false,
        skipped: false,
      });
      expect(status.reason).toBeTruthy();
      expect(status.reason!.length).toBeLessThanOrEqual(512);
      expect(status.reason).not.toContain(secret);
    }
    expect(execute).toHaveBeenCalledTimes(2);
  });

  it('should reject malformed success and programmer faults instead of marking them offline', async () => {
    await using directory = await mkdtempDisposable(
      join(tmpdir(), 'open-agent-tailscale-invalid-'),
    );
    const execute = vi
      .fn<Sprite['execFile']>()
      .mockResolvedValueOnce({ stdout: '{', stderr: '', exitCode: 0 })
      .mockRejectedValueOnce(new TypeError('broken SDK response'));
    const sprite = createFilesystemSprite({ root: directory.path, execute });

    await expect(inspectTailscale(guestOf(sprite))).rejects.toBeInstanceOf(
      SyntaxError,
    );
    await expect(inspectTailscale(guestOf(sprite))).rejects.toBeInstanceOf(
      TypeError,
    );
  });

  it('should preserve cancellation during a deferred SDK status probe', async () => {
    await using directory = await mkdtempDisposable(
      join(tmpdir(), 'open-agent-tailscale-cancel-'),
    );
    const pending = Promise.withResolvers<ExecResult>();
    const execute = vi
      .fn<Sprite['execFile']>()
      .mockReturnValue(pending.promise);
    const sprite = createFilesystemSprite({ root: directory.path, execute });
    const controller = new AbortController();
    const context = new OperationContext({ signal: controller.signal });
    const result = withOperation(context, async () =>
      inspectTailscale(guestOf(sprite)),
    );
    await vi.waitFor(() => expect(execute).toHaveBeenCalledOnce());
    controller.abort();

    await expect(result).rejects.toMatchObject({ action: 'cancel' });
    pending.resolve({ stdout: '{}', stderr: '', exitCode: 0 });
  });
});

describe('fn:parseTailnetStatus', () => {
  it('should report the online identity and its first IPv4 address', () => {
    const status = parseTailnetStatus({
      Self: {
        ID: 'device-42',
        Online: true,
        TailscaleIPs: ['2001:db8::42', '192.0.2.42/32'],
      },
    });

    expect(status).toStrictEqual({
      deviceId: 'device-42',
      ip: '192.0.2.42/32',
      online: true,
      skipped: false,
    });
  });

  it('should leave absent or malformed native identity fields unknown', () => {
    const status = parseTailnetStatus({
      Self: { ID: '', Online: 'true', TailscaleIPs: [7, '2001:db8::9'] },
    });

    expect(status).toStrictEqual({
      deviceId: undefined,
      ip: undefined,
      online: false,
      skipped: false,
    });
  });

  it('should leave missing self identity unknown', () => {
    const status = parseTailnetStatus({ Self: null });

    expect(status).toStrictEqual({
      deviceId: undefined,
      ip: undefined,
      online: false,
      skipped: false,
    });
  });
});

describe('fn:inspectTailscale live status', () => {
  it('should read identity and connectivity from native status alone', async () => {
    const { status, commands } = await inspectWithCommands({
      tailscale: succeeded(
        JSON.stringify({
          Self: {
            ID: 'device-20',
            Online: true,
            TailscaleIPs: ['192.0.2.20/32'],
          },
        }),
      ),
    });

    expect(status).toStrictEqual({
      deviceId: 'device-20',
      ip: '192.0.2.20/32',
      online: true,
      skipped: false,
    });
    expect(commands).toEqual(['tailscale']);
  });

  it.each(['null', '[]', '"status"'])(
    'should reject a valid JSON status with the wrong shape: %s',
    async (body) => {
      await using directory = await mkdtempDisposable(
        join(tmpdir(), 'open-agent-tailscale-status-shape-'),
      );
      const execute = vi
        .fn<Sprite['execFile']>()
        .mockResolvedValue(succeeded(body));
      const sprite = createFilesystemSprite({
        root: directory.path,
        execute,
      });

      await expect(inspectTailscale(guestOf(sprite))).rejects.toThrow();
      expect(execute).toHaveBeenCalledOnce();
    },
  );
});
