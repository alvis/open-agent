import { mkdtempDisposable } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { inspectClaude } from '#adapters/drivers/harnesses/claude/inspection';
import { CLAUDE_SETTINGS } from '#adapters/drivers/harnesses/claude/paths';
import { HOME } from '#adapters/guest/platform/account';

import {
  createFilesystemSprite,
  createNativeCommandExecutor,
  guestOf,
} from '../../../../mocks/sprites';

describe('fn:inspectClaude', () => {
  it.each([
    {
      name: 'no settings or native credential',
      settings: undefined,
      authenticated: false,
      configuration: {
        pluginListAvailable: true,
        awakeHooksInstalled: false,
        authentication: 'not-configured',
      },
    },
    {
      name: 'a native credential with settings',
      settings: { env: {} },
      authenticated: true,
      configuration: {
        pluginListAvailable: false,
        awakeHooksInstalled: false,
        authentication: 'native',
      },
    },
  ])('should report $name from the guest configuration', async (scenario) => {
    await using directory = await mkdtempDisposable(
      join(tmpdir(), 'open-agent-claude-inspection-'),
    );
    const sprite = createFilesystemSprite({
      root: directory.path,
      execute: createNativeCommandExecutor([
        {
          argv: ['claude', 'plugin', 'list', '--json'],
          result: {
            stdout: '[]',
            stderr: '',
            exitCode: scenario.configuration.pluginListAvailable ? 0 : 1,
          },
        },
      ]),
    });
    const files = sprite.filesystem();
    if (scenario.settings) {
      await files.writeJSON(CLAUDE_SETTINGS, scenario.settings);
    }
    if (scenario.authenticated) {
      await files.writeFile(`${HOME}/.claude/.credentials.json`, '{}');
    }

    const inspection = await inspectClaude(guestOf(sprite));

    expect(inspection).toEqual({
      configuration: scenario.configuration,
      selectedPlugins: [],
      pluginsEnabled: scenario.configuration.pluginListAvailable,
      evidence: undefined,
    });
  });
});
