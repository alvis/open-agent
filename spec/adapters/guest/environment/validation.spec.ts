import { describe, expect, it } from 'vitest';

import { parseEnvironment } from '#adapters/guest/environment/contracts';
import {
  environmentProblem,
  isGuestEnvironment,
} from '#adapters/guest/environment/validation';
import { GUEST_ROOT } from '#adapters/guest/platform/layout';
import { registry } from '#composition/registry';
import { STORAGE_OPTION_DEFAULTS } from '#domain/storage';

import {
  earlierEnvironmentOf,
  environmentOf,
} from '../../../fixtures/environment';
import { DISABLED_NETWORK_PROFILE } from '../../../fixtures/profile';

const RECORDED = environmentOf(DISABLED_NETWORK_PROFILE);

describe('fn:parseEnvironment', () => {
  it('should reject duplicate services before resolving their references', () => {
    const candidate = {
      ...RECORDED,
      services: [RECORDED.services[0], RECORDED.services[0]],
    };

    expect(() => parseEnvironment(registry, JSON.stringify(candidate))).toThrow(
      /service is defined twice/u,
    );
  });

  it('should reject a service dependency that is not defined', () => {
    const candidate = {
      ...RECORDED,
      services: [{ ...RECORDED.services[0], needs: ['missing-service'] }],
    };

    expect(() => parseEnvironment(registry, JSON.stringify(candidate))).toThrow(
      /needs missing-service, which is not defined/u,
    );
  });

  it('should reject a network whose daemon has no matching service', () => {
    const candidate = {
      ...RECORDED,
      network: {
        id: 'tailscale',
        daemon: 'missing-daemon',
        launcher: {
          stateDirectory: `${GUEST_ROOT}/tailscale`,
          socket: '/run/tailscale.sock',
          tun: 'tailscale0',
        },
      },
    };

    expect(() => parseEnvironment(registry, JSON.stringify(candidate))).toThrow(
      /network's daemon missing-daemon is not defined/u,
    );
  });

  it('should reject a harness adapter that is not installed as a tool', () => {
    const candidate = {
      ...RECORDED,
      agent: {
        ...RECORDED.agent,
        harnesses: [
          {
            id: 'claude',
            environment: {},
            adapter: {
              tool: 'missing-adapter',
              launch: { program: 'claude-acp', arguments: [] },
            },
          },
        ],
      },
    };

    expect(() => parseEnvironment(registry, JSON.stringify(candidate))).toThrow(
      /launches an adapter that is not installed/u,
    );
  });

  it.each([
    ['an invalid variable name', { 'bad-key': 'value' }],
    ['a non-string variable value', { VALID_NAME: 3 }],
  ])('should reject %s in a harness environment', (_, environment) => {
    const candidate = {
      ...RECORDED,
      agent: {
        ...RECORDED.agent,
        harnesses: [{ id: 'claude', environment }],
      },
    };

    expect(() => parseEnvironment(registry, JSON.stringify(candidate))).toThrow(
      /agent is malformed/u,
    );
  });

  it('should accept an installed npm tool used by a harness adapter', () => {
    const candidate = {
      ...RECORDED,
      tools: [
        {
          name: 'claude-acp',
          required: true,
          account: 'agent',
          executables: ['claude-acp'],
          source: { kind: 'npm', package: 'claude-acp', account: 'agent' },
        },
      ],
      agent: {
        ...RECORDED.agent,
        harnesses: [
          {
            id: 'claude',
            environment: { CLAUDE_MODE: 'acp' },
            adapter: {
              tool: 'claude-acp',
              launch: { program: 'claude-acp', arguments: [] },
            },
          },
        ],
      },
    };

    expect(parseEnvironment(registry, JSON.stringify(candidate))).toEqual(
      candidate,
    );
  });

  it.each([
    ['a non-record source', null],
    ['an unsupported source kind', { kind: 'unknown' }],
  ])('should reject %s for an installed tool', (_, source) => {
    const candidate = {
      ...RECORDED,
      tools: [
        {
          name: 'helper',
          required: true,
          account: 'agent',
          executables: ['helper'],
          source,
        },
      ],
    };

    expect(() => parseEnvironment(registry, JSON.stringify(candidate))).toThrow(
      /tools is malformed/u,
    );
  });

  it('should accept a provider with an awake deadline and adapter path', () => {
    const candidate = {
      ...RECORDED,
      provider: {
        ...RECORDED.provider,
        maxAwakeDeadlineMinutes: 30,
        awakeAdapter: '/usr/local/bin/awake-adapter',
      },
    };

    expect(parseEnvironment(registry, JSON.stringify(candidate))).toEqual(
      candidate,
    );
  });
});

describe('storage growth fields', () => {
  it('should read a record an earlier release wrote with its profile given the storage defaults and no policy', () => {
    const earlier = earlierEnvironmentOf(DISABLED_NETWORK_PROFILE);

    const parsed = parseEnvironment(registry, JSON.stringify(earlier));

    expect(parsed).toEqual({
      ...earlier,
      profile: {
        ...earlier.profile,
        options: { ...earlier.profile.options, ...STORAGE_OPTION_DEFAULTS },
      },
    });
    expect(parsed).not.toHaveProperty('storage');
    expect(parsed.profile.options).not.toHaveProperty('autoExtend');
  });

  it.each([
    ['unsupported', { state: 'unsupported' }],
    ['off', { state: 'off' }],
    [
      'on',
      {
        state: 'on',
        thresholdPercent: 80,
        stepGb: 10,
        limitGb: 100,
        mechanisms: ['provider-auto'],
      },
    ],
  ])('should accept a recorded %s policy with storage facts', (_, storage) => {
    const candidate = {
      ...RECORDED,
      provider: {
        ...RECORDED.provider,
        storagePath: '/data',
        storageAdapter: '/opt/open-agent/storage.sh',
      },
      storage,
    };

    expect(parseEnvironment(registry, JSON.stringify(candidate))).toEqual(
      candidate,
    );
  });

  it.each([
    ['a non-record', 'on'],
    ['an unknown state', { state: 'unknown' }],
    ['a state inherited from the prototype', { state: 'constructor' }],
    ['an off policy with a limit', { state: 'off', limitGb: 100 }],
    [
      'an on policy without a step',
      {
        state: 'on',
        thresholdPercent: 80,
        limitGb: 100,
        mechanisms: ['provider-auto'],
      },
    ],
    [
      'a threshold above 100%',
      {
        state: 'on',
        thresholdPercent: 101,
        stepGb: 10,
        limitGb: 100,
        mechanisms: ['provider-auto'],
      },
    ],
    [
      'no growth mechanism',
      {
        state: 'on',
        thresholdPercent: 80,
        stepGb: 10,
        limitGb: 100,
        mechanisms: [],
      },
    ],
    [
      'an unknown growth mechanism',
      {
        state: 'on',
        thresholdPercent: 80,
        stepGb: 10,
        limitGb: 100,
        mechanisms: ['manual'],
      },
    ],
  ])('should reject %s as the recorded policy', (_, storage) => {
    const candidate = { ...RECORDED, storage };

    expect(() => parseEnvironment(registry, JSON.stringify(candidate))).toThrow(
      /storage is malformed/u,
    );
  });

  it.each([
    ['a relative storage path', { storagePath: 'data' }],
    ['a relative storage adapter', { storageAdapter: 'storage.sh' }],
  ])('should reject %s in the provider facts', (_, facts) => {
    const candidate = {
      ...RECORDED,
      provider: { ...RECORDED.provider, ...facts },
    };

    expect(() => parseEnvironment(registry, JSON.stringify(candidate))).toThrow(
      /provider is malformed/u,
    );
  });
});

describe('fn:environmentProblem', () => {
  it('should report the first malformed field and accept a complete record', () => {
    const candidate = {
      ...RECORDED,
      setup: { ...RECORDED.setup, state: 'unknown' },
      schedule: { dueDays: 0 },
    };

    expect(environmentProblem(registry, RECORDED)).toBeUndefined();
    expect(environmentProblem(registry, candidate)).toBe('setup is malformed');
  });
});

describe('fn:isGuestEnvironment', () => {
  it('should accept a valid record and reject an unsupported schema', () => {
    expect(isGuestEnvironment(registry, RECORDED)).toBe(true);
    expect(isGuestEnvironment(registry, { ...RECORDED, schema: 2 })).toBe(
      false,
    );
  });
});
