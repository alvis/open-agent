import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { commandError } from '#application/failures';
import {
  requireValidProfile,
  requireValidSuppliedSelection,
  resolveCreateInputs,
  resolveInputs,
} from '#application/input';
import { resolveProviderCredential } from '#application/input/provider-credential';

import { DISABLED_NETWORK_PROFILE } from '../fixtures/profile';
import { dependencies } from '../mocks/dependencies';

describe('fn:requireValidProfile', () => {
  it('should return a valid resolved profile', () => {
    expect(
      requireValidProfile(
        dependencies,
        {
          candidate: DISABLED_NETWORK_PROFILE,
          problems: [],
          isIdleTimeoutRequested: false,
        },
        {},
      ),
    ).toEqual(DISABLED_NETWORK_PROFILE);
  });

  it('should report unreadable selection input and capability violations together', () => {
    let failure: unknown;
    try {
      requireValidProfile(
        dependencies,
        {
          candidate: { ...DISABLED_NETWORK_PROFILE, harnesses: [] },
          problems: ['OPEN_AGENT_IDLE_MINUTES must be a whole number'],
          isIdleTimeoutRequested: true,
        },
        {},
      );
    } catch (error) {
      failure = error;
    }

    expect(commandError(failure)).toMatchObject({
      code: 'INPUT',
      details: [
        'OPEN_AGENT_IDLE_MINUTES must be a whole number',
        expect.stringContaining('harness'),
      ],
    });
  });

  it('should report an unreadable input even when the resolved profile is valid', () => {
    let failure: unknown;
    try {
      requireValidProfile(
        dependencies,
        {
          candidate: DISABLED_NETWORK_PROFILE,
          problems: ['OPEN_AGENT_IDLE_MINUTES must be a whole number'],
          isIdleTimeoutRequested: false,
        },
        {},
      );
    } catch (error) {
      failure = error;
    }

    expect(commandError(failure)).toMatchObject({
      code: 'INPUT',
      details: ['OPEN_AGENT_IDLE_MINUTES must be a whole number'],
    });
  });
});

describe('fn:requireValidSuppliedSelection', () => {
  it('should accept a compatible supplied selection', () => {
    expect(() =>
      requireValidSuppliedSelection(
        dependencies,
        { value: { provider: 'sprite', options: {} }, problems: [] },
        {},
      ),
    ).not.toThrow();
  });

  it('should aggregate unreadable values and an unknown driver before workstation lookup', () => {
    let failure: unknown;
    try {
      requireValidSuppliedSelection(
        dependencies,
        {
          value: { agent: 'unregistered-agent', options: {} },
          problems: ['OPEN_AGENT_IDLE_MINUTES must be a whole number'],
        },
        {},
      );
    } catch (error) {
      failure = error;
    }

    expect(commandError(failure)).toMatchObject({
      code: 'INPUT',
      details: [
        'OPEN_AGENT_IDLE_MINUTES must be a whole number',
        expect.stringContaining('unregistered-agent'),
      ],
    });
  });
});

describe('fn:resolveInputs', () => {
  it('should derive create preflight requirements from the selected integrations', async () => {
    vi.stubEnv('SPRITES_TOKEN', undefined);
    const directory = await mkdtemp(join(tmpdir(), 'open-agent-create-input-'));
    vi.stubEnv('HOME', directory);

    try {
      const selected = await resolveCreateInputs(dependencies, {
        network: 'none',
        nonInteractive: true,
        localCredentials: false,
        github: false,
      });

      expect({
        network: selected.profile.network,
        missing: selected.missing,
      }).toEqual({
        network: 'none',
        missing: [expect.stringContaining('--name')],
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('should resolve a read-only provider token from the selected file or explicit reference', async () => {
    vi.stubEnv('SPRITES_TOKEN', undefined);
    const directory = await mkdtemp(
      join(tmpdir(), 'open-agent-provider-token-'),
    );
    vi.stubEnv('HOME', directory);
    const path = join(directory, 'chosen.env');
    const secretPath = join(directory, 'secret');
    await writeFile(
      path,
      ['SPRITES_TOKEN=file-provider-secret', 'GH_TOKEN=unused', ''].join('\n'),
    );
    await writeFile(secretPath, 'explicit-provider-secret\n');

    try {
      const values = [
        await resolveProviderCredential(dependencies, {
          options: { credentialFile: path, localCredentials: false },
          provider: 'sprite',
        }),
        await resolveProviderCredential(dependencies, {
          options: { credentialFile: path, localCredentials: false },
          provider: 'sprite',
          selection: { reference: `file:${secretPath}` },
        }),
        await resolveProviderCredential(dependencies, {
          options: { localCredentials: false },
          provider: 'sprite',
        }),
      ];

      expect(values).toEqual([
        {
          token: 'file-provider-secret',
          source: `SPRITES_TOKEN in ${path}`,
        },
        {
          token: 'explicit-provider-secret',
          source: `--provider-token-source file:${secretPath}`,
        },
        {},
      ]);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('should report an unavailable required GitHub token and defer account lookup while mandatory inputs are missing', async () => {
    const options = { nonInteractive: true, localCredentials: false };
    const absent = await resolveInputs(dependencies, {
      options,
      requirementSelection: {
        sources: { processEnv: {}, fileEnv: {} },
        required: ['githubToken'],
      },
    });
    const deferred = await resolveInputs(dependencies, {
      options,
      requirementSelection: {
        sources: {
          processEnv: { GH_TOKEN: 'unvalidated-account-candidate' },
          fileEnv: {},
        },
        required: ['name'],
      },
    });

    expect([
      { token: absent.githubToken, missing: absent.missing },
      { token: deferred.githubToken, missing: deferred.missing },
    ]).toEqual([
      { token: undefined, missing: [expect.stringContaining('GitHub token')] },
      { token: undefined, missing: [expect.stringContaining('--name')] },
    ]);
  });
});
