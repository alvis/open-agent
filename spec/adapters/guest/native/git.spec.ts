import {
  mkdir,
  mkdtempDisposable,
  readFile,
  stat,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { configureGithub } from '#adapters/guest/native/git';
import { ACCOUNT_PATH, accountHome } from '#adapters/guest/platform/layout';
import { HOMEBREW_GH } from '#adapters/guest/tools/accounts';
import { Secret } from '#kernel/secret';

import {
  createFilesystemSprite,
  createNativeCommandExecutor,
  sessionGuestOf,
} from '../../../mocks/sprites';

import type { Sprite } from '@fly/sprites';

const success = { stdout: '', stderr: '', exitCode: 0 };
const protectedGh = HOMEBREW_GH;

function protectedGithubArgs(user: string, args: string[]): string[] {
  return [
    '-n',
    '-E',
    '--',
    '/usr/sbin/runuser',
    '-u',
    user,
    '--',
    '/usr/bin/env',
    `--chdir=${accountHome(user)}`,
    `HOME=${accountHome(user)}`,
    `PATH=${ACCOUNT_PATH}`,
    protectedGh,
    ...args,
  ];
}

describe('fn:configureGithub', () => {
  it('should report a failed login even when the command returns no diagnostic', async () => {
    await using directory = await mkdtempDisposable(
      join(tmpdir(), 'open-agent-github-empty-error-'),
    );
    const sprite = createFilesystemSprite({ root: directory.path });
    Object.assign(sprite, {
      execFileHTTP: vi.fn<Sprite['execFileHTTP']>(async () => ({
        ...success,
        exitCode: 1,
      })),
    } satisfies Partial<Sprite>);

    await expect(
      configureGithub(
        sessionGuestOf(sprite),
        Secret.fromHost('github', 'stdin-token'),
        { shellAccounts: [] },
      ),
    ).rejects.toMatchObject({
      code: 'PROVIDER',
      message: expect.stringMatching(/GitHub.*exit 1\)\.$/),
    });
  });

  it('should route native authentication to the selected hostname and supply credentials only over stdin', async () => {
    await using directory = await mkdtempDisposable(
      join(tmpdir(), 'open-agent-github-'),
    );
    const configDirectory = join(directory.path, '/home/agent/.config');
    await mkdir(configDirectory, { recursive: true, mode: 0o755 });
    await writeFile(join(configDirectory, 'unrelated'), 'preserved');
    const sprite = createFilesystemSprite({
      root: directory.path,
      execute: createNativeCommandExecutor(
        ['github.enterprise.test', 'github.com'].flatMap((host) =>
          ['agent', 'sprite'].flatMap(() => [
            {
              argv: [protectedGh, 'auth', 'setup-git', '--hostname', host],
              result: success,
            },
            {
              argv: [protectedGh, 'auth', 'status', '--hostname', host],
              result: success,
            },
          ]),
        ),
      ),
    });
    const login = vi.fn<Sprite['execFileHTTP']>(async () => success);
    Object.assign(sprite, { execFileHTTP: login });

    await configureGithub(
      sessionGuestOf(sprite),
      Secret.fromHost('github', 'enterprise-token'),
      {
        hostname: 'github.enterprise.test',
        shellAccounts: ['sprite'],
      },
    );
    await configureGithub(
      sessionGuestOf(sprite),
      Secret.fromHost('github', 'default-token'),
      {
        shellAccounts: ['sprite'],
      },
    );

    expect(
      login.mock.calls.map(([file, args, options]) => ({
        file,
        args,
        input: options?.input,
      })),
    ).toEqual(
      [
        { host: 'github.enterprise.test', token: 'enterprise-token' },
        { host: 'github.com', token: 'default-token' },
      ].flatMap(({ host, token }) =>
        ['agent', 'sprite'].map((user) => ({
          file: '/usr/bin/sudo',
          args: protectedGithubArgs(user, [
            'auth',
            'login',
            '--hostname',
            host,
            '--git-protocol',
            'https',
            '--with-token',
          ]),
          input: token,
        })),
      ),
    );
    expect(
      vi
        .mocked(sprite.execFile)
        .mock.calls.filter(([, args]) => args?.includes(protectedGh) === true)
        .map(([file, args]) => ({ file, args })),
    ).toEqual(
      ['github.enterprise.test', 'github.com'].flatMap((host) =>
        ['agent', 'sprite'].flatMap((user) => [
          {
            file: '/usr/bin/sudo',
            args: protectedGithubArgs(user, [
              'auth',
              'setup-git',
              '--hostname',
              host,
            ]),
          },
          {
            file: '/usr/bin/sudo',
            args: protectedGithubArgs(user, [
              'auth',
              'status',
              '--hostname',
              host,
            ]),
          },
        ]),
      ),
    );
    expect((await stat(configDirectory)).mode & 0o777).toBe(0o700);
    expect((await stat(join(configDirectory, 'gh'))).mode & 0o777).toBe(0o700);
    expect(await readFile(join(configDirectory, 'unrelated'), 'utf8')).toBe(
      'preserved',
    );
    const providerDirectory = join(directory.path, '/home/sprite/.config');
    expect((await stat(providerDirectory)).mode & 0o777).toBe(0o700);
    expect((await stat(join(providerDirectory, 'gh'))).mode & 0o777).toBe(
      0o700,
    );
  });

  it('should explain a rejected native login without leaking its stdin credential', async () => {
    await using directory = await mkdtempDisposable(
      join(tmpdir(), 'open-agent-github-error-'),
    );
    const sprite = createFilesystemSprite({ root: directory.path });
    Object.assign(sprite, {
      execFileHTTP: vi.fn<Sprite['execFileHTTP']>(async () => ({
        ...success,
        exitCode: 1,
        stderr:
          'mkdir /home/agent/.config/gh: permission denied\nsecret-github-value',
      })),
    });

    const error = await configureGithub(
      sessionGuestOf(sprite),
      Secret.fromHost('github', 'secret-github-value'),
      { shellAccounts: ['sprite'] },
    ).catch((failure: Error) => failure);
    expect(error).toEqual(
      expect.objectContaining({
        name: 'CommandFault',
        code: 'PROVIDER',
        message: expect.stringMatching(
          /^(?![\s\S]*secret-github-value)[\s\S]*GitHub[\s\S]*agent[\s\S]*auth login[\s\S]*exit 1[\s\S]*permission denied[\s\S]*\[REDACTED\]/,
        ),
      }),
    );
  });

  it('should reject failed status verification even after native login and Git credential setup succeeded', async () => {
    await using directory = await mkdtempDisposable(
      join(tmpdir(), 'open-agent-github-status-'),
    );
    const sprite = createFilesystemSprite({
      root: directory.path,
      execute: createNativeCommandExecutor([
        {
          argv: [protectedGh, 'auth', 'setup-git', '--hostname', 'github.com'],
          result: success,
        },
        {
          argv: [protectedGh, 'auth', 'status', '--hostname', 'github.com'],
          result: { ...success, exitCode: 1, stderr: 'Token is invalid' },
        },
      ]),
    });
    Object.assign(sprite, {
      execFileHTTP: vi.fn<Sprite['execFileHTTP']>(async () => success),
    });

    await expect(
      configureGithub(
        sessionGuestOf(sprite),
        Secret.fromHost('github', 'github-value'),
        {
          shellAccounts: ['sprite'],
        },
      ),
    ).rejects.toEqual(
      expect.objectContaining({
        name: 'CommandFault',
        code: 'PROVIDER',
        message: expect.stringMatching(
          /GitHub[\s\S]*agent[\s\S]*auth status[\s\S]*exit 1[\s\S]*Token is invalid/,
        ),
      }),
    );
  });
});
