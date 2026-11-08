import { describe, expect, it, vi } from 'vitest';

import { growVolume } from '#adapters/drivers/providers/fly-machine/storage';
import { ProviderFault } from '#kernel/provider-fault';

import type { FlyApi } from '#adapters/drivers/providers/fly-machine/api';
import type { FlyMachine } from '#adapters/drivers/providers/fly-machine/wire';

// --- CONSTANTS --- //

const machine: FlyMachine = {
  id: 'machine-1',
  state: 'started',
  metadata: {},
  routes: [],
  volume: 'vol_1',
};

// --- HELPERS --- //

/**
 * a Machines API whose volume holds 40 GB and grows to any size asked
 * @param extendVolume the extend the API answers with
 * @returns the API and its operations
 */
function apiWith(
  extendVolume: FlyApi['extendVolume'] = async (_, __, sizeGb) => ({
    sizeGb,
    needsRestart: false,
  }),
): {
  api: FlyApi;
  extend: ReturnType<typeof vi.fn<FlyApi['extendVolume']>>;
} {
  const extend = vi.fn<FlyApi['extendVolume']>(extendVolume);
  const api = {
    getVolume: vi.fn<FlyApi['getVolume']>(async (_, id) => ({
      id,
      sizeGb: 40,
    })),
    extendVolume: extend,
  } satisfies Partial<FlyApi> as Partial<FlyApi> as FlyApi;

  return { api, extend };
}

// --- TEST SUITES --- //

describe('fn:growVolume', () => {
  it('should extend the mounted volume to a larger size', async () => {
    const { api, extend } = apiWith();

    await expect(
      growVolume({ api, app: 'agent', machine, sizeGb: 60 }),
    ).resolves.toEqual({ sizeGb: 60, needsRestart: false });
    expect(extend.mock.calls).toEqual([['agent', 'vol_1', 60]]);
  });

  it.each([40, 20])(
    'should make no extend call and report the current size for %i GB',
    async (sizeGb) => {
      const { api, extend } = apiWith();

      await expect(
        growVolume({ api, app: 'agent', machine, sizeGb }),
      ).resolves.toEqual({ sizeGb: 40, needsRestart: false });
      expect(extend.mock.calls).toEqual([]);
    },
  );

  it('should refuse a machine that mounts no volume', async () => {
    const { api } = apiWith();
    const { volume: _, ...unmounted } = machine;

    await expect(
      growVolume({ api, app: 'agent', machine: unmounted, sizeGb: 60 }),
    ).rejects.toMatchObject({
      code: 'failed',
      message: expect.stringContaining('mounts no volume'),
    });
  });

  it('should name the size when Fly refuses it, keeping the failure class', async () => {
    const refusal = new ProviderFault({
      code: 'failed',
      message: 'Fly Machines API PUT /extend returned 400: too large',
    });
    const { api } = apiWith(async () => Promise.reject(refusal));

    await expect(
      growVolume({ api, app: 'agent', machine, sizeGb: 600 }),
    ).rejects.toEqual(
      new ProviderFault({
        code: 'failed',
        message: `Fly could not grow volume vol_1 of agent to 600 GB: ${refusal.message}`,
      }),
    );
  });

  it('should pass on a failure that is not a provider refusal unchanged', async () => {
    const cancelled = new Error('cancelled');
    const { api } = apiWith(async () => Promise.reject(cancelled));

    await expect(
      growVolume({ api, app: 'agent', machine, sizeGb: 60 }),
    ).rejects.toBe(cancelled);
  });
});
