import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import {
  readEnvironmentSources,
  resolveSecret,
} from '#application/input/sources';
import { redactResolved } from '#kernel/redaction';

import { dependencies } from '../../mocks/dependencies';

describe('fn:readEnvironmentSources', () => {
  it('should parse the selected dotenv file', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'open-agent-input-'));
    vi.stubEnv('SPRITES_TOKEN', 'process-secret-for-source-test');
    const envPath = join(directory, 'chosen.env');
    await writeFile(
      envPath,
      'export SPRITES_TOKEN="file secret"\nRUNTIME_VALUE="value # retained" # comment\nMULTILINE="first\\nsecond"\n',
    );

    try {
      const sources = await readEnvironmentSources(dependencies, {
        credentialFile: envPath,
      });

      expect({
        fileEnv: sources.fileEnv,
        token: sources.processEnv.SPRITES_TOKEN,
      }).toEqual({
        fileEnv: {
          SPRITES_TOKEN: 'file secret',
          RUNTIME_VALUE: 'value # retained',
          MULTILINE: 'first\nsecond',
        },
        token: 'process-secret-for-source-test',
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});

describe('fn:resolveSecret', () => {
  it('should use explicit environment and file references ahead of fallback values', async () => {
    vi.stubEnv('OPEN_AGENT_TEST_SECRET', 'environment-selected-secret');
    const directory = await mkdtemp(join(tmpdir(), 'open-agent-secret-'));
    const path = join(directory, 'secret');
    await writeFile(path, ' file-selected-secret\n\n');

    try {
      const values = [
        await resolveSecret(dependencies, undefined, 'fallback-secret'),
        await resolveSecret(dependencies, undefined, ''),
        await resolveSecret(
          dependencies,
          'env:OPEN_AGENT_TEST_SECRET',
          'fallback-secret',
        ),
        await resolveSecret(dependencies, `file:${path}`, 'fallback-secret'),
      ];

      expect(values).toEqual([
        'fallback-secret',
        undefined,
        'environment-selected-secret',
        ' file-selected-secret',
      ]);
      expect(
        redactResolved(
          'fallback-secret environment-selected-secret  file-selected-secret',
        ),
      ).toBe('[REDACTED] [REDACTED] [REDACTED]');
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('should reject empty or malformed explicit references instead of falling back', async () => {
    vi.stubEnv('OPEN_AGENT_EMPTY_SECRET', '');
    const directory = await mkdtemp(join(tmpdir(), 'open-agent-empty-secret-'));
    const path = join(directory, 'secret');
    await writeFile(path, '\n');

    try {
      await expect(
        resolveSecret(
          dependencies,
          'env:OPEN_AGENT_EMPTY_SECRET',
          'fallback-secret',
        ),
      ).rejects.toEqual(expect.objectContaining({ code: 'INPUT' }));
      await expect(
        resolveSecret(dependencies, `file:${path}`, 'fallback-secret'),
      ).rejects.toEqual(expect.objectContaining({ code: 'INPUT' }));
      await expect(
        resolveSecret(dependencies, 'keychain:', 'fallback-secret'),
      ).rejects.toEqual(expect.objectContaining({ code: 'INPUT' }));
      await expect(
        resolveSecret(dependencies, 'keychain:service', 'fallback-secret'),
      ).rejects.toEqual(expect.objectContaining({ code: 'INPUT' }));
      await expect(
        resolveSecret(
          dependencies,
          'literal-secret-is-not-a-reference',
          'fallback-secret',
        ),
      ).rejects.toEqual(expect.objectContaining({ code: 'INPUT' }));
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});

describe('input source failures', () => {
  it('should select and redact a keychain secret through the host boundary', async () => {
    const run = vi.fn<typeof dependencies.host.run>(
      async () => 'keychain-secret',
    );
    const host = {
      ...dependencies.host,
      run,
    } satisfies typeof dependencies.host;

    await expect(
      resolveSecret({ host }, 'keychain:service/account', 'fallback'),
    ).resolves.toBe('keychain-secret');
    expect(run.mock.calls).toEqual([
      [
        {
          program: 'security',
          arguments: [
            'find-generic-password',
            '-s',
            'service',
            '-a',
            'account',
            '-w',
          ],
        },
      ],
    ]);
    expect(redactResolved('keychain-secret')).toBe('[REDACTED]');
  });

  it('should classify an unreadable keychain secret as an input fault', async () => {
    const host = {
      ...dependencies.host,
      run: vi.fn<typeof dependencies.host.run>(async () => {
        throw new Error('keychain unavailable');
      }),
    } satisfies typeof dependencies.host;

    await expect(
      resolveSecret({ host }, 'keychain:service/account', 'fallback'),
    ).rejects.toMatchObject({
      code: 'INPUT',
      message: expect.stringContaining('keychain'),
    });
  });
});
