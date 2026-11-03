import { describe, expect, it, vi } from 'vitest';

import { commandError } from '#application/failures';
import { resolveBaseInputs } from '#application/input/base';

import { redactResolved } from '#kernel/redaction';

import { DISABLED_NETWORK_PROFILE } from '../../fixtures/profile';

import { dependencies } from '../../mocks/dependencies';

describe('fn:resolveBaseInputs', () => {
  it('should retain a completed sibling secret when another Promise.all source rejects', async () => {
    const secret = 'saf08-partial-sibling-secret';
    const sources = {
      processEnv: { SPRITES_TOKEN: secret },
      fileEnv: {},
    };

    await expect(
      resolveBaseInputs(dependencies, {
        options: {
          localCredentials: false,
          githubTokenSource: 'file:/nonexistent/saf08-secret-source',
        },
        sources,
        selection: { profile: DISABLED_NETWORK_PROFILE },
      }),
    ).rejects.toMatchObject({ code: 'INPUT' });
    expect(redactResolved(`provider rejected ${secret}`)).toBe(
      'provider rejected [REDACTED]',
    );
    expect(
      commandError(new Error(`provider rejected ${secret}`)),
    ).toMatchObject({
      message: 'provider rejected [REDACTED]',
    });
  });

  it('should resolve credential file and process precedence', async () => {
    const resolved = await resolveBaseInputs(dependencies, {
      options: {
        name: 'chosen',
        localCredentials: false,
        credentialFile: 'selected.env',
      },
      sources: {
        processEnv: {
          SPRITES_TOKEN: 'process-management-token',
          GH_TOKEN: 'process-github-token',
        },
        fileEnv: {
          SPRITES_TOKEN: 'file-management-token',
          CREDENTIAL_ONLY: 'credential-file-value',
        },
      },
      selection: { profile: DISABLED_NETWORK_PROFILE },
    });

    expect(resolved).toEqual({
      input: {
        name: 'chosen',
        providerToken: 'file-management-token',
        profile: DISABLED_NETWORK_PROFILE,
        sources: {
          SPRITES_TOKEN: 'SPRITES_TOKEN in selected.env',
          GH_TOKEN: 'process environment',
        },
        missing: [],
      },
      githubCandidate: 'process-github-token',
    });
    expect(redactResolved('file-management-token process-github-token')).toBe(
      '[REDACTED] [REDACTED]',
    );
  });

  it('should select explicit secret references and record source descriptions without values', async () => {
    vi.stubEnv('OPEN_AGENT_BASE_SPRITES', 'explicit-sprites-secret');
    vi.stubEnv('OPEN_AGENT_BASE_GITHUB', 'explicit-github-secret');

    const resolved = await resolveBaseInputs(dependencies, {
      options: {
        localCredentials: false,
        providerTokenSource: 'env:OPEN_AGENT_BASE_SPRITES',
        githubTokenSource: 'env:OPEN_AGENT_BASE_GITHUB',
      },
      sources: { processEnv: {}, fileEnv: {} },
      selection: { profile: DISABLED_NETWORK_PROFILE },
    });

    expect(resolved).toEqual(
      expect.objectContaining({
        githubCandidate: 'explicit-github-secret',
        input: expect.objectContaining({
          providerToken: 'explicit-sprites-secret',
          sources: {
            SPRITES_TOKEN:
              '--provider-token-source env:OPEN_AGENT_BASE_SPRITES',
            GH_TOKEN: 'explicit secret reference',
          },
        }),
      }),
    );
    expect(
      redactResolved('explicit-sprites-secret explicit-github-secret'),
    ).toBe('[REDACTED] [REDACTED]');
  });

  it('should leave GitHub discovery disabled when requested and use its legacy token fallback otherwise', async () => {
    const sources = {
      processEnv: {},
      fileEnv: { GITHUB_TOKEN: 'legacy-github-secret' },
    };

    const disabled = await resolveBaseInputs(dependencies, {
      options: { localCredentials: false, github: false },
      sources,
    });
    const selected = await resolveBaseInputs(dependencies, {
      options: { localCredentials: false },
      sources,
    });

    expect({
      disabled: disabled.githubCandidate,
      selected: selected.githubCandidate,
      sources: selected.input.sources,
    }).toEqual({
      disabled: undefined,
      selected: 'legacy-github-secret',
      sources: { GITHUB_TOKEN: 'credential file' },
    });
  });
});
