import { mkdtempDisposable, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import {
  setupAgent,
  setupGithub,
  stopService,
} from '#application/setup/sections';

import { PairingSecret } from '#kernel/pairing-secret';
import { revealSecret } from '#kernel/secret';

import { driveInk } from '../../fixtures/ink';
import { DISABLED_NETWORK_PROFILE } from '../../fixtures/profile';

import { dependencies, dependenciesWith } from '../../mocks/dependencies';
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
      isReleaseChanged: false,
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
    isReleaseChanged: false,
    mutation: { started: false },
  };

  return { context, guest: await context.connection.guest() };
}

describe('fn:setupGithub', () => {
  it.each([
    { github: false, expected: 'preserved' },
    { github: undefined, expected: 'skipped' },
  ] as const)(
    'should leave guest authentication unchanged when GitHub is $expected',
    async ({ github, expected }) => {
      vi.stubEnv('GH_TOKEN', undefined);
      vi.stubEnv('GITHUB_TOKEN', undefined);
      const { context, guest } = await quietSetup({
        github,
        localCredentials: false,
        nonInteractive: true,
      });

      expect({
        result: await setupGithub(dependencies, guest, context),
        started: context.mutation.started,
      }).toEqual({ result: { github: expected }, started: false });
    },
  );

  it('should configure the selected GitHub host and provider accounts with the resolved credential', async () => {
    await using directory = await mkdtempDisposable(
      join(tmpdir(), 'open-agent-github-selected-'),
    );
    const credential = join(directory.path, 'github-token');
    const configured = join(directory.path, 'native-authentication');
    await writeFile(credential, 'selected-github-secret');
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>(async (url) => {
        if (url !== 'https://github.example.test/api/v3/user') {
          throw new Error('Unexpected GitHub endpoint');
        }

        return Response.json({ login: 'selected-user' });
      }),
    );
    const { context, guest } = await quietSetup(
      {
        githubTokenSource: `file:${credential}`,
        githubHost: 'github.example.test',
        localCredentials: false,
        nonInteractive: true,
      },
      directory.path,
    );
    const wired = dependenciesWith({
      guest: {
        ...dependencies.guest,
        native: {
          ...dependencies.guest.native,
          configureGithub: async (_guest, secret, target) =>
            writeFile(
              configured,
              JSON.stringify({ token: revealSecret(secret), ...target }),
            ),
        },
      },
    });

    const result = await setupGithub(wired, guest, context);

    expect({
      result,
      started: context.mutation.started,
      native: JSON.parse(await readFile(configured, 'utf8')),
    }).toEqual({
      result: { github: 'configured' },
      started: true,
      native: {
        token: 'selected-github-secret',
        hostname: 'github.example.test',
        shellAccounts: ['sprite'],
      },
    });
  });
});

describe('fn:stopService', () => {
  it('should surface a provider stop failure while the service remains running', async () => {
    await using directory = await mkdtempDisposable(
      join(tmpdir(), 'open-agent-stop-refused-'),
    );
    const sprite = createFilesystemSprite({ root: directory.path });
    const services = holdServices(sprite);
    services.set('agent-service', {
      name: 'agent-service',
      cmd: '/bin/true',
      args: [],
      needs: [],
      state: { name: 'agent-service', status: 'running' },
    });
    const { connection } = workstationOf(sprite);
    const guest = await connection.guest();
    vi.spyOn(guest.services, 'stop').mockResolvedValue(false);

    await expect(stopService(guest, 'agent-service')).rejects.toMatchObject({
      code: 'PROVIDER',
      message: expect.stringContaining('agent-service'),
    });
    expect(services.get('agent-service')?.state?.status).toBe('running');
    await connection.close();
  });
});
