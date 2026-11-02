import { describe, expect, it, vi } from 'vitest';

import {
  resolveMachine,
  resolveOptions,
  resolveRelease,
} from '#application/input/selection/options';
import { defaults } from '#composition/defaults';

import { dependencies } from '../../../mocks/dependencies';

import type { Prompts } from '#application/input/selection/sources';

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

describe('fn:resolveMachine', () => {
  it('should defer machine capability checks for an unknown provider choice', async () => {
    const checks: Array<string | undefined> = [];
    const prompts: Prompts = {
      number: vi.fn<Prompts['number']>(async (_message, _fallback, rule) => {
        checks.push(rule?.check?.(4));

        return checks.length === 1 ? 4 : 8;
      }),
      choose: async () => undefined,
      chooseMany: async () => undefined,
    };

    const machine = await resolveMachine(dependencies, {
      provider: 'unregistered-provider',
      supplied: {},
      prompts,
      base: defaults.options,
    });

    expect(machine).toEqual({ minCpus: 4, minMemoryGb: 8 });
    expect(checks).toEqual([undefined, undefined]);
    expect(prompts.number).toHaveBeenCalledTimes(2);
  });

  it('should check prompted minimums against a known provider’s offered machines', async () => {
    const checks: Array<string | undefined> = [];
    const prompts: Prompts = {
      number: async (_message, _fallback, rule) => {
        checks.push(rule?.check?.(100));

        return 2;
      },
      choose: async () => undefined,
      chooseMany: async () => undefined,
    };

    expect(
      await resolveMachine(dependencies, {
        provider: 'sprite',
        supplied: {},
        prompts,
        base: defaults.options,
      }),
    ).toEqual({ minCpus: 2, minMemoryGb: 2 });
    expect(checks).toEqual([
      expect.stringContaining('100 CPUs'),
      expect.stringContaining('100 GB'),
    ]);
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
