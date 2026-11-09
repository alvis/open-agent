import { tmpdir } from 'node:os';

import { describe, expect, it, vi } from 'vitest';

import {
  growStorageWhenRequested,
  requireGrowableStorage,
} from '#application/setup/storage';

import { dependencies } from '../../mocks/dependencies';
import { createFilesystemSprite, workstationOf } from '../../mocks/sprites';

import type { ProviderDriver } from '#application/ports/drivers';
import type { Interaction } from '#application/ports/interaction';

// --- CONSTANTS --- //

/** the size the fake provider's storage already has */
const CURRENT_GB = 40;

const workstation = workstationOf(
  createFilesystemSprite({ root: tmpdir() }),
).workstation;
const growable = dependencies.registry.providers['fly-machine'].capabilities;
const fixed = dependencies.registry.providers.sprite.capabilities;

// --- HELPERS --- //

/**
 * a provider whose storage is CURRENT_GB and grows to any larger size
 * @param extension what the provider reports after growing, by requested size
 * @returns the provider and its extend operation
 */
function providerGrowing(
  extension: ProviderDriver['extendStorage'] = async (_, sizeGb) => ({
    sizeGb: Math.max(CURRENT_GB, sizeGb),
    needsRestart: false,
  }),
): {
  provider: ProviderDriver;
  extendStorage: ReturnType<typeof vi.fn<NonNullable<typeof extension>>>;
} {
  const extendStorage = vi.fn<NonNullable<typeof extension>>(extension);
  const provider = {
    displayName: 'Test provider',
    capabilities: growable,
    extendStorage,
  } satisfies Partial<ProviderDriver> as Partial<ProviderDriver> as ProviderDriver;

  return { provider, extendStorage };
}

/**
 * runs the growth with a status sink
 * @param provider provider hosting the workstation
 * @param minStorageGb size supplied by --storage, if any
 * @returns the outcome and every status line published
 */
async function grow(
  provider: ProviderDriver,
  minStorageGb?: number,
): Promise<{
  outcome: Awaited<ReturnType<typeof growStorageWhenRequested>>;
  statuses: unknown[];
}> {
  const status = vi.fn<Interaction['status']>();
  const interaction = {
    status,
  } satisfies Partial<Interaction> as Partial<Interaction> as Interaction;
  const outcome = await growStorageWhenRequested({
    provider,
    workstation,
    supplied: {
      options: minStorageGb === undefined ? {} : { minStorageGb },
    },
    interaction,
  });

  return { outcome, statuses: status.mock.calls.map(([update]) => update) };
}

// --- TEST SUITES --- //

describe('fn:growStorageWhenRequested', () => {
  it('should leave storage alone when no size was supplied', async () => {
    const { provider, extendStorage } = providerGrowing();

    await expect(grow(provider)).resolves.toEqual({
      outcome: undefined,
      statuses: [],
    });
    expect(extendStorage.mock.calls).toEqual([]);
  });

  it('should grow storage to the supplied size and report it', async () => {
    const { provider, extendStorage } = providerGrowing();

    await expect(grow(provider, 60)).resolves.toEqual({
      outcome: { sizeGb: 60, needsRestart: false },
      statuses: [{ kind: 'success', message: 'Storage is 60 GB' }],
    });
    expect(extendStorage.mock.calls).toEqual([[workstation, 60]]);
  });

  it('should report storage already at the supplied size as unchanged', async () => {
    const { provider } = providerGrowing();

    await expect(grow(provider, CURRENT_GB)).resolves.toEqual({
      outcome: { sizeGb: CURRENT_GB, needsRestart: false },
      statuses: [{ kind: 'success', message: 'Storage is 40 GB' }],
    });
  });

  it('should grow beyond the automatic growth limit up to the provider maximum', async () => {
    const { provider } = providerGrowing();

    const { outcome } = await grow(provider, 500);

    expect(outcome).toEqual({ sizeGb: 500, needsRestart: false });
  });

  it('should report that the added space needs a restart to become usable', async () => {
    const { provider } = providerGrowing(async (_, sizeGb) => ({
      sizeGb,
      needsRestart: true,
    }));

    await expect(grow(provider, 60)).resolves.toEqual({
      outcome: { sizeGb: 60, needsRestart: true },
      statuses: [
        {
          kind: 'warning',
          message: expect.stringContaining('usable after the next restart'),
        },
      ],
    });
  });

  it('should refuse a size below the current storage because storage never shrinks', async () => {
    const { provider } = providerGrowing();

    await expect(grow(provider, 20)).rejects.toMatchObject({
      code: 'INPUT',
      message: expect.stringContaining('already 40 GB; storage never shrinks'),
    });
  });

  it('should refuse a provider that declares host growth but has no extend operation', async () => {
    const { extendStorage: _, ...provider } = providerGrowing().provider;

    await expect(grow(provider, 60)).rejects.toMatchObject({
      code: 'INPUT',
      message: expect.stringContaining('cannot grow its storage on request'),
    });
  });

  it('should refuse a provider that reports less storage than it was asked to grow to', async () => {
    const { provider } = providerGrowing(async () => ({
      sizeGb: 50,
      needsRestart: false,
    }));

    await expect(grow(provider, 60)).rejects.toMatchObject({
      code: 'PROVIDER',
      message: expect.stringContaining('50 GB'),
    });
  });
});

describe('fn:requireGrowableStorage', () => {
  const declared = (capabilities: ProviderDriver['capabilities']) =>
    ({ displayName: 'Test provider', capabilities }) satisfies Pick<
      ProviderDriver,
      'displayName' | 'capabilities'
    >;

  it('should accept a run without a storage size whatever the provider', () => {
    expect(() =>
      requireGrowableStorage(declared(fixed), { options: {} }),
    ).not.toThrow();
  });

  it('should accept a size up to the provider maximum, past the automatic growth limit', () => {
    expect(() =>
      requireGrowableStorage(declared(growable), {
        options: { minStorageGb: 500 },
      }),
    ).not.toThrow();
  });

  it.each([
    {
      label: 'a size above the provider maximum',
      capabilities: growable,
      expected:
        'Cannot grow storage on Test provider: storage of 501 GB is more than the provider allows: at most 500 GB',
    },
    {
      label: 'a provider without host growth',
      capabilities: fixed,
      expected:
        'Cannot grow storage on Test provider: the provider cannot grow its storage on request',
    },
  ])('should refuse $label', ({ capabilities, expected }) => {
    expect(() =>
      requireGrowableStorage(declared(capabilities), {
        options: { minStorageGb: 501 },
      }),
    ).toThrow(expect.objectContaining({ code: 'INPUT', message: expected }));
  });
});
