import { describe, expect, it } from 'vitest';

import { createPreflightSummary } from '#application/create/reminders';

import { DISABLED_NETWORK_PROFILE } from '../../fixtures/profile';

import { dependencies } from '../../mocks/dependencies';

import type { ResolvedInputs } from '#application/input/types';

const baseInput: ResolvedInputs = {
  profile: DISABLED_NETWORK_PROFILE,
  sources: {},
  missing: [],
};

describe('fn:createPreflightSummary', () => {
  it('should describe a longer maintenance interval', () => {
    const profile = DISABLED_NETWORK_PROFILE;
    const summary = createPreflightSummary(dependencies, {
      ...baseInput,
      profile: {
        ...profile,
        options: { ...profile.options, updateDueIntervalDays: 3 },
      },
    });

    expect(summary.reminders).toEqual(
      expect.arrayContaining([expect.stringMatching(/3 days have passed/)]),
    );
  });

  it('should provide applicable readiness checks and reminders without exposing input secrets', () => {
    const summary = createPreflightSummary(dependencies, {
      ...baseInput,
      providerToken: 'provider-secret',
    });

    expect(summary).toEqual({
      checks: [
        expect.stringMatching(/Required inputs/),
        expect.stringMatching(/Sprite prerequisites/),
      ],
      reminders: [
        expect.stringMatching(/hourly.*a day has passed/),
        expect.stringMatching(/native sign-in/),
      ],
    });
    expect(JSON.stringify(summary)).not.toMatch(/provider-secret/);
  });
});
