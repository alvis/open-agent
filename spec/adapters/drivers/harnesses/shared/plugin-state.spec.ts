import { mkdtempDisposable, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  CLAUDE_INVENTORY,
  CLAUDE_PLUGIN_STATE,
} from '#adapters/drivers/harnesses/claude/paths';
import { claudePlugins } from '#adapters/drivers/harnesses/claude/plugins';
import {
  enabledSelections,
  installedPlugins,
  marketplaceMatches,
  marketplaces,
} from '#adapters/drivers/harnesses/shared/plugin-state';

import {
  createFilesystemSprite,
  executeNativeConfiguration,
  guestOf,
} from '../../../../mocks/sprites';

import type { ExecResult, Sprite } from '@fly/sprites';

const inventories = { claude: CLAUDE_INVENTORY };
const applyClaudePlugins = claudePlugins.apply;

describe('fn:enabledSelections', () => {
  it('should refuse selected-plugin evidence when the native inventory is malformed', () => {
    const result = enabledSelections(
      { stdout: '{invalid', stderr: '', exitCode: 0 },
      CLAUDE_INVENTORY,
      ['chosen@market'],
    );

    expect(result).toBe(false);
  });
});

describe('fn:installedPlugins', () => {
  it('should map Claude native inventory identities and enablement', () => {
    expect(
      installedPlugins(
        '[{"id":"claude@market","enabled":true},{"id":"disabled@market","enabled":false}]',
        CLAUDE_INVENTORY,
      ),
    ).toEqual([
      { id: 'claude@market', enabled: true },
      { id: 'disabled@market', enabled: false },
    ]);
  });

  it('should reject partial inventories instead of accepting missing or invalid native fields', () => {
    for (const output of [
      '{}',
      '[null]',
      '[{"id":3,"enabled":true}]',
      '[{"id":"plugin","enabled":"yes"}]',
    ]) {
      expect(() => installedPlugins(output, CLAUDE_INVENTORY)).toThrow(
        expect.objectContaining({ code: 'PROVIDER' }),
      );
    }
  });

  it('should keep invalid native JSON private while classifying the provider failure', () => {
    for (const harness of ['claude'] as const) {
      expect(() =>
        installedPlugins('{private-body', inventories[harness]),
      ).toThrow(
        expect.objectContaining({
          code: 'PROVIDER',
          cause: expect.any(SyntaxError),
          causeVisibility: 'private',
          message: expect.not.stringContaining('private-body'),
        }),
      );
    }
  });
});

describe('fn:marketplaceMatches', () => {
  it('should compare native marketplace names and equivalent GitHub repository identities without accepting unrelated values', () => {
    expect(marketplaceMatches({ name: 'selected' }, 'selected')).toBe(true);
    expect(
      marketplaceMatches(
        { name: 'other', repo: 'https://github.com/Owner/Repo.git' },
        'owner/repo/',
      ),
    ).toBe(true);
    expect(
      marketplaceMatches(
        { marketplaceSource: { source: 'OWNER/REPO' } },
        'https://github.com/owner/repo',
      ),
    ).toBe(true);
    expect(marketplaceMatches({ repo: 'owner/other' }, 'owner/repo')).toBe(
      false,
    );
    expect(marketplaceMatches({ repo: 1 }, 'owner/repo')).toBe(false);
    expect(marketplaceMatches({ marketplaceSource: {} }, 'owner/repo')).toBe(
      false,
    );
    expect(marketplaceMatches(null, 'owner/repo')).toBe(false);
  });
});

describe('fn:marketplaces', () => {
  it('should read the native inventory format and reject malformed records', () => {
    const record = { name: 'selected', repo: 'owner/repo' };

    expect(marketplaces(JSON.stringify([record]), CLAUDE_INVENTORY)).toEqual([
      record,
    ]);
    for (const output of ['{}', '[null]']) {
      expect(() => marketplaces(output, CLAUDE_INVENTORY)).toThrow(
        expect.objectContaining({ code: 'PROVIDER' }),
      );
    }
  });

  it('should keep invalid marketplace JSON as a private cause', () => {
    for (const harness of ['claude'] as const) {
      expect(() => marketplaces('{private-body', inventories[harness])).toThrow(
        expect.objectContaining({
          code: 'PROVIDER',
          cause: expect.any(SyntaxError),
          causeVisibility: 'private',
          message: expect.not.stringContaining('private-body'),
        }),
      );
    }
  });
});

const boundary = {
  execFile: async (file: string, args: string[] = []): Promise<ExecResult> => {
    const harness = args.includes('claude') ? 'claude' : undefined;
    if (harness && args.includes('plugin') && args.includes('list')) {
      const identities = [
        { id: `selected@${harness}-market`, enabled: true },
        { id: `previous@${harness}-market`, enabled: true },
        { id: 'unrelated@user-market', enabled: true },
      ];
      const response = args.includes('marketplace') ? [] : identities;

      return { stdout: JSON.stringify(response), stderr: '', exitCode: 0 };
    }

    return executeNativeConfiguration(file, args);
  },
} satisfies Partial<Sprite>;

describe('independent native plugin selection', () => {
  it('should persist only the selected identities', async () => {
    await using directory = await mkdtempDisposable(
      join(tmpdir(), 'open-agent-plugins-'),
    );
    const sprite = createFilesystemSprite({
      root: directory.path,
      execute: boundary.execFile,
    });
    const filesystem = sprite.filesystem();
    await filesystem.mkdir('/opt/open-agent', { recursive: true });
    await filesystem.writeFile(
      CLAUDE_PLUGIN_STATE,
      JSON.stringify(['previous@claude-market', 'missing@claude-market']),
    );
    const emptyActions = {
      marketplaces: [],
      removeMarketplaces: [],
      disablePlugins: [],
      uninstallPlugins: [],
    };

    await applyClaudePlugins(guestOf(sprite), {
      ...emptyActions,
      plugins: ['selected@claude-market'],
    });

    expect(
      JSON.parse(
        await readFile(join(directory.path, CLAUDE_PLUGIN_STATE), 'utf8'),
      ),
    ).toEqual(['previous@claude-market', 'selected@claude-market']);
  });
});
