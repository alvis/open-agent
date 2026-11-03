import { describe, expect, it } from 'vitest';

import { resolveCreateSelection } from '#application/input/selection';

import { driveInk } from '../../fixtures/ink';
import { dependencies } from '../../mocks/dependencies';

describe('input source resolution', () => {
  it('should preserve the default selection under --yes without inventing features', async () => {
    const sources = { processEnv: {}, fileEnv: {} };
    const observed = await driveInk(async (interaction) => {
      const create = await resolveCreateSelection(dependencies, {
        options: { yes: true },
        sources,
        interaction,
      });

      return { create: create.candidate };
    }, []);

    expect(observed.matchedSteps).toBe(0);
    expect(observed.result.create).toMatchObject({ network: 'none' });
  });

  it('should accept the default create selection without a prompt', async () => {
    const observed = await driveInk(
      async (interaction) =>
        resolveCreateSelection(dependencies, {
          options: {},
          sources: { processEnv: {}, fileEnv: {} },
          interaction,
        }),
      [],
    );

    expect(observed.matchedSteps, observed.output).toBe(0);
    expect(observed.result.candidate).toMatchObject({
      provider: 'sprite',
      harnesses: ['claude'],
      network: 'none',
    });
  });
});
