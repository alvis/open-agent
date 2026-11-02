import { describe, expect, it } from 'vitest';

import {
  defaultHarnesses,
  harnessChoices,
  inferredOptions,
} from '#application/input/selection/choices';

import { dependencies } from '../../../mocks/dependencies';

describe('fn:harnessChoices', () => {
  it('should offer registered harnesses when the selected agent is not recognized', () => {
    const choices = harnessChoices(dependencies, 'unregistered-agent');

    expect(choices.map(({ value }) => value)).toEqual(['claude', 'codex']);
    expect(choices.every(({ isPreselected }) => isPreselected)).toBe(true);
  });
});

describe('fn:defaultHarnesses', () => {
  it('should offer supported harnesses when no configured default applies', () => {
    const configured = {
      registry: dependencies.registry,
      defaults: {
        ...dependencies.defaults,
        selection: { ...dependencies.defaults.selection, harnesses: [] },
      },
    };

    expect(defaultHarnesses(configured, 't3')).toEqual(['claude', 'codex']);
  });
});

describe('fn:inferredOptions', () => {
  it('should infer the proxy from a supplied CLIProxyAPI hub', () => {
    expect(
      inferredOptions(dependencies, {
        options: {},
        sources: {
          processEnv: { CLIPROXYAPI_BASE_URL: 'https://hub.example.test' },
          fileEnv: {},
          profile: {},
        },
      }),
    ).toEqual({ isProxyEnabled: true });
  });
});
