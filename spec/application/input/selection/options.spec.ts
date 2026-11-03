import { describe, expect, it } from 'vitest';

import { resolveOptions } from '#application/input/selection/options';
import { defaults } from '#composition/defaults';

import { dependencies } from '../../../mocks/dependencies';

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
