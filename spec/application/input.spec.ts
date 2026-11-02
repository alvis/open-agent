import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { commandError } from '#application/failures';
import {
  requireValidProfile,
  requireValidSuppliedSelection,
  resolveCreateInputs,
} from '#application/input';
import { resolveProviderCredential } from '#application/input/provider-credential';

import { DISABLED_NETWORK_PROFILE } from '../fixtures/profile';
import { dependencies } from '../mocks/dependencies';

describe('fn:requireValidProfile', () => {
  it('should return a valid resolved profile', () => {
    expect(
      requireValidProfile(
        dependencies,
        { candidate: DISABLED_NETWORK_PROFILE },
        {},
      ),
    ).toEqual(DISABLED_NETWORK_PROFILE);
  });

  it('should report capability violations', () => {
    let failure: unknown;
    try {
      requireValidProfile(
        dependencies,
        { candidate: { ...DISABLED_NETWORK_PROFILE, harnesses: [] } },
        {},
      );
    } catch (error) {
      failure = error;
    }

    expect(commandError(failure)).toMatchObject({
      code: 'INPUT',
      details: [expect.stringContaining('harness')],
    });
  });
});

describe('fn:requireValidSuppliedSelection', () => {
  it('should accept a compatible supplied selection', () => {
    expect(() =>
      requireValidSuppliedSelection(dependencies, { provider: 'sprite' }, {}),
    ).not.toThrow();
  });

  it('should report an unknown driver before workstation lookup', () => {
    let failure: unknown;
    try {
      requireValidSuppliedSelection(
        dependencies,
        { agent: 'unregistered-agent' },
        {},
      );
    } catch (error) {
      failure = error;
    }

    expect(commandError(failure)).toMatchObject({
      code: 'INPUT',
      details: [expect.stringContaining('unregistered-agent')],
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
      ['SPRITES_TOKEN=file-provider-secret', ''].join('\n'),
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
});
