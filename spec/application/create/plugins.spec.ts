import { describe, expect, it } from 'vitest';

import {
  describePluginSelections,
  promptCreatePluginOptions,
} from '#application/create/plugins';

import {
  normalizePluginOptions,
  resolvePluginActions,
} from '#application/plugins';

import { driveInk } from '../../fixtures/ink';
import { pluginFlags } from '../../fixtures/plugin-flags';

describe('fn:promptCreatePluginOptions', () => {
  it('should add independent native choices and preserve them when an input goes back', async () => {
    const observed = await driveInk(
      async (interaction) =>
        promptCreatePluginOptions({}, ['claude'], interaction),
      [
        { waitFor: 'Configure Claude marketplaces or plugins', input: 'y' },
        { waitFor: 'Claude plugin choices', input: '\r' },
        { waitFor: 'Claude marketplace source/ref', input: 'owner/source' },
        { waitFor: 'owner/source', input: '\r' },
        { waitFor: 'Claude plugin choices', input: 'Install' },
        { waitFor: 'Search: Install', input: '\r' },
        { waitFor: 'Claude native plugin identity', input: 'selected@market' },
        { waitFor: 'selected@market', input: '\r' },
        { waitFor: 'Claude plugin choices', input: '\r' },
        { waitFor: 'Claude marketplace source/ref', input: '\u001b' },
        { waitFor: 'Claude plugin choices', input: 'Done' },
        { waitFor: 'Search: Done', input: '\r' },
      ],
    );

    expect(observed.matchedSteps, observed.output).toBe(12);
    expect(observed.result.harnesses.claude).toMatchObject({
      marketplaces: ['owner/source'],
      plugins: ['selected@market'],
    });
  });

  it('should not invent marketplace setup under --yes', async () => {
    const sources = ['selected-owner/selected-repo'];
    const selected = pluginFlags({ yes: true, claudeMarketplace: sources });
    const observed = await driveInk(
      async (interaction) =>
        promptCreatePluginOptions(selected, ['claude'], interaction),
      [],
    );

    expect(observed.matchedSteps).toBe(0);
    expect(observed.result.harnesses.claude.marketplaces).toEqual(sources);
  });

  it('should keep optional plugin choices interactive without --yes', async () => {
    const observed = await driveInk(
      async (interaction) =>
        promptCreatePluginOptions({}, ['claude'], interaction),
      [{ waitFor: 'Configure Claude marketplaces or plugins', input: 'n' }],
    );

    expect(observed.matchedSteps, observed.output).toBe(1);
    expect(observed.result.harnesses.claude.marketplaces).toEqual([]);
  });
});

describe('fn:describePluginSelections', () => {
  it('should show absent and selected native actions independently', () => {
    const plugins = resolvePluginActions(
      normalizePluginOptions({
        harnessPlugins: {
          claude: {
            marketplaces: ['owner/source'],
            plugins: ['plugin@market'],
          },
        },
      }),
    );

    expect(describePluginSelections(plugins, ['claude'])).toEqual([
      expect.stringMatching(/Claude.*owner\/source.*plugin@market/),
    ]);
    expect(
      describePluginSelections(
        resolvePluginActions(normalizePluginOptions({})),
        ['claude'],
      ),
    ).toEqual([expect.stringMatching(/Claude.*none.*none/)]);
  });
});
