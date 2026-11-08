import { describe, expect, it, vi } from 'vitest';

import { resolveStorage } from '#application/input/selection/storage';
import { defaults } from '#composition/defaults';

import { dependencies } from '../../../mocks/dependencies';

import type { Prompts } from '#application/input/selection/sources';

describe('fn:resolveStorage', () => {
  it('should check each prompted size against a known provider’s storage', async () => {
    const checks: Record<string, Array<string | undefined>> = {};
    const prompts: Prompts = {
      number: async (message, fallback, rule) => {
        checks[message] = [600, 5, 200].map((value) => rule?.check?.(value));

        return fallback;
      },
      choose: async () => undefined,
      chooseMany: async () => undefined,
      confirm: async (_message, fallback) => fallback,
    };

    await resolveStorage(dependencies, {
      provider: 'fly-machine',
      flags: [],
      supplied: {},
      prompts,
      base: defaults.options,
    });

    expect(checks).toEqual({
      'Minimum storage (GB)': [
        expect.stringContaining('at most 500 GB'),
        undefined,
        undefined,
      ],
      'Grow up to (GB)': [
        expect.stringContaining('at most 500 GB'),
        expect.stringContaining('below the starting size of 10 GB'),
        undefined,
      ],
    });
  });

  it('should defer storage checks and growth prompts for an unknown provider choice', async () => {
    const checks: Array<string | undefined> = [];
    const prompts: Prompts = {
      number: vi.fn<Prompts['number']>(async (_message, _fallback, rule) => {
        checks.push(rule?.check?.(600));

        return 600;
      }),
      choose: async () => undefined,
      chooseMany: async () => undefined,
      confirm: vi.fn<Prompts['confirm']>(async () => true),
    };

    const storage = await resolveStorage(dependencies, {
      provider: 'unregistered-provider',
      flags: [],
      supplied: { autoExtendStepGb: 0 },
      prompts,
      base: defaults.options,
    });

    expect(storage).toEqual({
      options: {
        minStorageGb: 600,
        autoExtendThresholdPercent: 80,
        autoExtendStepGb: 0,
        storageLimitGb: 100,
      },
      isStorageLimitRequested: false,
      storagePolicyFlags: [],
    });
    expect(checks).toEqual([undefined]);
    expect(prompts.confirm).not.toHaveBeenCalled();
  });
});
