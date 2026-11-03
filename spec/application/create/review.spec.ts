import { describe, expect, it, vi } from 'vitest';

import { confirmCreation, reviewCreatePlan } from '#application/create/review';
import {
  normalizePluginOptions,
  resolvePluginActions,
} from '#application/plugins';
import { OperationContext, withOperation } from '#kernel/operation';

import { DISABLED_NETWORK_PROFILE } from '../../fixtures/profile';

import { dependencies } from '../../mocks/dependencies';

import type { Interaction } from '#application/ports/interaction';
import type { StatusUpdate } from '#kernel/status';

const plugins = resolvePluginActions(
  normalizePluginOptions({
    harnessPlugins: { claude: { plugins: ['selected@market'] } },
  }),
);
const input = {
  profile: DISABLED_NETWORK_PROFILE,
  runtimeEnv: {},
  sources: {},
  missing: [],
};

describe('fn:confirmCreation', () => {
  it.each([
    {
      trustPlugins: false,
      provision: false,
      expected: expect.stringMatching(/not accepted/),
      prompts: 1,
    },
    {
      trustPlugins: true,
      provision: false,
      expected: expect.stringMatching(/cancelled/),
      prompts: 2,
    },
    { trustPlugins: true, provision: true, expected: undefined, prompts: 2 },
  ])(
    'should honor native-code consent before provision consent: %j',
    async ({ trustPlugins, provision, expected, prompts }) => {
      const interaction = {
        confirm: vi.fn<Interaction['confirm']>(async ({ message }) =>
          message.includes('native marketplace') ? trustPlugins : provision,
        ),
      } satisfies Partial<Interaction>;

      const declined = await confirmCreation(
        dependencies,
        {
          name: 'box',
          request: { command: 'create', options: {} },
          plugins,
          profile: DISABLED_NETWORK_PROFILE,
        },
        interaction as Partial<Interaction> as Interaction,
      );

      expect(declined).toEqual(expected);
      expect(interaction.confirm.mock.calls).toHaveLength(prompts);
    },
  );
});

describe('fn:reviewCreatePlan', () => {
  it('should describe the selected network and optional identities without credentials', async () => {
    const status = vi.fn<(update: StatusUpdate) => void>();
    const operation = new OperationContext({
      signal: new AbortController().signal,
      onStatus: status,
    });
    const profile = {
      ...DISABLED_NETWORK_PROFILE,
      options: {
        ...DISABLED_NETWORK_PROFILE.options,
        idleTimeoutMinutes: 0,
      },
    };

    await withOperation(operation, async () =>
      reviewCreatePlan(dependencies, {
        values: { name: 'box', token: 'private-token' },
        input: {
          ...input,
          profile,
          githubToken: 'github-token',
          gitIdentity: {
            authorName: 'Author',
            authorEmail: 'author@example.test',
            committerName: 'Author',
            committerEmail: 'author@example.test',
          },
        },
        plugins,
        preflight: { checks: [], reminders: [] },
      }),
    );

    expect(status.mock.calls).toEqual([
      [
        {
          kind: 'info',
          message: expect.stringMatching(/No private network/),
        },
      ],
    ]);
    expect(JSON.stringify(status.mock.calls)).not.toMatch(
      /private-token|github-token/,
    );
  });
});
