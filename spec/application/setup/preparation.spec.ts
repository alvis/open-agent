import { mkdtempDisposable } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { ENVIRONMENT_PATH } from '#adapters/guest/platform/layout';
import { prepareGuestSection } from '#application/setup/preparation';
import { summarizeProfile } from '#domain/recorded';

import { environmentOf } from '../../fixtures/environment';
import { DISABLED_NETWORK_PROFILE } from '../../fixtures/profile';
import { dependencies, dependenciesWith } from '../../mocks/dependencies';
import { createFilesystemSprite, workstationOf } from '../../mocks/sprites';

import type { WorkstationProfile } from '#domain/profile';

// The transport stand-in keeps real setup sessions over isolated guest files.
vi.mock(
  '#adapters/guest/platform/session/open',
  async () => import('../../mocks/session'),
);

describe('fn:prepareGuestSection', () => {
  it.each([
    { release: undefined, expected: 'stable' },
    { release: 'nightly', expected: 'nightly' },
  ])(
    'should resolve a declared release before reporting a channel change (release=$expected)',
    async ({ release, expected }) => {
      await using directory = await mkdtempDisposable(
        join(tmpdir(), 'open-agent-prepared-release-'),
      );
      const sprite = createFilesystemSprite({ root: directory.path });
      await sprite
        .filesystem()
        .writeFile(
          ENVIRONMENT_PATH,
          JSON.stringify(environmentOf(DISABLED_NETWORK_PROFILE)),
        );
      const target = workstationOf(sprite);
      const prepared = await prepareGuestSection(dependencies, {
        ...target,
        supplied: { options: { agentRelease: release } },
        sources: { processEnv: {}, fileEnv: {} },
        section: 'agent',
        options: { release, nonInteractive: true },
        mutation: { started: false },
      });

      expect({
        changed: prepared.context.isReleaseChanged,
        channel: prepared.context.profile.options.agentRelease,
        persisted: (await dependencies.guest.environment.find(prepared.guest))
          ?.profile.options.agentRelease,
      }).toEqual({ changed: true, channel: expected, persisted: expected });
      await target.connection.close();
    },
  );

  it('should preserve a ready profile and its current session when the section changes no selection', async () => {
    await using directory = await mkdtempDisposable(
      join(tmpdir(), 'open-agent-preparation-preserved-'),
    );
    const sprite = createFilesystemSprite({ root: directory.path });
    const before = JSON.stringify(environmentOf(DISABLED_NETWORK_PROFILE));
    await sprite.filesystem().writeFile(ENVIRONMENT_PATH, before);
    const target = workstationOf(sprite);
    const mutation = { started: false };
    const prepared = await prepareGuestSection(dependencies, {
      ...target,
      supplied: { options: {} },
      sources: { processEnv: {}, fileEnv: {} },
      section: 'tools',
      options: { nonInteractive: true },
      mutation,
    });

    expect({
      connection: prepared.context.connection,
      persistsProfile: prepared.context.persistsProfile,
      started: mutation.started,
      recorded: await sprite.filesystem().readFile(ENVIRONMENT_PATH, 'utf8'),
    }).toEqual({
      connection: target.connection,
      persistsProfile: false,
      started: false,
      recorded: before,
    });
    await target.connection.close();
  });

  it('should prepare an unrecorded workstation for full recovery without prematurely marking it configured', async () => {
    await using directory = await mkdtempDisposable(
      join(tmpdir(), 'open-agent-unrecorded-'),
    );
    const sprite = createFilesystemSprite({ root: directory.path });
    const target = workstationOf(sprite);
    const workstation = {
      ...target.workstation,
      metadata: {
        ...target.workstation.metadata,
        profile: summarizeProfile(DISABLED_NETWORK_PROFILE),
      },
    };
    const mutation = { started: false };

    const prepared = await prepareGuestSection(dependencies, {
      ...target,
      workstation,
      supplied: { options: {} },
      sources: { processEnv: {}, fileEnv: {} },
      section: 'all',
      options: {
        nonInteractive: true,
        localCredentials: false,
      },
      mutation,
    });

    expect({
      profile: prepared.context.profile,
      persistsProfile: prepared.context.persistsProfile,
      releaseChanged: prepared.context.isReleaseChanged,
      started: mutation.started,
      recorded: await dependencies.guest.environment.find(prepared.guest),
    }).toEqual({
      profile: {
        ...DISABLED_NETWORK_PROFILE,
        options: {
          ...DISABLED_NETWORK_PROFILE.options,
          agentRelease: 'stable',
        },
      },
      persistsProfile: true,
      releaseChanged: true,
      started: false,
      recorded: undefined,
    });
    await target.connection.close();
  });

  it('should preserve persistence failures without closing the session', async () => {
    await using directory = await mkdtempDisposable(
      join(tmpdir(), 'open-agent-preparation-failure-'),
    );
    const profile: WorkstationProfile = DISABLED_NETWORK_PROFILE;
    const sprite = createFilesystemSprite({ root: directory.path });
    await sprite
      .filesystem()
      .writeFile(ENVIRONMENT_PATH, JSON.stringify(environmentOf(profile)));
    const target = workstationOf(sprite);
    const close = vi.spyOn(target.connection, 'close');
    const failure = new Error('guest storage is read-only');
    const wired = dependenciesWith({
      guest: {
        ...dependencies.guest,
        environment: {
          ...dependencies.guest.environment,
          writeProfile: async () => {
            throw failure;
          },
        },
      },
    });
    const mutation = { started: false };

    await expect(
      prepareGuestSection(wired, {
        ...target,
        supplied: { options: { updateDueIntervalDays: 2 } },
        sources: { processEnv: {}, fileEnv: {} },
        section: 'tools',
        options: { updateDueDays: 2, nonInteractive: true, yes: true },
        mutation,
      }),
    ).rejects.toBe(failure);

    expect({
      closes: close.mock.calls,
      started: mutation.started,
      recorded: (
        await dependencies.guest.environment.find(
          await target.connection.guest(),
        )
      )?.profile,
    }).toEqual({
      closes: [],
      started: true,
      recorded: profile,
    });
    await target.connection.close();
  });
});
