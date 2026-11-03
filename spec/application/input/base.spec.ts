import { describe, expect, it, vi } from 'vitest';

import { resolveBaseInputs } from '#application/input/base';

import { redactResolved } from '#kernel/redaction';

import { DISABLED_NETWORK_PROFILE } from '../../fixtures/profile';

import { dependencies } from '../../mocks/dependencies';

describe('fn:resolveBaseInputs', () => {
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
        },
        missing: [],
      },
    });
    expect(redactResolved('file-management-token')).toBe('[REDACTED]');
  });

  it('should select explicit secret references and record source descriptions without values', async () => {
    vi.stubEnv('OPEN_AGENT_BASE_SPRITES', 'explicit-sprites-secret');

    const resolved = await resolveBaseInputs(dependencies, {
      options: {
        localCredentials: false,
        providerTokenSource: 'env:OPEN_AGENT_BASE_SPRITES',
      },
      sources: { processEnv: {}, fileEnv: {} },
      selection: { profile: DISABLED_NETWORK_PROFILE },
    });

    expect(resolved).toEqual(
      expect.objectContaining({
        input: expect.objectContaining({
          providerToken: 'explicit-sprites-secret',
          sources: {
            SPRITES_TOKEN:
              '--provider-token-source env:OPEN_AGENT_BASE_SPRITES',
          },
        }),
      }),
    );
    expect(redactResolved('explicit-sprites-secret')).toBe('[REDACTED]');
  });
});
