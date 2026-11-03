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

import type { Interaction } from '#application/ports/interaction';

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
  it('should resolve independent author and committer identity without local credential discovery', async () => {
    const input = await resolveInputs(dependencies, {
      options: {
        nonInteractive: true,
        localCredentials: false,
        github: false,
        gitName: 'Flag Author',
        gitCommitterEmail: 'flag-committer@example.test',
      },
      requirementSelection: {
        sources: {
          processEnv: {
            GIT_AUTHOR_NAME: 'Process Author',
            GIT_AUTHOR_EMAIL: 'process-author@example.test',
            GIT_COMMITTER_NAME: 'Process Committer',
          },
          fileEnv: {
            GIT_AUTHOR_EMAIL: 'file-author@example.test',
            GIT_COMMITTER_NAME: 'File Committer',
            GIT_COMMITTER_EMAIL: 'file-committer@example.test',
          },
        },
        required: ['gitIdentity'],
      },
    });

    expect({ identity: input.gitIdentity, missing: input.missing }).toEqual({
      identity: {
        authorName: 'Flag Author',
        authorEmail: 'file-author@example.test',
        committerName: 'File Committer',
        committerEmail: 'flag-committer@example.test',
      },
      missing: [],
    });
  });

  it('should keep a known Git identity during a noninteractive run with an interaction attached', async () => {
    const unexpected = (): never => {
      throw new Error('A noninteractive run prompted for input');
    };
    const interaction: Interaction = {
      input: async () => unexpected(),
      secret: async () => unexpected(),
      select: async () => unexpected(),
      multiselect: async () => unexpected(),
      confirm: async () => unexpected(),
      progress: () => undefined,
      status: () => undefined,
    };
    const input = await resolveInputs(dependencies, {
      options: {
        nonInteractive: true,
        localCredentials: false,
        github: false,
        gitName: 'Known Author',
        gitEmail: 'known@example.test',
      },
      interaction,
      requirementSelection: {
        sources: { processEnv: {}, fileEnv: {} },
        required: ['gitIdentity'],
      },
    });

    expect(input.gitIdentity).toMatchObject({
      authorName: 'Known Author',
      authorEmail: 'known@example.test',
    });
    expect(input.missing).toEqual([]);
  });

  it('should include missing Git identity both before and after mandatory input resolution', async () => {
    vi.stubEnv('SPRITES_TOKEN', undefined);
    vi.stubEnv('GIT_AUTHOR_NAME', undefined);
    vi.stubEnv('GIT_AUTHOR_EMAIL', undefined);
    const directory = await mkdtemp(
      join(tmpdir(), 'open-agent-missing-identity-'),
    );
    vi.stubEnv('HOME', directory);
    const options = {
      nonInteractive: true,
      localCredentials: false,
      github: false,
    };

    try {
      const before = await resolveInputs(dependencies, {
        options,
        requirementSelection: {
          sources: { processEnv: {}, fileEnv: {} },
          required: ['providerToken', 'gitIdentity'],
        },
      });
      const after = await resolveInputs(dependencies, {
        options,
        requirementSelection: ['gitIdentity'],
      });
      const known = await resolveInputs(dependencies, {
        options: {
          ...options,
          gitName: 'Known Author',
          gitEmail: 'known@example.test',
        },
        requirementSelection: {
          sources: { processEnv: {}, fileEnv: {} },
          required: ['providerToken', 'gitIdentity'],
        },
      });
      const missingNameAndIdentity = await resolveInputs(dependencies, {
        options,
        requirementSelection: {
          sources: { processEnv: {}, fileEnv: {} },
          required: ['name', 'gitIdentity'],
        },
      });

      // the provider token is a declared provider prerequisite, reported by
      // the aggregated provider preflight rather than as a missing input
      expect([before.missing, after.missing, known.missing]).toEqual([
        [expect.stringContaining('Git author')],
        [expect.stringContaining('Git author')],
        [],
      ]);
      expect(missingNameAndIdentity.missing).toEqual([
        expect.stringContaining('--name'),
        expect.stringContaining('Git author'),
      ]);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

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
        gitIdentity: false,
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
        required: ['name', 'gitIdentity'],
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
