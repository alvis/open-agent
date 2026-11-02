import { describe, expect, it } from 'vitest';

import {
  activePrompts,
  environmentReader,
} from '#application/input/selection/sources';

import type { InputSources } from '#application/input/sources';
import type { Interaction } from '#application/ports/interaction';

describe('fn:environmentReader', () => {
  it('should trim comma-separated values from the selected file', () => {
    const sources = {
      processEnv: { OPEN_AGENT_HARNESSES: 'claude' },
      fileEnv: { OPEN_AGENT_HARNESSES: ' claude, , claude ' },
    } satisfies InputSources;
    const read = environmentReader(sources);

    expect(read.list('OPEN_AGENT_HARNESSES')).toEqual(['claude', 'claude']);
  });
});

describe('fn:activePrompts', () => {
  it('should skip a single-choice prompt', async () => {
    const interaction = {
      input: async () => {
        throw new Error('Unexpected input prompt');
      },
      secret: async () => '',
      select: async <V extends string>(): Promise<V> => {
        throw new Error('Unexpected selection prompt');
      },
      multiselect: async <V extends string>(): Promise<V[]> => {
        throw new Error('Unexpected multiple-choice prompt');
      },
      confirm: async () => false,
      progress: () => undefined,
      status: () => undefined,
    } satisfies Interaction;
    const prompts = activePrompts({
      options: {},
      sources: { processEnv: {}, fileEnv: {} },
      interaction,
    });

    expect(
      await prompts?.chooseMany('Harnesses', [
        { label: 'Claude', value: 'claude' },
      ]),
    ).toBeUndefined();
  });
});
