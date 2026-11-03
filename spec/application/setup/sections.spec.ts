import { mkdtempDisposable } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { setupAgent } from '#application/setup/sections';

import { PairingSecret } from '#kernel/pairing-secret';

import { driveInk } from '../../fixtures/ink';
import { DISABLED_NETWORK_PROFILE } from '../../fixtures/profile';

import { dependencies } from '../../mocks/dependencies';
import {
  createFilesystemSprite,
  holdServices,
  workstationOf,
} from '../../mocks/sprites';

import type { GuestChannel } from '#application/ports/guest-channel';
import type { SetupContext } from '#application/setup/context';

// setup's root session is a framed guest shell only the live specs open
vi.mock(
  '#adapters/guest/platform/session/open',
  async () => import('../../mocks/session'),
);
describe('fn:setupAgent', () => {
  it('should report a native pairing without expiry metadata without exposing its token', async () => {
    await using directory = await mkdtempDisposable(
      join(tmpdir(), 'open-agent-pairing-policy-'),
    );
    const token = 'native-policy-private-token';
    const { context, guest } = await quietSetup(
      { withPairCode: true },
      directory.path,
      async () => ({ stdout: `Token: ${token}\n`, stderr: '', exitCode: 0 }),
    );
    const observed = await driveInk(
      async (interaction) =>
        setupAgent(dependencies, guest, { ...context, interaction }),
      [],
    );

    expect({
      status: observed.result.pairing.status,
      token: observed.result.pairing.token?.disclose(true),
      expiresAt: observed.result.pairing.expiresAt,
      started: context.mutation.started,
    }).toEqual({
      status: 'created',
      token,
      expiresAt: undefined,
      started: false,
    });
    expect(observed.output).toContain('pairing');
    expect(observed.output).not.toContain(token);
    expect(observed.output).not.toContain('undefined');
  });

  it('should mint zero codes when omitted and exactly one when requested', async () => {
    await using directory = await mkdtempDisposable(
      join(tmpdir(), 'open-agent-setup-t3-'),
    );
    const token = 'setup-t3-requested-pairing';
    const sprite = createFilesystemSprite({
      root: directory.path,
      execute: async (_file, args = []) => ({
        stdout: args.includes('/usr/bin/id')
          ? '1000'
          : args.includes('--help')
            ? '--log-level --no-browser'
            : args.includes('pair')
              ? `Token: ${token}\nExpires: 2099-01-01T00:00:00Z\n`
              : '',
        stderr: '',
        exitCode: 0,
      }),
    });
    holdServices(sprite);
    const context: SetupContext = {
      ...workstationOf(sprite),
      options: {},
      input: {
        profile: DISABLED_NETWORK_PROFILE,
        sources: {},
        missing: [],
      },
      profile: DISABLED_NETWORK_PROFILE,
      persistsProfile: false,
      mutation: { started: false },
    };

    const ordinary = await setupAgent(
      dependencies,
      await context.connection.guest(),
      context,
    );

    expect(ordinary).toEqual({
      service: 'configured',
      pairing: { status: 'not requested' },
    });
    expect(context.mutation.started).toBe(true);
    const calls = vi.mocked(sprite.execFile).mock.calls;
    expect(calls.filter(([, args]) => args?.includes('pair'))).toHaveLength(0);

    context.options = { withPairCode: true };
    context.mutation.started = false;
    const requested = await setupAgent(
      dependencies,
      await context.connection.guest(),
      context,
    );

    expect(requested).toMatchObject({
      pairing: {
        status: 'created',
        expiresAt: '2099-01-01T00:00:00Z',
        token: expect.any(PairingSecret),
      },
    });
    expect(requested.pairing.token?.disclose(true)).toBe(token);
    expect(context.mutation.started).toBe(false);
    expect(calls.filter(([, args]) => args?.includes('pair'))).toHaveLength(1);
  });
});

/**
 * builds a setup context over a guest that runs nothing
 * @param options parsed setup flags
 * @param root isolated guest filesystem root
 * @param execute native command response boundary, when the scenario needs one
 * @returns the context and its guest
 */
async function quietSetup(
  options: SetupContext['options'],
  root = tmpdir(),
  execute?: Parameters<typeof createFilesystemSprite>[0]['execute'],
): Promise<{ context: SetupContext; guest: GuestChannel }> {
  const sprite = createFilesystemSprite({
    root,
    execute,
  });
  const context: SetupContext = {
    ...workstationOf(sprite),
    options,
    input: {
      profile: DISABLED_NETWORK_PROFILE,
      sources: {},
      missing: [],
    },
    profile: DISABLED_NETWORK_PROFILE,
    persistsProfile: false,
    mutation: { started: false },
  };

  return { context, guest: await context.connection.guest() };
}
