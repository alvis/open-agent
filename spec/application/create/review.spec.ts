import { describe, expect, it, vi } from 'vitest';

import { confirmCreation, reviewCreatePlan } from '#application/create/review';
import { OperationContext, withOperation } from '#kernel/operation';

import { DISABLED_NETWORK_PROFILE } from '../../fixtures/profile';

import { dependencies } from '../../mocks/dependencies';

import type { Interaction } from '#application/ports/interaction';
import type { StatusUpdate } from '#kernel/status';

const input = {
  profile: DISABLED_NETWORK_PROFILE,
  sources: {},
  missing: [],
};

describe('fn:confirmCreation', () => {
  it.each([
    {
      provision: false,
      expected: expect.stringMatching(/cancelled/),
      prompts: 1,
    },
    { provision: true, expected: undefined, prompts: 1 },
  ])(
    'should honor provision consent: %j',
    async ({ provision, expected, prompts }) => {
      const interaction = {
        confirm: vi.fn<Interaction['confirm']>(async () => provision),
      } satisfies Partial<Interaction>;

      const declined = await confirmCreation(
        dependencies,
        {
          name: 'box',
          request: { command: 'create', options: {} },
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
        },
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
