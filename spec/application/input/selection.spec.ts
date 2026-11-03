import { describe, expect, it } from 'vitest';

import { resolveCreateSelection } from '#application/input/selection';

import { dependencies } from '../../mocks/dependencies';

import type { InputSources } from '#application/input/sources';
import type {
  Interaction,
  InteractionChoice,
  InteractionPrompt,
} from '#application/ports/interaction';

const empty: InputSources = { processEnv: {}, fileEnv: {} };

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
  it('should skip single-choice steps', async () => {
    const { interaction, asked } = recordingInteraction();

    const { candidate } = await resolveCreateSelection(dependencies, {
      options: {},
      sources: empty,
      interaction,
    });

    expect(asked).toEqual([]);
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
        harness: ['claude'],
        network: 'none',
      },
      sources: empty,
      interaction,
    });

    expect(asked).toEqual([]);
    expect(candidate.network).toBe('none');
  });

  it('should take the flag over the env file over the process environment', async () => {
    const sources: InputSources = {
      processEnv: { OPEN_AGENT_NETWORK: 'process-network' },
      fileEnv: { OPEN_AGENT_NETWORK: 'file-network' },
    };

    const fromEnvironment = await resolveCreateSelection(dependencies, {
      options: { nonInteractive: true },
      sources,
    });
    const fromFlag = await resolveCreateSelection(dependencies, {
      options: { nonInteractive: true, network: 'none' },
      sources,
    });

    expect(fromEnvironment.candidate.network).toBe('file-network');
    expect(fromFlag.candidate.network).toBe('none');
  });
});
