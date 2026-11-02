import { describe, expect, it } from 'vitest';

import { createPreflightSummary } from '#application/create/reminders';

import { profileWith } from '../../fixtures/profile';

import { dependencies } from '../../mocks/dependencies';

import type { ResolvedInputs } from '#application/input/types';

const disabled = { cliproxyapi: false };

const baseInput: ResolvedInputs = {
  profile: profileWith(disabled),
  runtimeEnv: {},
  sources: {},
  missing: [],
};

describe('fn:createPreflightSummary', () => {
  it('should describe a longer maintenance interval', () => {
    const profile = profileWith(disabled);
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
    const native = createPreflightSummary(dependencies, baseInput);
    const enabled = createPreflightSummary(dependencies, {
      ...baseInput,
      profile: profileWith({ cliproxyapi: true }),
      githubToken: 'github-secret',
      gitIdentity: {
        authorName: 'Author',
        authorEmail: 'author@example.test',
        committerName: 'Committer',
        committerEmail: 'committer@example.test',
      },
    });

    expect(native).toEqual({
      checks: [
        expect.stringMatching(/Required inputs/),
        expect.stringMatching(/Sprite prerequisites/),
      ],
      reminders: [
        expect.stringMatching(/hourly.*a day has passed/),
        expect.stringMatching(/native sign-in/),
        expect.stringMatching(/Private GitHub access/),
        expect.stringMatching(/Git identity/),
      ],
    });
    expect(enabled).toEqual({
      checks: [
        expect.stringMatching(/Required inputs/),
        expect.stringMatching(/Sprite prerequisites/),
      ],
      reminders: [
        expect.stringMatching(/hourly.*a day has passed/),
        expect.stringMatching(/CLIProxyAPI authentication/),
      ],
    });
    expect(JSON.stringify(enabled)).not.toMatch(/github-secret/);
  });
});
