import { describe, expect, it } from 'vitest';

import { registry } from '#composition/registry';
import { storageDeclarationProblem, supportsHostGrowth } from '#domain/storage';

// --- CONSTANTS --- //

const providers = Object.values(registry.providers);

// --- TEST SUITES --- //

describe('provider catalog', () => {
  it.each(providers)(
    'should declare coherent storage for $displayName',
    (provider) => {
      expect(storageDeclarationProblem(provider)).toBeUndefined();
    },
  );

  it.each(providers)(
    'should implement extendStorage for $displayName exactly when the host can grow its storage',
    (provider) => {
      expect(typeof provider.extendStorage === 'function').toBe(
        supportsHostGrowth(provider.capabilities.storage),
      );
    },
  );

  it.each(providers)(
    'should refuse $displayName storage that grows through the guest without a storage adapter',
    ({ capabilities }) => {
      expect(
        storageDeclarationProblem({
          capabilities: {
            ...capabilities,
            storage: { ...capabilities.storage, growth: ['guest-extend'] },
          },
        }),
      ).toEqual(expect.stringContaining('storageAsset'));
    },
  );
});
