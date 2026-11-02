import { describe, expect, it } from 'vitest';

import {
  resolveOptions,
  resolveRelease,
} from '#application/input/selection/options';
import { defaults } from '#composition/defaults';

import { dependencies } from '../../../mocks/dependencies';

describe('fn:resolveRelease', () => {
  it('should preserve a recorded channel while an unknown agent choice awaits validation', async () => {
    const release = await resolveRelease(dependencies, {
      agent: 'unregistered-agent',
      supplied: {},
      base: { ...defaults.options, agentRelease: 'recorded-channel' },
    });

    expect(release).toBe('recorded-channel');
  });
});

describe('fn:resolveOptions', () => {
  it('should preserve idle minutes while an unknown provider choice awaits validation', async () => {
    const options = await resolveOptions(dependencies, {
      selected: {
        provider: 'unregistered-provider',
        agent: 't3',
      },
      supplied: {},
      fields: ['idleTimeoutMinutes'],
      base: defaults.options,
    });

    expect(options.idleTimeoutMinutes).toBe(
      defaults.options.idleTimeoutMinutes,
    );
  });
});
