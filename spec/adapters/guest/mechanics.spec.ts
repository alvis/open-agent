import { mkdtempDisposable } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { createGuestMechanics } from '#adapters/guest/mechanics';
import { defaults } from '#composition/defaults';
import { registry } from '#composition/registry';
import { OPEN_AGENT_VERSION } from '#kernel/version';

import { DISABLED_NETWORK_PROFILE } from '../../fixtures/profile';
import { createFilesystemSprite, guestOf } from '../../mocks/sprites';

import type { OsRelease } from '#domain/guest';

const RELEASE: OsRelease = {
  family: 'debian',
  id: 'debian',
  versionId: '12',
  codename: 'bookworm',
  arch: 'x86_64',
  libc: 'glibc',
};

describe('fn:createGuestMechanics', () => {
  it('should assemble a setup plan for the selected agent and guest release', async () => {
    const mechanics = createGuestMechanics({ registry, defaults });

    const assembly = await mechanics.plan.assemble({
      provider: registry.providers.sprite,
      profile: DISABLED_NETWORK_PROFILE,
      release: RELEASE,
      version: OPEN_AGENT_VERSION,
      setupAt: '2026-10-26T00:00:00Z',
    });

    expect(assembly).toEqual(
      expect.objectContaining({
        environment: expect.objectContaining({
          profile: DISABLED_NETWORK_PROFILE,
          setup: { state: 'incomplete', skipped: [] },
          agent: expect.objectContaining({
            id: DISABLED_NETWORK_PROFILE.agent,
          }),
        }),
        steps: expect.arrayContaining([
          expect.objectContaining({
            id: 'environment',
            component: 'environment',
          }),
        ]),
      }),
    );
  });

  it('should inspect the selected agent environment through its guest probe', async () => {
    await using directory = await mkdtempDisposable(
      join(tmpdir(), 'open-agent-mechanics-'),
    );
    const guest = guestOf(
      createFilesystemSprite({
        root: directory.path,
        execute: async () => ({
          exitCode: 0,
          stdout: '{"serverVersion":"2.3.4","label":"test-workstation"}\n200',
          stderr: '',
        }),
      }),
    );
    const mechanics = createGuestMechanics({ registry, defaults });

    await expect(
      mechanics.native.inspectAgentEnvironment(guest),
    ).resolves.toEqual({
      ok: true,
      serverVersion: '2.3.4',
      label: 'test-workstation',
    });
  });
});
