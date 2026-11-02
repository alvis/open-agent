import { describe, expect, it } from 'vitest';

import {
  readSetupSelection,
  resolveCreateSelection,
  resolveSetupSelection,
} from '#application/input/selection';
import { suppliedSelectionViolations } from '#application/input/selection/supplied';
import { defaults } from '#composition/defaults';
import { defaultProfile, MAX_UPDATE_DUE_DAYS } from '#domain/profile';

import { dependencies } from '../../mocks/dependencies';

import type { SetupSection } from '#application/contracts';
import type { SelectionContext } from '#application/input/selection/sources';
import type { InputSources } from '#application/input/sources';
import type {
  Interaction,
  InteractionChoice,
  InteractionPrompt,
} from '#application/ports/interaction';
import type { WorkstationProfile } from '#domain/profile';

const empty: InputSources = { processEnv: {}, fileEnv: {} };

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
  it('should ask harnesses and the supported options in order while skipping single-choice steps and hold-max', async () => {
    const { interaction, asked } = recordingInteraction();

    const { candidate } = await resolveCreateSelection(dependencies, {
      options: {},
      sources: empty,
      interaction,
    });

    expect(asked).toEqual([
      'Release channel',
      'Suspend after idle (minutes, 0 = never)',
    ]);
    expect(candidate).toMatchObject({
      provider: 'sprite',
      agent: 't3',
      harnesses: ['claude'],
      network: 'none',
    });
  });

  it('should not prompt for a step a flag already answers', async () => {
    const { interaction, asked } = recordingInteraction();

    const { candidate } = await resolveCreateSelection(dependencies, {
      options: {
        provider: 'sprite',
        release: 'stable',
        harness: ['claude'],
        network: 'none',
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
    };

    const fromSources = await resolveCreateSelection(dependencies, {
      options: { network: 'none' },
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
      },
    });

    expect(problems).toEqual([
      'OPEN_AGENT_UPDATE_DUE_DAYS must be a whole number',
    ]);
  });

  it('should report every unreadable number together without prompting', async () => {
    const { interaction, asked } = recordingInteraction();

    const { problems } = await resolveCreateSelection(dependencies, {
      options: {},
      sources: {
        processEnv: {
          OPEN_AGENT_IDLE_MINUTES: 'later',
          OPEN_AGENT_HOLD_MAX_MINUTES: 'soon',
        },
        fileEnv: {},
      },
      interaction,
    });

    expect(asked).toEqual([]);
    expect(problems).toEqual([
      'OPEN_AGENT_IDLE_MINUTES must be a whole number',
      'OPEN_AGENT_HOLD_MAX_MINUTES must be a whole number',
    ]);
  });
});

describe('fn:resolveSetupSelection', () => {
  it('should keep the recorded selection and take provider and agent only from flags', async () => {
    const recorded = defaultProfile(defaults);

    const { candidate } = await resolveSetup({
      options: { agent: 't3' },
      sources: {
        processEnv: { OPEN_AGENT_NETWORK: 'unregistered-network' },
        fileEnv: {},
      },
      recorded,
      section: 'agent',
    });

    expect(candidate).toMatchObject({
      provider: 'sprite',
      agent: 't3',
      harnesses: recorded.harnesses,
      network: 'none',
    });
  });

  it('should keep the recorded idle minutes when only the network section is targeted', async () => {
    const profile = defaultProfile(defaults);
    const recorded = {
      ...profile,
      options: { ...profile.options, idleTimeoutMinutes: 9 },
    };

    const { candidate } = await resolveSetup({
      options: { nonInteractive: true, idleMinutes: 0 },
      sources: empty,
      recorded,
      section: 'network',
    });

    expect(candidate.options).toEqual(recorded.options);
  });

  it('should not read an environment value the targeted section does not own', () => {
    const { value, problems } = readSetupSelection(dependencies, {
      options: {},
      sources: {
        processEnv: {
          OPEN_AGENT_UPDATE_DUE_DAYS: '3',
          OPEN_AGENT_IDLE_MINUTES: '5',
        },
        fileEnv: {},
      },
      section: 'tools',
    });

    expect(problems).toEqual([]);
    expect(value.options).toEqual({
      updateDueIntervalDays: 3,
      idleTimeoutMinutes: undefined,
      holdMaxMinutes: undefined,
    });
  });
});

describe('fn:resolveSetupSelection update intervals', () => {
  it('should apply a supplied update interval to the recorded profile when the tools section is targeted', async () => {
    const recorded = defaultProfile(defaults);

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
      },
      section: 'agent',
    });

    expect({ problems, options: value.options }).toEqual({
      problems: [],
      options: {
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

  it('should defer a provider capability check until a provider is named', () => {
    const supplied = { options: { holdMaxMinutes: 61 } };
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
        fields: ['provider', 'holdMaxMinutes'],
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

  it('should report supplied option bounds', () => {
    const violations = suppliedSelectionViolations(
      dependencies,
      {
        network: 'none',
        options: { holdMaxMinutes: 0 },
      },
      { isPairingRequested: false },
    );

    expect(violations.map(({ message }) => message)).toEqual([
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
