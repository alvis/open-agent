import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { SpritesClient } from '@fly/sprites';
import { describe, expect, it, vi } from 'vitest';

import {
  MANAGED_LABEL,
  SCHEMA_LABEL,
  mergeMetadataLabels,
} from '#adapters/drivers/providers/sprite/labels';
import {
  ENVIRONMENT_PATH,
  UPDATE_STATUS_PATH,
} from '#adapters/guest/platform/layout';
import { setupWorkstation } from '#application/setup';
import { setupTools } from '#application/setup/tools';
import { summarizeProfile } from '#domain/recorded';

import { OPEN_AGENT_VERSION } from '#kernel/version';

import { environmentOf } from '../../fixtures/environment';
import { driveInk } from '../../fixtures/ink';
import { DISABLED_NETWORK_PROFILE } from '../../fixtures/profile';
import { dependencies } from '../../mocks/dependencies';
import {
  createFilesystemSprite,
  guestOf,
  providerOf,
  workstationOf,
  writtenPaths,
} from '../../mocks/sprites';

import type { Sprite } from '@fly/sprites';

import type { SetupContext } from '#application/setup/context';

// setup's root session is a framed guest shell only the live specs open
vi.mock(
  '#adapters/guest/platform/session/open',
  async () => import('../../mocks/session'),
);

/** the profile the set-up workstation recorded */
const PROFILE = DISABLED_NETWORK_PROFILE;

/**
 * records the environment of a set-up workstation
 * @param sprite sprite of the workstation
 */
async function recordEnvironment(sprite: Sprite): Promise<void> {
  await sprite
    .filesystem()
    .writeFile(ENVIRONMENT_PATH, JSON.stringify(environmentOf(PROFILE)));
}

describe('scoped setup', () => {
  it('should view recorded tool versions and declines an update without guest mutation', async () => {
    const root = await mkdtemp(join(tmpdir(), 'open-agent-setup-'));
    try {
      const sprite = createFilesystemSprite({ root });
      await recordEnvironment(sprite);
      await sprite.filesystem().writeFile(
        UPDATE_STATUS_PATH,
        JSON.stringify({
          finishedAt: '2026-10-01T00:00:00Z',
          lastSuccess: '2026-10-01T00:00:00Z',
          tools: [
            {
              name: 'node',
              manager: 'brew',
              required: true,
              outcome: 'installed',
              to: '24.9.0',
            },
          ],
        }),
      );
      const context: SetupContext = {
        ...workstationOf(sprite),
        options: { localCredentials: false },
        input: {
          profile: DISABLED_NETWORK_PROFILE,
          runtimeEnv: {},
          sources: {},
          missing: [],
        },
        profile: DISABLED_NETWORK_PROFILE,
        persistsProfile: false,
        isReleaseChanged: false,
        mutation: { started: false },
      };
      const observed = await driveInk(
        async (interaction) => {
          context.interaction = interaction;
          const versions = await setupTools(
            dependencies,
            guestOf(sprite),
            context,
          );
          const declined = await setupTools(
            dependencies,
            guestOf(sprite),
            context,
          );

          return { versions, declined };
        },
        [
          { waitFor: 'Managed tools', input: '\r' },
          { waitFor: 'Managed tools', input: 'Update tools now' },
          { waitFor: 'Search: Update tools now', input: '\r' },
          { waitFor: 'Install latest stable tools now', input: '\r' },
        ],
      );

      expect(observed.matchedSteps, observed.output).toBe(4);
      expect(observed.result.versions).toMatchObject({
        tools: {
          status: 'recorded versions',
          lastUpdate: { tools: [{ name: 'node', to: '24.9.0' }] },
        },
      });
      expect(observed.result.declined).toEqual({ tools: 'unchanged' });
      expect(writtenPaths(sprite)).toEqual([]);
      expect(context.mutation.started).toBe(false);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }, 15_000);

  it('should return from tools to sections, then skips Git identity without mutation', async () => {
    const root = await mkdtemp(join(tmpdir(), 'open-agent-setup-'));
    vi.stubEnv('HOME', root);
    try {
      const sprite = Object.assign(createFilesystemSprite({ root }), {
        id: 'sprite-temporary',
        organizationName: 'test',
        // set up by this release, so a section run leaves its labels as they are
        labels: mergeMetadataLabels([MANAGED_LABEL, SCHEMA_LABEL], {
          setup: 'ready',
          profile: summarizeProfile(PROFILE),
          version: OPEN_AGENT_VERSION,
        }),
      });
      const client = new SpritesClient('test-token');
      vi.spyOn(client, 'getSprite').mockResolvedValue(sprite);
      await recordEnvironment(sprite);
      const observed = await driveInk(
        async (interaction) =>
          setupWorkstation(dependencies, {
            request: {
              command: 'setup',
              machine: 'temporary',
              options: {
                section: 'tools',
                localCredentials: false,
                github: false,
                gitName: 'Ada',
                gitEmail: 'ada@example.test',
              },
            },
            provider: providerOf(client),
            interaction,
          }),
        [
          { waitFor: 'Managed tools', input: '\x1b' },
          { waitFor: 'Choose setup section', input: 'Git / Jujutsu' },
          { waitFor: 'Search: Git / Jujutsu', input: '\r' },
          { waitFor: 'Git commit identity', input: 'Skip Git' },
          { waitFor: 'Search: Skip Git', input: '\r' },
        ],
      );

      expect(observed.matchedSteps, observed.output).toBe(5);
      expect(observed.result).toMatchObject({
        ok: true,
        data: { section: 'git', gitIdentity: 'preserved' },
      });
      expect(writtenPaths(sprite)).toEqual([]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }, 15_000);

  it('should preserve Git identity when explicitly skipped without guest mutation', async () => {
    const root = await mkdtemp(join(tmpdir(), 'open-agent-setup-'));
    vi.stubEnv('HOME', root);
    try {
      const sprite = Object.assign(createFilesystemSprite({ root }), {
        id: 'sprite-temporary',
        organizationName: 'test',
        // set up by this release, so a section run leaves its labels as they are
        labels: mergeMetadataLabels([MANAGED_LABEL, SCHEMA_LABEL], {
          setup: 'ready',
          profile: summarizeProfile(PROFILE),
          version: OPEN_AGENT_VERSION,
        }),
      });
      const client = new SpritesClient('test-token');
      vi.spyOn(client, 'getSprite').mockResolvedValue(sprite);
      await recordEnvironment(sprite);

      const result = await setupWorkstation(dependencies, {
        request: {
          command: 'setup',
          machine: 'temporary',
          options: {
            section: 'git',
            localCredentials: false,
            github: false,
            gitIdentity: false,
          },
        },
        provider: providerOf(client),
      });

      expect(result).toMatchObject({
        ok: true,
        data: { section: 'git', gitIdentity: 'preserved' },
      });
      expect(writtenPaths(sprite)).toEqual([]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
