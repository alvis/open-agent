import { describe, expect, it, vi } from 'vitest';

import { defaults } from '#composition/defaults';
import { registry } from '#composition/registry';
import {
  defaultProfile,
  parseProfile,
  registeredSummary,
  validateProfile,
} from '#domain/profile';

import type {
  AgentDeclaration,
  HarnessDeclaration,
  NetworkDeclaration,
  ProviderDeclaration,
} from '#domain/declarations';
import type { ProfileCandidate } from '#domain/profile';

// fixture catalog adding an acp-adapter agent and a harness with an adapter
vi.mock('#composition/registry', async (importOriginal) => {
  const original =
    await importOriginal<typeof import('#composition/registry')>();
  const sprite: ProviderDeclaration<'sprite'> = {
    id: 'sprite',
    kind: 'providers',
    displayName: 'Sprite',
    capabilities: {
      guestChannel: 'provider-exec',
      keepAwakeMode: 'native-deadline',
      idleForms: ['provider-managed'],
      wakeMode: 'url-traffic',
      supportsCliWakeSleep: false,
      maxAwakeDeadlineMinutes: 60,
      persistence: 'provider-disk',
      exposure: 'provider-url',
      discovery: 'provider-metadata',
    },
    incompatibilities: [
      {
        reason: 'Fixture provider cannot host a one-minute idle timeout',
        appliesTo: ({ options }) => options.idleTimeoutMinutes === 1,
      },
    ],
    prerequisites: {
      tools: [],
      credential: {
        label: 'Fixture token',
        environment: 'FIXTURE_TOKEN',
        store: 'fixture',
        scope: 'fixture access',
        obtain: 'the fixture console',
        refused: [],
      },
      documentation: [],
    },
    images: [{ id: 'fixture', family: 'debian', arch: ['x86_64'] }],
  };
  const claude: HarnessDeclaration<'claude'> = {
    id: 'claude',
    kind: 'harnesses',
    displayName: 'Claude Code',
    spawnEnvironment: {},
    acpAdapter: {
      tool: {
        name: 'claude-acp',
        required: true,
        executables: ['claude-acp'],
        version: {
          executable: 'claude-acp',
          args: ['--version'],
          account: 'agent',
        },
        sources: [{ kind: 'npm', package: 'claude-acp', account: 'agent' }],
      },
      launch: { program: 'claude-acp', arguments: [] },
    },
  };
  const t3: AgentDeclaration<'t3', 'claude'> = {
    id: 't3',
    kind: 'agents',
    displayName: 'T3 Code',
    supportedHarnesses: ['claude'],
    harnessLaunchMode: 'native-cli',
    supportsPairing: true,
    service: {
      name: 'fixture',
      command: 'fixture',
      arguments: [],
      account: 'agent',
      needs: [],
    },
  };
  const relay: AgentDeclaration<'relay', 'claude'> = {
    id: 'relay',
    kind: 'agents',
    displayName: 'Relay',
    supportedHarnesses: ['claude'],
    harnessLaunchMode: 'acp-adapter',
    supportsPairing: false,
    service: {
      name: 'fixture',
      command: 'fixture',
      arguments: [],
      account: 'agent',
      needs: [],
    },
  };
  const none: NetworkDeclaration<'none'> = {
    id: 'none',
    kind: 'networks',
    displayName: 'None',
  };

  const mockedRegistry = {
    ...original.registry,
    providers: {
      ...original.registry.providers,
      sprite: { ...original.registry.providers.sprite, ...sprite },
    },
    harnesses: {
      ...original.registry.harnesses,
      claude: { ...original.registry.harnesses.claude, ...claude },
    },
    agents: {
      ...original.registry.agents,
      t3: { ...original.registry.agents.t3, ...t3 },
      relay,
    },
    networks: {
      ...original.registry.networks,
      none: { ...original.registry.networks.none, ...none },
    },
  };

  return { registry: mockedRegistry } satisfies Partial<
    typeof import('#composition/registry')
  >;
});

// the fixture catalog with Claude lacking an ACP adapter,
// standing in for a harness that declares none
const { acpAdapter: _adapter, ...bareClaude } = registry.harnesses.claude;
const BARE = {
  ...registry,
  harnesses: { claude: bareClaude },
};

const valid: ProfileCandidate = {
  provider: 'sprite',
  agent: 't3',
  harnesses: ['claude'],
  network: 'none',
  options: { ...defaults.options },
};

/**
 * lists the violation codes a candidate raises
 * @param candidate profile overrides applied to a valid candidate
 * @param isPairingRequested whether pairing is requested
 * @returns violation codes, empty when the profile is valid
 */
function violationCodes(
  candidate: Partial<ProfileCandidate>,
  isPairingRequested = false,
): string[] {
  const result = validateProfile({
    declarations: registry,
    candidate: { ...valid, ...candidate },
    options: { isPairingRequested },
  });

  return result.isValid ? [] : result.violations.map(({ code }) => code);
}

describe('fn:defaultProfile', () => {
  it('should reproduce the default workstation', () => {
    expect(defaultProfile(defaults)).toEqual({
      provider: 'sprite',
      agent: 't3',
      harnesses: ['claude'],
      network: 'none',
      options: {
        idleTimeoutMinutes: 5,
        holdMaxMinutes: 60,
      },
    });
  });
});

describe('fn:registeredSummary', () => {
  it('should retain registered ids and discard unrecognized harnesses from a provider record', () => {
    const summary = registeredSummary(registry, {
      provider: 'sprite',
      agent: 't3',
      harnesses: ['unknown-harness', 'claude'],
      network: 'none',
    });

    expect(summary).toEqual({
      provider: 'sprite',
      agent: 't3',
      harnesses: ['claude'],
      network: 'none',
    });
  });

  it.each([
    {
      reason: 'the provider record is absent',
      recorded: undefined,
    },
    {
      reason: 'the provider is unknown',
      recorded: {
        provider: 'unknown-provider',
        agent: 't3',
        harnesses: ['claude'],
        network: 'none',
      },
    },
    {
      reason: 'the agent is unknown',
      recorded: {
        provider: 'sprite',
        agent: 'unknown-agent',
        harnesses: ['claude'],
        network: 'none',
      },
    },
    {
      reason: 'the network is unknown',
      recorded: {
        provider: 'sprite',
        agent: 't3',
        harnesses: ['claude'],
        network: 'unknown-network',
      },
    },
    {
      reason: 'no known harness remains',
      recorded: {
        provider: 'sprite',
        agent: 't3',
        harnesses: ['unknown-harness'],
        network: 'none',
      },
    },
  ])('should withhold a summary when $reason', ({ recorded }) => {
    expect(registeredSummary(registry, recorded)).toBeUndefined();
  });
});

describe('fn:validateProfile', () => {
  it('should accept the default profile and an idle timeout of 0', () => {
    expect(violationCodes({})).toEqual([]);
    expect(
      violationCodes({ options: { ...valid.options, idleTimeoutMinutes: 0 } }),
    ).toEqual([]);
  });

  it.each([
    ['zero harnesses', { harnesses: [] }, ['no-harness']],
    ['an unknown harness', { harnesses: ['aider'] }, ['unknown-driver']],
    ['an unknown provider', { provider: 'ec2' }, ['unknown-driver']],
    ['an unknown agent', { agent: 'unregistered-agent' }, ['unknown-driver']],
    [
      'a repeated harness',
      { harnesses: ['claude', 'claude'] },
      ['duplicate-harness'],
    ],
    [
      'a negative idle timeout',
      { options: { ...valid.options, idleTimeoutMinutes: -1 } },
      ['invalid-option'],
    ],
    [
      'a turn-hold maximum of 0',
      { options: { ...valid.options, holdMaxMinutes: 0 } },
      ['invalid-option'],
    ],
    [
      'fractional minutes',
      { options: { ...valid.options, idleTimeoutMinutes: 1.5 } },
      ['invalid-option'],
    ],
    [
      'a profile the provider declares incompatible',
      { options: { ...valid.options, idleTimeoutMinutes: 1 } },
      ['incompatible'],
    ],
  ])('should reject %s', (_, candidate, expected) => {
    expect(violationCodes(candidate)).toEqual(expected);
  });

  it('should reject an acp-adapter agent with a harness lacking an adapter', () => {
    expect(
      validateProfile({
        declarations: BARE,
        candidate: { ...valid, agent: 'relay' },
      }),
    ).toMatchObject({
      isValid: false,
      violations: [{ code: 'missing-acp-adapter' }],
    });
  });

  it.each([
    ['idleTimeoutMinutes', 60, 61],
    ['holdMaxMinutes', 60, 61],
  ] as const)(
    'should accept %s at the provider cap of %i and refuse it above, naming the option, the provider and the cap',
    (key, cap, above) => {
      const options = (minutes: number): ProfileCandidate['options'] => ({
        ...valid.options,
        [key]: minutes,
      });

      expect(violationCodes({ options: options(cap) })).toEqual([]);
      expect(
        validateProfile({
          declarations: registry,
          candidate: { ...valid, options: options(above) },
        }),
      ).toMatchObject({
        isValid: false,
        violations: [
          {
            code: 'undeclared-capability',
            fields: ['provider', key],
            message: expect.stringMatching(
              new RegExp(`${above} minutes.*"sprite".*at most ${cap} minutes`),
            ),
          },
        ],
      });
    },
  );

  it('should accept an acp-adapter agent when every harness provides an adapter', () => {
    expect(violationCodes({ agent: 'relay', harnesses: ['claude'] })).toEqual(
      [],
    );
  });

  it('should reject pairing from an agent that does not declare it', () => {
    expect(
      violationCodes({ agent: 'relay', harnesses: ['claude'] }, true),
    ).toEqual(['undeclared-capability']);
    expect(violationCodes({}, true)).toEqual([]);
  });

  it('should aggregate every violation instead of stopping at the first', () => {
    expect(
      violationCodes({
        network: 'none',
        harnesses: [],
        options: {
          ...valid.options,
          idleTimeoutMinutes: -1,
          holdMaxMinutes: 0,
        },
      }),
    ).toEqual(['no-harness', 'invalid-option', 'invalid-option']);
  });
});

describe('fn:parseProfile', () => {
  it('should accept a complete decoded profile', () => {
    expect(parseProfile({ declarations: registry, value: valid })).toEqual({
      isValid: true,
      profile: valid,
    });
  });

  it('should reject a stored value without the profile structure', () => {
    expect(
      parseProfile({ declarations: registry, value: { provider: 'sprite' } }),
    ).toEqual({
      isValid: false,
      violations: [expect.objectContaining({ code: 'malformed' })],
    });
  });

  it.each([
    { field: 'provider', value: { ...valid, provider: 7 } },
    { field: 'agent', value: { ...valid, agent: 7 } },
    { field: 'harness list', value: { ...valid, harnesses: 'claude' } },
    { field: 'harness entry', value: { ...valid, harnesses: ['claude', 7] } },
    { field: 'network', value: { ...valid, network: false } },
    {
      field: 'numeric option',
      value: {
        ...valid,
        options: { ...valid.options, idleTimeoutMinutes: 'many' },
      },
    },
  ])('should reject a stored profile with malformed $field', ({ value }) => {
    expect(parseProfile({ declarations: registry, value })).toMatchObject({
      isValid: false,
      violations: [{ code: 'malformed' }],
    });
  });
});
