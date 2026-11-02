import { describe, expect, it } from 'vitest';

import {
  profileUpdateSelected,
  targetedProfile,
} from '#application/setup/integrations';

import { DISABLED_NETWORK_PROFILE, profileWith } from '../../fixtures/profile';

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

describe('fn:targetedProfile', () => {
  it.each([
    { section: 'agent', proxy: false },
    { section: 'network', proxy: false },
    { section: 'proxy', proxy: true },
    { section: 'all', proxy: true },
  ] as const)(
    'should limit preflight integration choices to the $section section',
    ({ section, proxy }) => {
      const selected = profileWith({ cliproxyapi: true });

      expect(targetedProfile(section, selected)).toMatchObject({
        options: { isProxyEnabled: proxy },
      });
    },
  );
});
