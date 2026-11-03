import { describe, expect, it } from 'vitest';

import { profileUpdateSelected } from '#application/setup/integrations';

import { DISABLED_NETWORK_PROFILE } from '../../fixtures/profile';

describe('fn:profileUpdateSelected machine requirements', () => {
  it.each([
    {
      requirement: 'CPU',
      options: {
        minCpus: DISABLED_NETWORK_PROFILE.options.minCpus + 1,
      },
    },
    {
      requirement: 'memory',
      options: {
        minMemoryGb: DISABLED_NETWORK_PROFILE.options.minMemoryGb + 1,
      },
    },
  ])(
    'should persist a changed $requirement minimum even for a tools section with no interval change',
    ({ options }) => {
      const profile = {
        ...DISABLED_NETWORK_PROFILE,
        options: { ...DISABLED_NETWORK_PROFILE.options, ...options },
      };

      expect(
        profileUpdateSelected('tools', profile, DISABLED_NETWORK_PROFILE),
      ).toBe(true);
    },
  );
});
