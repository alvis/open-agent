import { describe, expect, it } from 'vitest';

import {
  readSetupSelection,
  resolveCreateSelection,
  resolveSetupSelection,
} from '#application/input/selection';
import { defaults } from '#composition/defaults';
import { defaultProfile } from '#domain/profile';

import { driveInk } from '../../fixtures/ink';
import { dependencies } from '../../mocks/dependencies';

import type { WorkstationProfile } from '#domain/profile';

describe('input source resolution', () => {
  it('should preserve the recorded and default selections under --yes without inventing features', async () => {
    const recorded: WorkstationProfile = {
      ...defaultProfile(defaults),
      harnesses: ['claude'],
    };
    const sources = { processEnv: {}, fileEnv: {} };
    const observed = await driveInk(async (interaction) => {
      const setup = await resolveSetupSelection(dependencies, {
        options: { yes: true },
        sources,
        interaction,
        recorded,
        section: 'all',
        supplied: readSetupSelection(dependencies, {
          options: { yes: true },
          sources,
          section: 'all',
        }).value,
      });
      const create = await resolveCreateSelection(dependencies, {
        options: { yes: true },
        sources,
        interaction,
      });

      return { setup: setup.candidate, create: create.candidate };
    }, []);

    expect(observed.matchedSteps).toBe(0);
    expect(observed.result.setup).toMatchObject({
      network: 'none',
      harnesses: recorded.harnesses,
    });
    expect(observed.result.create).toMatchObject({ network: 'none' });
  });

  it('should accept the default create selection through Enter at every prompt', async () => {
    const observed = await driveInk(
      async (interaction) =>
        resolveCreateSelection(dependencies, {
          options: {},
          sources: { processEnv: {}, fileEnv: {} },
          interaction,
        }),
      [
        { waitFor: 'Minimum CPUs', input: '\r' },
        { waitFor: 'Minimum memory (GB)', input: '\r' },
        { waitFor: 'Release channel', input: '\r' },
        { waitFor: 'Suspend after idle', input: '\r' },
      ],
    );

    expect(observed.matchedSteps, observed.output).toBe(4);
    expect(observed.result.candidate).toMatchObject({
      provider: 'sprite',
      harnesses: ['claude'],
      network: 'none',
      options: {
        minCpus: 2,
        minMemoryGb: 2,
        agentRelease: 'stable',
        idleTimeoutMinutes: 5,
      },
    });
  });
});
