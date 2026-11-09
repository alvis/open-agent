import { describe, expect, it } from 'vitest';

import {
  readSetupSelection,
  resolveCreateSelection,
  resolveSetupSelection,
  selectionRequirements,
} from '#application/input/selection';
import { suppliedSelectionViolations } from '#application/input/selection/supplied';
import { defaults } from '#composition/defaults';
import { defaultProfile, MAX_UPDATE_DUE_DAYS } from '#domain/profile';

import { dependencies } from '../../mocks/dependencies';

import type { CommandOptions, SetupSection } from '#application/contracts';
import type { SelectionContext } from '#application/input/selection/sources';
import type { InputSources } from '#application/input/sources';
import type {
  Interaction,
  InteractionChoice,
  InteractionPrompt,
} from '#application/ports/interaction';
import type { ProfileOptions, WorkstationProfile } from '#domain/profile';

const empty: InputSources = { processEnv: {}, fileEnv: {}, profile: {} };

/**
 * reads a setup run's supplied values, then merges them with the recorded profile
 * @param context flags, sources, prompts, recorded profile and targeted section
 * @returns the resolved setup selection
 */
async function resolveSetup(
  context: SelectionContext & {
    recorded: WorkstationProfile;
    section: SetupSection;
  },
): ReturnType<typeof resolveSetupSelection> {
  const { value: supplied } = readSetupSelection(dependencies, context);

  return resolveSetupSelection(dependencies, { ...context, supplied });
}

/**
 * records the prompts a selection run asks, answering each with its default
 * @returns the interaction and the asked prompt messages
 */
function recordingInteraction(): {
  interaction: Interaction;
  asked: string[];
} {
  const asked: string[] = [];
  const interaction: Interaction = {
    async input({ message, defaultValue }) {
      asked.push(message);

      return defaultValue ?? '';
    },
    async secret({ message }) {
      asked.push(message);

      return '';
    },
    async select<V extends string>(
      { message }: InteractionPrompt,
      choices: ReadonlyArray<InteractionChoice<V>>,
    ): Promise<V> {
      asked.push(message);
      const [first] = choices;
      if (!first) {
        throw new Error(`no choice offered for ${message}`);
      }

      return first.value;
    },
    async multiselect<V extends string>(
      { message }: InteractionPrompt,
      choices: ReadonlyArray<InteractionChoice<V>>,
    ): Promise<V[]> {
      asked.push(message);

      return choices
        .filter(({ isPreselected }) => isPreselected === true)
        .map(({ value }) => value);
    },
    async confirm({ message, defaultAnswer }) {
      asked.push(message);

      return defaultAnswer ?? false;
    },
    progress: () => undefined,
    status: () => undefined,
  };

  return { interaction, asked };
}

describe('fn:resolveCreateSelection', () => {
  it('should ask provider, harnesses, network and the supported options in order while skipping single-choice steps and hold-max', async () => {
    const { interaction, asked } = recordingInteraction();

    const { candidate } = await resolveCreateSelection(dependencies, {
      options: {},
      sources: empty,
      interaction,
    });

    expect(asked).toEqual([
      'Provider',
      'Minimum CPUs',
      'Minimum memory (GB)',
      'Minimum storage (GB)',
      'Release channel',
      'Harnesses',
      'Network',
      'Route harnesses through CLIProxyAPI?',
      'Suspend after idle (minutes, 0 = never)',
    ]);
    expect(candidate).toMatchObject({
      provider: 'sprite',
      agent: 't3',
      harnesses: ['claude', 'codex'],
      network: 'none',
    });
  });

  it('should ask for an exit node only when the selected network supports one', async () => {
    const { interaction, asked } = recordingInteraction();

    await resolveCreateSelection(dependencies, {
      options: { network: 'tailscale' },
      sources: empty,
      interaction,
    });

    expect(asked).toContain('Use an exit node?');
  });

  it('should not prompt for a step a flag already answers', async () => {
    const { interaction, asked } = recordingInteraction();

    const { candidate } = await resolveCreateSelection(dependencies, {
      options: {
        provider: 'sprite',
        cpu: 4,
        mem: 8,
        storage: 20,
        release: 'stable',
        harness: ['codex'],
        network: 'tailscale',
        useExitNode: false,
        proxy: false,
        idleMinutes: 0,
      },
      sources: empty,
      interaction,
    });

    expect(asked).toEqual([]);
    expect(candidate.options.idleTimeoutMinutes).toBe(0);
  });

  it('should take the flag over the env file over the process environment', async () => {
    const sources: InputSources = {
      processEnv: { OPEN_AGENT_IDLE_MINUTES: '15' },
      fileEnv: { OPEN_AGENT_IDLE_MINUTES: '45', OPEN_AGENT_NETWORK: 'none' },
      profile: {},
    };

    const fromEnvironment = await resolveCreateSelection(dependencies, {
      options: { nonInteractive: true },
      sources,
    });
    const fromFlag = await resolveCreateSelection(dependencies, {
      options: { nonInteractive: true, idleMinutes: 0 },
      sources,
    });

    expect(fromEnvironment.candidate.options.idleTimeoutMinutes).toBe(45);
    expect(fromEnvironment.candidate.network).toBe('none');
    expect(fromFlag.candidate.options.idleTimeoutMinutes).toBe(0);
  });

  it('should report an unreadable whole number instead of guessing', async () => {
    const { problems } = await resolveCreateSelection(dependencies, {
      options: { nonInteractive: true },
      sources: {
        processEnv: { OPEN_AGENT_IDLE_MINUTES: 'soon' },
        fileEnv: {},
        profile: {},
      },
    });

    expect(problems).toEqual([
      'OPEN_AGENT_IDLE_MINUTES must be a whole number',
    ]);
  });

  it('should take the update due interval from the flag, then the env file, then the process environment, then the default, without prompting', async () => {
    const { interaction, asked } = recordingInteraction();
    const sources: InputSources = {
      processEnv: { OPEN_AGENT_UPDATE_DUE_DAYS: '3' },
      fileEnv: { OPEN_AGENT_UPDATE_DUE_DAYS: '9' },
      profile: {},
    };

    const fromSources = await resolveCreateSelection(dependencies, {
      options: { network: 'tailscale' },
      sources,
      interaction,
    });
    const fromFlags = await resolveCreateSelection(dependencies, {
      options: { nonInteractive: true, updateDueDays: 2 },
      sources,
    });
    const fromDefaults = await resolveCreateSelection(dependencies, {
      options: { nonInteractive: true },
      sources: empty,
    });

    expect(asked.filter((message) => /update/iu.test(message))).toEqual([]);
    expect(
      [fromSources, fromFlags, fromDefaults].map(
        ({ candidate: { options } }) => options.updateDueIntervalDays,
      ),
    ).toEqual([9, 2, 1]);
  });

  it('should report an unreadable update interval instead of guessing', async () => {
    const { problems } = await resolveCreateSelection(dependencies, {
      options: { nonInteractive: true },
      sources: {
        processEnv: { OPEN_AGENT_UPDATE_DUE_DAYS: '1.5' },
        fileEnv: {},
        profile: {},
      },
    });

    expect(problems).toEqual([
      'OPEN_AGENT_UPDATE_DUE_DAYS must be a whole number',
    ]);
  });

  it('should report every unreadable boolean and number together without prompting', async () => {
    const { interaction, asked } = recordingInteraction();

    const { problems } = await resolveCreateSelection(dependencies, {
      options: {},
      sources: {
        processEnv: {
          OPEN_AGENT_USE_EXIT_NODE: 'maybe',
          CLIPROXYAPI_ENABLED: 'sometimes',
          OPEN_AGENT_HOLD_MAX_MINUTES: 'soon',
        },
        fileEnv: {},
        profile: {},
      },
      interaction,
    });

    expect(asked).toEqual([]);
    expect(problems).toEqual([
      'OPEN_AGENT_USE_EXIT_NODE must be a boolean value (true or false)',
      'CLIPROXYAPI_ENABLED must be a boolean value (true or false)',
      'OPEN_AGENT_HOLD_MAX_MINUTES must be a whole number',
    ]);
  });

  it('should default an option prompt to the value its inputs imply', async () => {
    const { interaction } = recordingInteraction();

    const { candidate } = await resolveCreateSelection(dependencies, {
      options: { network: 'tailscale' },
      sources: {
        processEnv: { TAILSCALE_EXIT_NODE: 'exit-node' },
        fileEnv: {},
        profile: {},
      },
      interaction,
    });

    expect(candidate.options.isExitNodeEnabled).toBe(true);
  });
});

describe('fn:resolveCreateSelection storage', () => {
  it.each([
    {
      option: 'minStorageGb',
      flag: { storage: 40 },
      environment: 'OPEN_AGENT_STORAGE',
      fromFile: '30',
      fromProcess: '20',
      expected: [40, 30, 20, 10],
    },
    {
      option: 'autoExtend',
      flag: { autoExtend: true },
      environment: 'OPEN_AGENT_AUTO_EXTEND',
      fromFile: 'false',
      fromProcess: 'true',
      expected: [true, false, true, undefined],
    },
    {
      option: 'autoExtendThresholdPercent',
      flag: { autoExtendAt: 85 },
      environment: 'OPEN_AGENT_AUTO_EXTEND_AT',
      fromFile: '70',
      fromProcess: '60',
      expected: [85, 70, 60, 80],
    },
    {
      option: 'autoExtendStepGb',
      flag: { autoExtendStep: 5 },
      environment: 'OPEN_AGENT_AUTO_EXTEND_STEP',
      fromFile: '7',
      fromProcess: '9',
      expected: [5, 7, 9, 10],
    },
    {
      option: 'storageLimitGb',
      flag: { storageLimit: 200 },
      environment: 'OPEN_AGENT_STORAGE_LIMIT',
      fromFile: '150',
      fromProcess: '120',
      expected: [200, 150, 120, 100],
    },
  ] satisfies Array<{
    option: keyof ProfileOptions;
    flag: CommandOptions;
    environment: string;
    fromFile: string;
    fromProcess: string;
    expected: unknown[];
  }>)(
    'should take $option from the flag, then the credential file, then the process environment, then the default',
    async ({ option, flag, environment, fromFile, fromProcess, expected }) => {
      const options = {
        nonInteractive: true,
        provider: 'fly-machine' as const,
      };
      const both = {
        processEnv: { [environment]: fromProcess },
        fileEnv: { [environment]: fromFile },
        profile: {},
      };

      const resolved = await Promise.all(
        [
          { options: { ...options, ...flag }, sources: both },
          { options, sources: both },
          { options, sources: { ...both, fileEnv: {} } },
          { options, sources: empty },
        ].map(async (context) => resolveCreateSelection(dependencies, context)),
      );

      expect(
        resolved.map(({ candidate }) => candidate.options[option]),
      ).toEqual(expected);
    },
  );

  it('should ask for storage after memory, then for growth and its limit where the provider grows storage', async () => {
    const { interaction, asked } = recordingInteraction();

    const resolution = await resolveCreateSelection(dependencies, {
      options: { provider: 'fly-machine' },
      sources: empty,
      interaction,
    });

    expect(asked.slice(0, 5)).toEqual([
      'Minimum CPUs',
      'Minimum memory (GB)',
      'Minimum storage (GB)',
      'Grow storage automatically?',
      'Grow up to (GB)',
    ]);
    expect(resolution).toMatchObject({
      candidate: {
        options: {
          minStorageGb: 10,
          autoExtend: true,
          autoExtendThresholdPercent: 80,
          autoExtendStepGb: 10,
          storageLimitGb: 100,
        },
      },
      isStorageLimitRequested: true,
      storagePolicyFlags: [],
    });
  });

  it('should offer the default limit raised to the starting size', async () => {
    const { interaction } = recordingInteraction();

    const { candidate } = await resolveCreateSelection(dependencies, {
      options: { provider: 'fly-machine', storage: 150 },
      sources: empty,
      interaction,
    });

    expect(candidate.options.storageLimitGb).toBe(150);
  });

  it('should ask only for the minimum storage where the provider cannot grow it', async () => {
    const { interaction, asked } = recordingInteraction();

    const { candidate } = await resolveCreateSelection(dependencies, {
      options: { provider: 'sprite' },
      sources: empty,
      interaction,
    });

    expect(asked.filter((message) => /storage|Grow/u.test(message))).toEqual([
      'Minimum storage (GB)',
    ]);
    expect(candidate.options).not.toHaveProperty('autoExtend');
  });

  it('should skip the limit prompt when growth is declined', async () => {
    const { interaction, asked } = recordingInteraction();
    const declining: Interaction = {
      ...interaction,
      // decline growth, answering every other question with its default
      confirm: async (prompt) =>
        (await interaction.confirm(prompt)) &&
        prompt.message !== 'Grow storage automatically?',
    };

    const resolution = await resolveCreateSelection(dependencies, {
      options: { provider: 'fly-machine' },
      sources: empty,
      interaction: declining,
    });

    expect(asked).toContain('Grow storage automatically?');
    expect(asked).not.toContain('Grow up to (GB)');
    expect(resolution).toMatchObject({
      candidate: { options: { autoExtend: false, storageLimitGb: 100 } },
      isStorageLimitRequested: false,
    });
  });

  it('should not ask for storage a flag or the environment already answers', async () => {
    const { interaction, asked } = recordingInteraction();

    await resolveCreateSelection(dependencies, {
      options: { provider: 'fly-machine', storage: 20 },
      sources: {
        processEnv: {
          OPEN_AGENT_AUTO_EXTEND: 'true',
          OPEN_AGENT_STORAGE_LIMIT: '50',
        },
        fileEnv: {},
        profile: {},
      },
      interaction,
    });

    expect(asked.filter((message) => /storage|Grow/u.test(message))).toEqual(
      [],
    );
  });

  it.each([
    { provider: 'fly-machine', autoExtend: false },
    { provider: 'sprite' },
  ] satisfies CommandOptions[])(
    'should drop policy values from the environment while growth is not on, yet keep explicit flags for validation: %j',
    async (choice) => {
      const sources: InputSources = {
        processEnv: { OPEN_AGENT_AUTO_EXTEND_AT: '30' },
        fileEnv: {
          OPEN_AGENT_AUTO_EXTEND_STEP: '0',
          OPEN_AGENT_STORAGE_LIMIT: '5',
        },
        profile: {},
      };

      const fromEnvironment = await resolveCreateSelection(dependencies, {
        options: { nonInteractive: true, ...choice },
        sources,
      });
      const fromFlags = await resolveCreateSelection(dependencies, {
        options: {
          nonInteractive: true,
          ...choice,
          autoExtendAt: 85,
          storageLimit: 50,
        },
        sources,
      });

      expect(fromEnvironment).toMatchObject({
        candidate: {
          options: {
            autoExtendThresholdPercent: 80,
            autoExtendStepGb: 10,
            storageLimitGb: 100,
          },
        },
        isStorageLimitRequested: false,
        storagePolicyFlags: [],
      });
      expect(fromFlags).toMatchObject({
        candidate: {
          options: {
            autoExtendThresholdPercent: 85,
            autoExtendStepGb: 10,
            storageLimitGb: 50,
          },
        },
        isStorageLimitRequested: true,
        storagePolicyFlags: ['autoExtendThresholdPercent', 'storageLimitGb'],
      });
    },
  );

  it('should keep environment policy values for an unknown provider choice so validation reports them', async () => {
    const { candidate } = await resolveCreateSelection(dependencies, {
      options: { nonInteractive: true },
      sources: {
        processEnv: {
          OPEN_AGENT_PROVIDER: 'unregistered-provider',
          OPEN_AGENT_AUTO_EXTEND_AT: '30',
        },
        fileEnv: {},
        profile: {},
      },
    });

    expect(candidate.options.autoExtendThresholdPercent).toBe(30);
  });

  it('should refuse an automatic growth value other than true or false', async () => {
    const { problems } = await resolveCreateSelection(dependencies, {
      options: { nonInteractive: true },
      sources: {
        processEnv: { OPEN_AGENT_AUTO_EXTEND: 'yes' },
        fileEnv: {},
        profile: {},
      },
    });

    expect(problems).toEqual(['OPEN_AGENT_AUTO_EXTEND must be true or false']);
  });
});

describe('fn:readSetupSelection storage', () => {
  it('should read the storage size from its flag alone and ignore every storage variable', () => {
    const sources: InputSources = {
      processEnv: {
        OPEN_AGENT_STORAGE: '80',
        OPEN_AGENT_AUTO_EXTEND: 'maybe',
        OPEN_AGENT_STORAGE_LIMIT: 'lots',
      },
      fileEnv: { OPEN_AGENT_AUTO_EXTEND_AT: '90' },
      profile: {},
    };

    const flagged = readSetupSelection(dependencies, {
      options: { storage: 60 },
      sources,
      section: 'all',
    });
    const unflagged = readSetupSelection(dependencies, {
      options: {},
      sources,
      section: 'all',
    });

    expect(flagged.problems).toEqual([]);
    expect(flagged.value.options).toEqual(
      expect.objectContaining({ minStorageGb: 60 }),
    );
    expect(
      [flagged, unflagged].map(({ value: { options } }) => [
        options.autoExtend,
        options.autoExtendThresholdPercent,
        options.storageLimitGb,
      ]),
    ).toEqual([
      [undefined, undefined, undefined],
      [undefined, undefined, undefined],
    ]);
    expect(unflagged.value.options.minStorageGb).toBeUndefined();
  });

  it('should keep the recorded storage options when setup supplies a size to grow to', async () => {
    const recorded = defaultProfile(defaults, 'none');

    const resolution = await resolveSetup({
      options: { nonInteractive: true, storage: 60 },
      sources: empty,
      recorded,
      section: 'all',
    });

    expect(resolution).toMatchObject({
      candidate: { options: recorded.options },
      isStorageLimitRequested: false,
      storagePolicyFlags: [],
    });
  });
});

describe('fn:resolveSetupSelection', () => {
  it('should keep the recorded selection and take provider and agent only from flags', async () => {
    const recorded = defaultProfile(defaults, 'none');

    const { candidate } = await resolveSetup({
      options: { agent: 't3' },
      sources: {
        processEnv: { OPEN_AGENT_NETWORK: 'tailscale' },
        fileEnv: {},
        profile: {},
      },
      recorded,
      section: 'git',
    });

    expect(candidate).toMatchObject({
      provider: 'sprite',
      agent: 't3',
      harnesses: recorded.harnesses,
      network: 'none',
    });
  });

  it('should select an installable network when the network section targets a workstation without one', async () => {
    const { candidate } = await resolveSetup({
      options: { nonInteractive: true },
      sources: empty,
      recorded: defaultProfile(defaults, 'none'),
      section: 'network',
    });

    expect(candidate.network).toBe('tailscale');
  });

  it('should keep the recorded exit node when only the proxy section is targeted', async () => {
    const tailscale = defaultProfile(defaults, 'tailscale');
    const recorded = {
      ...tailscale,
      options: { ...tailscale.options, isExitNodeEnabled: true },
    };

    const { candidate } = await resolveSetup({
      options: { nonInteractive: true, useExitNode: false, proxy: false },
      sources: {
        processEnv: { OPEN_AGENT_IDLE_MINUTES: '5' },
        fileEnv: {},
        profile: {},
      },
      recorded,
      section: 'proxy',
    });

    expect(candidate.network).toBe('tailscale');
    expect(candidate.options).toEqual({
      ...recorded.options,
      isProxyEnabled: false,
    });
  });

  it('should keep the recorded proxy when only the network section is targeted', async () => {
    const tailscale = defaultProfile(defaults, 'tailscale');
    const recorded = {
      ...tailscale,
      options: { ...tailscale.options, isProxyEnabled: true },
    };

    const { candidate } = await resolveSetup({
      options: { nonInteractive: true, proxy: false, useExitNode: true },
      sources: empty,
      recorded,
      section: 'network',
    });

    expect(candidate.options).toEqual({
      ...recorded.options,
      isExitNodeEnabled: true,
    });
  });

  it('should not read an environment value the targeted section does not own', () => {
    const { value, problems } = readSetupSelection(dependencies, {
      options: {},
      sources: {
        processEnv: {
          OPEN_AGENT_USE_EXIT_NODE: 'maybe',
          CLIPROXYAPI_ENABLED: 'true',
        },
        fileEnv: {},
        profile: {},
      },
      section: 'proxy',
    });

    expect(problems).toEqual([]);
    expect(value.options).toEqual({
      isExitNodeEnabled: undefined,
      isProxyEnabled: true,
      idleTimeoutMinutes: undefined,
      holdMaxMinutes: undefined,
    });
  });
});

describe('fn:resolveSetupSelection update intervals', () => {
  it('should apply a supplied update interval to the recorded profile when the tools section is targeted', async () => {
    const recorded = defaultProfile(defaults, 'none');

    const { candidate } = await resolveSetup({
      options: { nonInteractive: true, updateDueDays: 3 },
      sources: empty,
      recorded,
      section: 'tools',
    });

    expect(candidate.options).toEqual({
      ...recorded.options,
      updateDueIntervalDays: 3,
    });
  });

  it('should not read an update interval the targeted section does not own', () => {
    const { value, problems } = readSetupSelection(dependencies, {
      options: {},
      sources: {
        processEnv: { OPEN_AGENT_UPDATE_DUE_DAYS: 'often' },
        fileEnv: {},
        profile: {},
      },
      section: 'proxy',
    });

    expect({ problems, options: value.options }).toEqual({
      problems: [],
      options: {
        isExitNodeEnabled: undefined,
        isProxyEnabled: undefined,
        idleTimeoutMinutes: undefined,
        holdMaxMinutes: undefined,
        updateDueIntervalDays: undefined,
      },
    });
  });
});

describe('fn:suppliedSelectionViolations', () => {
  it('should validate an agent release with the sole registered agent when none is named', () => {
    const violations = suppliedSelectionViolations(
      dependencies,
      { options: { agentRelease: 'unregistered-release' } },
      { isPairingRequested: false },
    );

    expect(violations).toMatchObject([
      { code: 'invalid-option', fields: ['agent', 'agentRelease'] },
    ]);
  });

  it('should defer a machine-size capability check until one of several providers is named', () => {
    const supplied = { options: { minCpus: 17, minMemoryGb: 129 } };
    const deferred = suppliedSelectionViolations(dependencies, supplied, {
      isPairingRequested: false,
    });
    const determined = suppliedSelectionViolations(
      dependencies,
      { ...supplied, provider: 'sprite' },
      { isPairingRequested: false },
    );

    expect(deferred).toEqual([]);
    expect(determined).toMatchObject([
      {
        code: 'undeclared-capability',
        fields: ['provider', 'minCpus', 'minMemoryGb'],
      },
    ]);
  });

  it('should accept a complete compatible selection before workstation lookup', () => {
    const violations = suppliedSelectionViolations(
      dependencies,
      {
        provider: 'sprite',
        agent: 't3',
        harnesses: ['claude'],
        network: 'none',
        options: {},
      },
      { isPairingRequested: false },
    );

    expect(violations).toEqual([]);
  });

  it('should report supplied option bounds and capabilities whose drivers are all known', () => {
    const violations = suppliedSelectionViolations(
      dependencies,
      {
        network: 'none',
        options: { isExitNodeEnabled: true, holdMaxMinutes: 0 },
      },
      { isPairingRequested: false },
    );

    expect(violations.map(({ message }) => message)).toEqual([
      '--use-exit-node (OPEN_AGENT_USE_EXIT_NODE) needs a network that supports exit nodes; "none" does not',
      '--hold-max-minutes (OPEN_AGENT_HOLD_MAX_MINUTES) must be a whole number of minutes of at least 1',
    ]);
  });

  it('should report an update interval below one together with the other violations', () => {
    const violations = suppliedSelectionViolations(
      dependencies,
      {
        network: 'none',
        options: { holdMaxMinutes: 0, updateDueIntervalDays: -2 },
      },
      { isPairingRequested: false },
    );

    expect(violations.map(({ message }) => message)).toEqual([
      expect.stringContaining('--hold-max-minutes'),
      expect.stringContaining('--update-due-days'),
    ]);
  });

  it('should state the allowed range when an update interval is beyond its upper bound', () => {
    const violations = suppliedSelectionViolations(
      dependencies,
      {
        network: 'none',
        options: { updateDueIntervalDays: MAX_UPDATE_DUE_DAYS + 1 },
      },
      { isPairingRequested: false },
    );

    expect(violations.map(({ message }) => message)).toEqual([
      `--update-due-days (OPEN_AGENT_UPDATE_DUE_DAYS) must be a whole number of days from 1 to ${String(MAX_UPDATE_DUE_DAYS)}`,
    ]);
  });

  it('should leave a capability that depends on the recorded profile for later', () => {
    const violations = suppliedSelectionViolations(
      dependencies,
      { options: { isExitNodeEnabled: true } },
      { isPairingRequested: false },
    );

    expect(violations).toEqual([]);
  });

  it('should report an unknown supplied driver id', () => {
    const violations = suppliedSelectionViolations(
      dependencies,
      { agent: 'nope', options: {} },
      { isPairingRequested: false },
    );

    expect(violations.map(({ message }) => message)).toEqual([
      expect.stringContaining('Unknown ACP agent "nope"'),
    ]);
  });
});

describe('fn:selectionRequirements', () => {
  it('should require network inputs only for an installable network and skip enrollment for an enrolled device', () => {
    const none = defaultProfile(defaults, 'none');
    const tailscale = defaultProfile(defaults, 'tailscale');
    const routed = {
      ...tailscale,
      options: { ...tailscale.options, isExitNodeEnabled: true },
    };

    expect(
      selectionRequirements(dependencies, {
        profile: none,
        base: ['providerToken'],
      }),
    ).toEqual(['providerToken']);
    expect(selectionRequirements(dependencies, { profile: routed })).toEqual([
      'networkEnrollment',
      'networkAccount',
      'exitNode',
    ]);
    expect(
      selectionRequirements(dependencies, {
        profile: tailscale,
        base: [],
        isEnrolled: true,
      }),
    ).toEqual(['networkAccount']);
  });
});
