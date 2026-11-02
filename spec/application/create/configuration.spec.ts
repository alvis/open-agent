import { mkdtempDisposable } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { configureNewWorkstation } from '#application/create/configuration';
import { registry } from '#composition/registry';
import { Secret } from '#kernel/secret';

import { environmentOf } from '../../fixtures/environment';
import { DISABLED_NETWORK_PROFILE } from '../../fixtures/profile';

import { dependencies } from '../../mocks/dependencies';
import { standInSession } from '../../mocks/session';
import {
  createFilesystemSprite,
  guestOf,
  providerOf,
} from '../../mocks/sprites';

import type { Sprite } from '@fly/sprites';

import type { ApplicationDependencies } from '#application/ports/dependencies';
import type { SetupSession } from '#application/ports/session';
import type { WorkstationProfile } from '#domain/profile';

// the install plan is a guest run; only the configuration it hands over is under test
vi.mock(
  '#application/installation',
  () =>
    ({
      installWorkstation: vi.fn<
        typeof import('#application/installation').installWorkstation
      >(async (_mechanics, params) => {
        await params.beforeServices?.(await params.connection.guest());

        return environmentOf(params.profile);
      }),
    }) satisfies Pick<
      typeof import('#application/installation'),
      'installWorkstation'
    >,
);
vi.mock(
  '#application/installation/readiness',
  () =>
    ({
      markInstallationReady: vi.fn(async () => undefined),
    }) satisfies Pick<
      typeof import('#application/installation/readiness'),
      'markInstallationReady'
    >,
);

/**
 * stands in for the root setup session over the SDK mock
 * @param sprite SDK mock the session reaches
 * @returns a session that hands out the mock's guest channel
 */
function connectionOf(sprite: Sprite): SetupSession {
  const channel = guestOf(sprite);
  const root = standInSession(channel);

  return {
    ...root,
    open: async () => root,
    reopen: async () => root,
    lend: async () => root,
    close: async () => undefined,
    guest: async () => channel,
  } satisfies SetupSession;
}

/**
 * builds the guest mechanics with a stubbed workstation label and native
 * steps a test may replace
 * @returns the dependencies configuration runs on
 */
function labelStubbedDependencies(): Pick<
  ApplicationDependencies,
  'registry' | 'guest'
> {
  const { guest } = dependencies;

  return {
    registry,
    guest: {
      ...guest,
      label: { ...guest.label, write: vi.fn(async () => undefined) },
      native: {
        ...guest.native,
      },
    },
  };
}

describe('fn:configureNewWorkstation', () => {
  it('should enroll the selected network under the workstation hostname', async () => {
    await using directory = await mkdtempDisposable(
      join(tmpdir(), 'open-agent-configure-network-'),
    );
    const sprite = createFilesystemSprite({ root: directory.path });
    const calls: string[] = [];
    const profile = {
      ...DISABLED_NETWORK_PROFILE,
      harnesses: [],
    } satisfies WorkstationProfile;
    const connection = connectionOf(sprite);
    using enroll = vi
      .spyOn(registry.networks.none, 'enroll')
      .mockImplementation(async () => {
        calls.push('network enrolled');
      });

    const guest = await configureNewWorkstation(labelStubbedDependencies(), {
      provider: providerOf(sprite.client),
      connection,
      configuration: {
        hostname: 'box',
        profile,
      },
    });

    expect({
      guest,
      calls,
      enrollment: enroll.mock.calls,
    }).toEqual({
      guest: await connection.guest(),
      calls: ['network enrolled'],
      enrollment: [
        [expect.anything(), expect.objectContaining({ hostname: 'box' })],
      ],
    });
  });

  it('should apply selected GitHub configuration', async () => {
    await using directory = await mkdtempDisposable(
      join(tmpdir(), 'open-agent-configure-options-'),
    );
    const sprite = createFilesystemSprite({ root: directory.path });
    const calls: string[] = [];
    const wired = labelStubbedDependencies();
    const profile = {
      ...DISABLED_NETWORK_PROFILE,
      harnesses: ['claude'],
    } satisfies WorkstationProfile;
    const connection = connectionOf(sprite);
    using github = vi
      .spyOn(wired.guest.native, 'configureGithub')
      .mockImplementation(async () => {
        calls.push('github configured');
      });
    vi.spyOn(registry.harnesses.claude, 'configure').mockImplementation(
      async () => {
        calls.push('harness configured');
      },
    );
    vi.spyOn(registry.harnesses.claude.hooks, 'install').mockImplementation(
      async () => {
        calls.push('hook installed');
      },
    );

    const guest = await configureNewWorkstation(wired, {
      provider: providerOf(sprite.client),
      connection,
      configuration: {
        hostname: 'box',
        profile,
        githubToken: 'selected-github-token',
        githubHost: 'github.com',
      },
    });

    expect({
      guest,
      calls,
      github: github.mock.calls,
    }).toEqual({
      guest: await connection.guest(),
      calls: ['github configured', 'harness configured', 'hook installed'],
      github: [
        [
          expect.anything(),
          expect.any(Secret),
          expect.objectContaining({ hostname: 'github.com' }),
        ],
      ],
    });
  });
});
