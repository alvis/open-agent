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
import { ENVIRONMENT_PATH } from '#adapters/guest/platform/layout';
import { setupWorkstation } from '#application/setup';
import { summarizeProfile } from '#domain/recorded';

import { OPEN_AGENT_VERSION } from '#kernel/version';

import { environmentOf } from '../../fixtures/environment';
import { driveInk } from '../../fixtures/ink';
import { DISABLED_NETWORK_PROFILE } from '../../fixtures/profile';
import { dependencies } from '../../mocks/dependencies';
import {
  createFilesystemSprite,
  providerOf,
  writtenPaths,
} from '../../mocks/sprites';

import type { Sprite } from '@fly/sprites';

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
  it('should return from workstation selection to sections, then sets up the network', async () => {
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
      vi.spyOn(client, 'listAllSprites').mockResolvedValue([sprite]);
      vi.spyOn(client, 'getSprite').mockResolvedValue(sprite);
      await recordEnvironment(sprite);
      const observed = await driveInk(
        async (interaction) =>
          setupWorkstation(dependencies, {
            request: {
              command: 'setup',
              options: {
                section: 'network',
                localCredentials: false,
              },
            },
            provider: providerOf(client),
            interaction,
          }),
        [
          { waitFor: 'Select a workstation', input: '\x1b' },
          { waitFor: 'Choose setup section', input: 'Network' },
          { waitFor: 'Search: Network', input: '\r' },
          { waitFor: 'Select a workstation', input: '\r' },
        ],
      );

      expect(observed.matchedSteps, observed.output).toBe(4);
      expect(observed.result).toMatchObject({
        ok: true,
        data: { section: 'network', network: { status: 'disabled' } },
      });
      expect(writtenPaths(sprite)).toEqual([ENVIRONMENT_PATH]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }, 15_000);
});
