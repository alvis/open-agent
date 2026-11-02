import { describe, expect, it, vi } from 'vitest';

import {
  hasActions,
  hasExplicitPluginActions,
  normalizePluginOptions,
  resolvePluginActions,
  validateMarketplaceSources,
} from '#application/plugins';

import { pluginFlags } from '../fixtures/plugin-flags';

import { dependencies } from '../mocks/dependencies';

import type { CommandOptions } from '#application/contracts';
import type { HarnessPluginActions } from '#application/plugins';
import type { HostPorts } from '#application/ports/host';
import type { HarnessId } from '#domain/ids';

const emptyActions = {
  marketplaces: [],
  plugins: [],
  removeMarketplaces: [],
  disablePlugins: [],
  uninstallPlugins: [],
};

/**
 * resolves parsed plugin flags the way create and setup do
 * @param options parsed plugin flags
 * @param harnesses selected harnesses
 * @returns native actions for each harness
 */
function resolveFlags(
  options: CommandOptions,
  harnesses?: readonly HarnessId[],
): HarnessPluginActions {
  return resolvePluginActions(normalizePluginOptions(options), harnesses);
}

/**
 * checks parsed plugin flags for explicit native actions
 * @param options parsed plugin flags
 * @returns whether explicit native plugin actions were requested
 */
function hasExplicitFlags(options: CommandOptions): boolean {
  return hasExplicitPluginActions(normalizePluginOptions(options));
}

describe('fn:normalizePluginOptions', () => {
  it('should mark every harness skipped by --no-plugins as one kind', () => {
    expect(normalizePluginOptions({ plugins: false })).toMatchObject({
      kind: 'skipped',
      harnesses: {
        claude: { skipped: false, marketplaces: [] },
      },
    });
    expect(
      normalizePluginOptions(pluginFlags({ claudePlugins: false })),
    ).toMatchObject({
      kind: 'selected',
      harnesses: { claude: { skipped: true } },
    });
  });
});

describe('fn:resolvePluginActions', () => {
  it('should preserve harness actions', () => {
    const selections = pluginFlags({
      claudeMarketplace: ['claude/source'],
      claudePlugin: ['alpha@claude'],
      removeClaudeMarketplace: ['claude-old'],
      uninstallClaudePlugin: ['claude-gone'],
    });

    expect(resolveFlags(selections)).toEqual({
      claude: {
        marketplaces: ['claude/source'],
        plugins: ['alpha@claude'],
        removeMarketplaces: ['claude-old'],
        disablePlugins: [],
        uninstallPlugins: ['claude-gone'],
      },
    });
    expect(resolveFlags({ plugins: false })).toEqual({
      claude: emptyActions,
    });
    expect(resolveFlags(pluginFlags({ claudePlugins: false }))).toEqual({
      claude: emptyActions,
    });
  });

  it('should reject skips that conflict with explicit changes', () => {
    const conflicts: CommandOptions[] = [
      pluginFlags({ plugins: false, claudePlugin: ['alpha@market'] }),
      pluginFlags({
        claudePlugins: false,
        claudeMarketplace: ['claude/source'],
      }),
    ];

    for (const options of conflicts) {
      expect(() => resolveFlags(options)).toThrow(
        expect.objectContaining({ code: 'USAGE' }),
      );
    }
  });

  it('should refuse actions for an unselected harness', () => {
    expect(() =>
      resolveFlags(pluginFlags({ claudePlugin: ['alpha@market'] }), []),
    ).toThrow(expect.objectContaining({ code: 'USAGE' }));
  });
});

describe('fn:hasActions', () => {
  it('should distinguish every native action from preserving existing state', () => {
    expect([
      hasActions(emptyActions),
      hasActions({ ...emptyActions, marketplaces: ['market'] }),
      hasActions({ ...emptyActions, plugins: ['plugin@market'] }),
      hasActions({ ...emptyActions, removeMarketplaces: ['market'] }),
      hasActions({ ...emptyActions, disablePlugins: ['plugin@market'] }),
      hasActions({ ...emptyActions, uninstallPlugins: ['plugin@market'] }),
    ]).toEqual([false, true, true, true, true, true]);
    expect([
      hasExplicitFlags({}),
      hasExplicitFlags({ plugins: false }),
      hasExplicitFlags(pluginFlags({ claudePlugin: [] })),
      hasExplicitFlags(
        pluginFlags({ uninstallClaudePlugin: ['plugin@market'] }),
      ),
    ]).toEqual([false, false, false, true]);
  });
});

describe('fn:validateMarketplaceSources', () => {
  const marketplaces = {
    classify: vi.fn<HostPorts['marketplaces']['classify']>(
      async ({ source, harness }) => ({
        source,
        harness,
        compatibility: 'supported',
        marketplaceName: 'market',
        ...(source === 'owner/populated' ? { pluginNames: ['selected'] } : {}),
        reason: 'Compatible manifest',
      }),
    ),
  } satisfies HostPorts['marketplaces'];
  const verifiedDependencies = {
    ...dependencies,
    host: { ...dependencies.host, marketplaces },
  };

  it.each(['https://example.test/empty', 'owner/populated'])(
    'should accept compatible sources and verify their selected plugins: %s',
    async (source) => {
      await expect(
        validateMarketplaceSources(verifiedDependencies, {
          actions: {
            claude: {
              ...emptyActions,
              marketplaces: [source],
              plugins: source === 'owner/populated' ? ['selected@market'] : [],
            },
          },
          requireSelectedPluginCoverage: true,
        }),
      ).resolves.toBeUndefined();
    },
  );

  it('should reject credential-bearing and unsupported sources before network access', async () => {
    await expect(
      validateMarketplaceSources(dependencies, {
        actions: { claude: emptyActions },
        requireSelectedPluginCoverage: true,
      }),
    ).resolves.toBeUndefined();
    await expect(
      validateMarketplaceSources(dependencies, {
        actions: {
          claude: {
            ...emptyActions,
            marketplaces: [
              'https://private-user:private-password@example.test/source',
            ],
          },
        },
      }),
    ).rejects.toMatchObject({
      code: 'INPUT',
      message: expect.not.stringMatching(/private-user|private-password/),
    });
    await expect(
      validateMarketplaceSources(dependencies, {
        actions: {
          claude: { ...emptyActions, marketplaces: ['not-a-repository'] },
        },
      }),
    ).rejects.toEqual(expect.objectContaining({ code: 'INPUT' }));
    await expect(
      validateMarketplaceSources(dependencies, {
        actions: {
          claude: { ...emptyActions, plugins: ['absent@market'] },
        },
        requireSelectedPluginCoverage: true,
      }),
    ).rejects.toEqual(expect.objectContaining({ code: 'INPUT' }));
  });
});
