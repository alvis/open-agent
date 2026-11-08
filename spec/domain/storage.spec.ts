import { describe, expect, it } from 'vitest';

import { defaults } from '#composition/defaults';
import { registry } from '#composition/registry';
import { ROOT_ONLY_MODE } from '#domain/guest';
import {
  effectiveStoragePolicy,
  hostGrowthRefusal,
  initialStorageGb,
  runsStorageWatcher,
  storageDeclarationProblem,
  storagePath,
  storageViolations,
  supportsAutoGrowth,
  supportsHostGrowth,
} from '#domain/storage';

import type { StorageCapability } from '#domain/declarations';
import type { GuestAsset } from '#domain/guest';
import type { ProfileOptions } from '#domain/profile';
import type { StoragePolicy } from '#domain/storage';

// --- CONSTANTS --- //

const options: ProfileOptions = { ...defaults.options };

const fixed: StorageCapability = {
  persistence: 'provider-disk',
  defaultGb: 100,
  maxGb: 100,
  path: '/',
  growth: [],
  hostExtend: false,
};

const nativeOnly: StorageCapability = {
  persistence: 'volume',
  defaultGb: 10,
  maxGb: 500,
  path: '/data',
  growth: ['provider-auto'],
  hostExtend: true,
};

const watcherOnly: StorageCapability = {
  persistence: 'host-disk',
  defaultGb: 20,
  maxGb: 50,
  path: '/srv',
  growth: ['guest-extend'],
  hostExtend: false,
};

const nativeWithWatcher: StorageCapability = {
  ...nativeOnly,
  growth: ['provider-auto', 'guest-extend'],
};

const storageAdapter: GuestAsset = {
  path: 'drivers/providers/fixture/storage.sh',
  mode: ROOT_ONLY_MODE,
  installAs: '/opt/open-agent/drivers/providers/fixture/storage.sh',
};

const flyStorage = registry.providers['fly-machine'].capabilities.storage;
const spriteStorage = registry.providers.sprite.capabilities.storage;

// --- TEST SUITES --- //

describe('fn:supportsAutoGrowth', () => {
  it.each([
    { name: 'fixed', storage: fixed, expected: false },
    { name: 'native-only', storage: nativeOnly, expected: true },
    { name: 'watcher-only', storage: watcherOnly, expected: true },
    { name: 'native-plus-watcher', storage: nativeWithWatcher, expected: true },
  ])(
    'should report automatic growth of $expected for $name storage',
    ({ storage, expected }) => {
      expect(supportsAutoGrowth(storage)).toBe(expected);
    },
  );
});

describe('fn:supportsHostGrowth', () => {
  it.each([
    { name: 'fixed', storage: fixed, expected: false },
    { name: 'native-only', storage: nativeOnly, expected: true },
    { name: 'watcher-only', storage: watcherOnly, expected: false },
    { name: 'native-plus-watcher', storage: nativeWithWatcher, expected: true },
  ])(
    'should report host growth of $expected for $name storage',
    ({ storage, expected }) => {
      expect(supportsHostGrowth(storage)).toBe(expected);
    },
  );

  it('should let the host grow a Fly Machine volume but not a Sprite disk', () => {
    expect(supportsHostGrowth(flyStorage)).toBe(true);
    expect(supportsHostGrowth(spriteStorage)).toBe(false);
  });
});

describe('fn:storagePath', () => {
  it('should measure a Fly Machine at its volume and a Sprite at its root', () => {
    expect({
      fly: storagePath(flyStorage),
      sprite: storagePath(spriteStorage),
    }).toEqual({ fly: '/data', sprite: '/' });
  });
});

describe('fn:initialStorageGb', () => {
  it('should keep the provider default when the requested minimum is smaller', () => {
    expect(initialStorageGb(watcherOnly, { ...options, minStorageGb: 5 })).toBe(
      20,
    );
  });

  it('should raise the size to a requested minimum above the provider default', () => {
    expect(initialStorageGb(nativeOnly, { ...options, minStorageGb: 40 })).toBe(
      40,
    );
  });

  it('should start a Fly Machine at 10 GB and a Sprite at 100 GB by default', () => {
    expect(initialStorageGb(flyStorage, options)).toBe(10);
    expect(initialStorageGb(spriteStorage, options)).toBe(100);
  });
});

describe('fn:effectiveStoragePolicy', () => {
  it.each([
    { name: 'by default', autoExtend: {} },
    { name: 'when requested', autoExtend: { autoExtend: true } },
    { name: 'when turned off', autoExtend: { autoExtend: false } },
  ])('should report fixed storage as unsupported $name', ({ autoExtend }) => {
    expect(
      effectiveStoragePolicy(fixed, { ...options, ...autoExtend }),
    ).toEqual({ state: 'unsupported' });
  });

  it.each([
    { name: 'native-only', storage: nativeOnly },
    { name: 'watcher-only', storage: watcherOnly },
    { name: 'native-plus-watcher', storage: nativeWithWatcher },
  ])(
    'should turn growth off for $name storage when the profile turns it off',
    ({ storage }) => {
      expect(
        effectiveStoragePolicy(storage, { ...options, autoExtend: false }),
      ).toEqual({ state: 'off' });
    },
  );

  it.each([
    {
      name: 'native-only',
      storage: nativeOnly,
      expected: {
        state: 'on',
        thresholdPercent: 85,
        stepGb: 5,
        limitGb: 100,
        mechanisms: ['provider-auto'],
      },
    },
    {
      name: 'watcher-only',
      storage: watcherOnly,
      expected: {
        state: 'on',
        thresholdPercent: 85,
        stepGb: 5,
        limitGb: 50,
        mechanisms: ['guest-extend'],
      },
    },
    {
      name: 'native-plus-watcher',
      storage: nativeWithWatcher,
      expected: {
        state: 'on',
        thresholdPercent: 85,
        stepGb: 5,
        limitGb: 100,
        mechanisms: ['provider-auto', 'guest-extend'],
      },
    },
  ])(
    'should grow $name storage with the profile policy, limited to the provider maximum',
    ({ storage, expected }) => {
      const policy = effectiveStoragePolicy(storage, {
        ...options,
        autoExtendThresholdPercent: 85,
        autoExtendStepGb: 5,
      });

      expect(policy).toEqual(expected);
    },
  );

  it('should keep a requested limit below the provider maximum and grow when growth is requested', () => {
    const policy = effectiveStoragePolicy(nativeOnly, {
      ...options,
      autoExtend: true,
      storageLimitGb: 30,
    });

    expect(policy).toEqual({
      state: 'on',
      thresholdPercent: 80,
      stepGb: 10,
      limitGb: 30,
      mechanisms: ['provider-auto'],
    });
  });

  it('should raise a limit below the starting size to the starting size', () => {
    const policy = effectiveStoragePolicy(flyStorage, {
      ...options,
      minStorageGb: 200,
    });

    expect(policy).toEqual({
      state: 'on',
      thresholdPercent: 80,
      stepGb: 10,
      limitGb: 200,
      mechanisms: ['provider-auto'],
    });
  });

  it('should keep a limit just above the starting size on a Fly Machine', () => {
    const policy = effectiveStoragePolicy(flyStorage, {
      ...options,
      minStorageGb: 10,
      storageLimitGb: 12,
    });

    expect(policy).toEqual({
      state: 'on',
      thresholdPercent: 80,
      stepGb: 10,
      limitGb: 12,
      mechanisms: ['provider-auto'],
    });
  });

  it('should grow a Fly Machine volume by default and report a Sprite disk as unsupported', () => {
    expect(effectiveStoragePolicy(flyStorage, options)).toEqual({
      state: 'on',
      thresholdPercent: 80,
      stepGb: 10,
      limitGb: 100,
      mechanisms: ['provider-auto'],
    });
    expect(effectiveStoragePolicy(spriteStorage, options)).toEqual({
      state: 'unsupported',
    });
  });
});

describe('fn:storageDeclarationProblem', () => {
  it('should accept guest-extend growth with a storage adapter', () => {
    expect(
      storageDeclarationProblem({
        capabilities: {
          ...registry.providers['fly-machine'].capabilities,
          storage: nativeWithWatcher,
        },
        storageAsset: storageAdapter,
      }),
    ).toBeUndefined();
  });

  it.each([
    {
      problem: 'guest-extend growth without a storage adapter',
      storage: watcherOnly,
      expected: expect.stringContaining('storage adapter'),
    },
    {
      problem: 'a maximum below the default',
      storage: { ...nativeOnly, maxGb: 5 },
      expected: expect.stringContaining('maximum storage of 5 GB'),
    },
    {
      problem: 'a repeated growth mechanism',
      storage: {
        ...nativeOnly,
        growth: ['provider-auto', 'provider-auto'] as const,
      },
      expected: expect.stringContaining('repeat'),
    },
    {
      problem: 'a default below 1 GB',
      storage: { ...nativeOnly, defaultGb: 0 },
      expected: expect.stringContaining('default storage of 0 GB'),
    },
  ])('should refuse $problem', ({ storage, expected }) => {
    expect(
      storageDeclarationProblem({
        capabilities: {
          ...registry.providers['fly-machine'].capabilities,
          storage,
        },
      }),
    ).toEqual(expected);
  });
});

describe('fn:runsStorageWatcher', () => {
  const on: StoragePolicy = {
    state: 'on',
    thresholdPercent: 80,
    stepGb: 10,
    limitGb: 100,
    mechanisms: ['guest-extend'],
  };

  it.each([
    { name: 'watcher-only', storage: watcherOnly, policy: on, expected: true },
    {
      name: 'native-plus-watcher',
      storage: nativeWithWatcher,
      policy: on,
      expected: true,
    },
    { name: 'native-only', storage: nativeOnly, policy: on, expected: false },
    {
      name: 'watcher-only',
      storage: watcherOnly,
      policy: { state: 'off' } as const,
      expected: false,
    },
  ])(
    'should run the watcher on $name storage with policy $policy.state: $expected',
    ({ storage, policy, expected }) => {
      expect(runsStorageWatcher(storage, policy)).toBe(expected);
    },
  );

  it('should never run the watcher on either shipped provider', () => {
    expect(
      runsStorageWatcher(
        flyStorage,
        effectiveStoragePolicy(flyStorage, options),
      ),
    ).toBe(false);
    expect(
      runsStorageWatcher(
        spriteStorage,
        effectiveStoragePolicy(spriteStorage, options),
      ),
    ).toBe(false);
  });
});

describe('fn:hostGrowthRefusal', () => {
  it.each([{ requestedGb: 1 }, { requestedGb: 60 }, { requestedGb: 500 }])(
    'should let the host grow a Fly Machine volume to $requestedGb GB',
    ({ requestedGb }) => {
      expect(hostGrowthRefusal(flyStorage, requestedGb)).toBeUndefined();
    },
  );

  it.each([
    {
      problem: 'a provider without host growth',
      storage: spriteStorage,
      requestedGb: 100,
      expected: expect.stringContaining('cannot grow its storage on request'),
    },
    {
      problem: 'a size above the maximum',
      storage: flyStorage,
      requestedGb: 501,
      expected: expect.stringContaining('at most 500 GB'),
    },
    {
      problem: 'a size below 1 GB',
      storage: flyStorage,
      requestedGb: 0,
      expected: expect.stringContaining('at least 1'),
    },
    {
      problem: 'a fractional size',
      storage: flyStorage,
      requestedGb: 12.5,
      expected: expect.stringContaining('whole number'),
    },
  ])('should refuse $problem', ({ storage, requestedGb, expected }) => {
    expect(hostGrowthRefusal(storage, requestedGb)).toEqual(expected);
  });
});

describe('fn:storageViolations', () => {
  it.each([
    {
      name: 'Fly defaults',
      provider: 'fly-machine' as const,
      overrides: {},
      requests: {},
    },
    {
      name: 'a Fly growth policy given in full',
      provider: 'fly-machine' as const,
      overrides: {
        minStorageGb: 40,
        autoExtend: true,
        autoExtendThresholdPercent: 85,
        autoExtendStepGb: 5,
        storageLimitGb: 200,
      },
      requests: {
        isStorageLimitRequested: true,
        storagePolicyFlags: [
          'autoExtendThresholdPercent',
          'autoExtendStepGb',
          'storageLimitGb',
        ] as const,
      },
    },
    {
      name: 'a large Fly disk with growth off',
      provider: 'fly-machine' as const,
      overrides: { minStorageGb: 200, autoExtend: false },
      requests: {},
    },
    {
      name: 'an unsupplied Fly limit above the maximum',
      provider: 'fly-machine' as const,
      overrides: { storageLimitGb: 600 },
      requests: {},
    },
    {
      name: 'a supplied Fly limit equal to the starting size',
      provider: 'fly-machine' as const,
      overrides: { minStorageGb: 10, storageLimitGb: 12 },
      requests: { isStorageLimitRequested: true },
    },
    {
      name: 'Sprite defaults',
      provider: 'sprite' as const,
      overrides: {},
      requests: {},
    },
    {
      name: 'Sprite policy values from the environment',
      provider: 'sprite' as const,
      overrides: { minStorageGb: 100, autoExtendStepGb: 5, storageLimitGb: 5 },
      requests: { isStorageLimitRequested: true },
    },
  ])('should accept $name', ({ provider, overrides, requests }) => {
    expect(
      storageViolations({
        declarations: registry,
        provider,
        options: { ...options, ...overrides },
        requests,
      }),
    ).toEqual([]);
  });

  it('should report every storage request a Sprite’s fixed disk refuses', () => {
    expect(
      storageViolations({
        declarations: registry,
        provider: 'sprite',
        options: { ...options, minStorageGb: 200, autoExtend: true },
        requests: {
          isStorageLimitRequested: true,
          storagePolicyFlags: ['storageLimitGb', 'autoExtendThresholdPercent'],
        },
      }),
    ).toEqual([
      {
        code: 'undeclared-capability',
        message: expect.stringMatching(
          /--storage \(OPEN_AGENT_STORAGE\).*200 GB.*at most 100 GB/,
        ),
        fields: ['provider', 'minStorageGb'],
      },
      {
        code: 'undeclared-capability',
        message: expect.stringContaining(
          '--auto-extend (OPEN_AGENT_AUTO_EXTEND)',
        ),
        fields: ['provider', 'autoExtend'],
      },
      {
        code: 'undeclared-capability',
        message: expect.stringMatching(
          /--auto-extend-at .*has no effect.*unsupported on Fly Sprite/,
        ),
        fields: ['provider', 'autoExtendThresholdPercent'],
      },
      {
        code: 'undeclared-capability',
        message: expect.stringMatching(
          /--storage-limit .*has no effect.*unsupported on Fly Sprite/,
        ),
        fields: ['provider', 'storageLimitGb'],
      },
    ]);
  });

  it('should refuse explicit policy flags while growth is turned off', () => {
    expect(
      storageViolations({
        declarations: registry,
        provider: 'fly-machine',
        options: { ...options, autoExtend: false, autoExtendStepGb: 5 },
        requests: { storagePolicyFlags: ['autoExtendStepGb'] },
      }),
    ).toEqual([
      {
        code: 'invalid-option',
        message: expect.stringMatching(
          /--auto-extend-step .*has no effect.*off on Fly/,
        ),
        fields: ['autoExtendStepGb', 'autoExtend'],
      },
    ]);
  });

  it('should refuse a supplied limit outside the starting size to the maximum while growth is on', () => {
    const violationsOf = (overrides: Partial<ProfileOptions>) =>
      storageViolations({
        declarations: registry,
        provider: 'fly-machine',
        options: { ...options, ...overrides },
        requests: { isStorageLimitRequested: true },
      });

    expect(violationsOf({ minStorageGb: 10, storageLimitGb: 5 })).toEqual([
      {
        code: 'invalid-option',
        message: expect.stringMatching(
          /--storage-limit .*5 GB is below the starting size of 10 GB/,
        ),
        fields: ['minStorageGb', 'storageLimitGb'],
      },
    ]);
    expect(violationsOf({ storageLimitGb: 600 })).toEqual([
      {
        code: 'undeclared-capability',
        message: expect.stringContaining('at most 500 GB'),
        fields: ['provider', 'storageLimitGb'],
      },
    ]);
  });

  it('should refuse a Fly minimum above the volume maximum without also refusing the limit', () => {
    expect(
      storageViolations({
        declarations: registry,
        provider: 'fly-machine',
        options: { ...options, minStorageGb: 501, storageLimitGb: 500 },
        requests: { isStorageLimitRequested: true },
      }),
    ).toEqual([
      {
        code: 'undeclared-capability',
        message: expect.stringContaining('at most 500 GB'),
        fields: ['provider', 'minStorageGb'],
      },
    ]);
  });

  it.each([
    { field: 'minimum', overrides: { minStorageGb: 40.5 } },
    { field: 'limit', overrides: { storageLimitGb: 0.5 } },
  ])(
    'should leave a fractional $field to its bound rather than compare sizes',
    ({ overrides }) => {
      expect(
        storageViolations({
          declarations: registry,
          provider: 'fly-machine',
          options: { ...options, ...overrides },
          requests: { isStorageLimitRequested: true },
        }),
      ).toEqual([]);
    },
  );
});
