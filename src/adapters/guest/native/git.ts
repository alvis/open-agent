import {
  USER,
  ensurePrivateDirectory,
  runAsAgent,
  writeOwnedFile,
} from '#adapters/guest/platform/account';
import {
  ACCOUNT_PATH,
  AGENT_CONFIG,
  COMMITTER_PATH,
  accountHome,
} from '#adapters/guest/platform/layout';
import { runGuestResult } from '#adapters/guest/platform/run';
import { HOMEBREW_GH } from '#adapters/guest/tools/accounts';
import { CommandFault } from '#kernel/faults';
import { redactResolved } from '#kernel/redaction';

import type { GithubTarget } from '#application/ports/guest';
import type { GuestChannel } from '#application/ports/guest-channel';
import type { GitIdentity } from '#domain/git';
import type { Secret } from '#kernel/secret';

const GITHUB_DIAGNOSTIC_LIMIT = 1200;

/**
 * sets the selected Git and Jujutsu identity for the non-root runtime account
 * @param guest target guest
 * @param identity selected author and committer identity
 */
export async function configureGit(
  guest: GuestChannel,
  identity: GitIdentity,
): Promise<void> {
  const settings = [
    ['user.name', identity.authorName],
    ['user.email', identity.authorEmail],
    ['user.useConfigOnly', 'true'],
  ];
  for (const [key, value] of settings) {
    await runAsAgent(guest, ['git', 'config', '--global', key!, value!]);
  }
  await runAsAgent(guest, [
    'jj',
    'config',
    'set',
    '--user',
    'user.name',
    identity.authorName,
  ]);
  await runAsAgent(guest, [
    'jj',
    'config',
    'set',
    '--user',
    'user.email',
    identity.authorEmail,
  ]);
  await ensurePrivateDirectory(guest, AGENT_CONFIG);
  await writeOwnedFile(
    guest,
    COMMITTER_PATH,
    `${JSON.stringify({ name: identity.committerName, email: identity.committerEmail })}\n`,
  );
}

/**
 * authenticates GitHub CLI using a selected credential over stdin
 * configures separate protected stores for the agent and each provider shell account
 * @param guest target guest, running over a setup session
 * @param token GitHub credential, piped to the native CLI as session input
 * @param target selected GitHub host and provider shell accounts
 */
export async function configureGithub(
  guest: GuestChannel,
  token: Secret,
  target: GithubTarget,
): Promise<void> {
  const hostname = target.hostname ?? 'github.com';
  for (const user of [USER, ...target.shellAccounts]) {
    const home = accountHome(user);
    const owner = { user, shellAccounts: target.shellAccounts };
    await ensurePrivateDirectory(guest, `${home}/.config`, owner);
    await ensurePrivateDirectory(guest, `${home}/.config/gh`, owner);
    await runGithubCommand({
      guest,
      user,
      args: [
        'auth',
        'login',
        '--hostname',
        hostname,
        '--git-protocol',
        'https',
        '--with-token',
      ],
      token,
    });
    await runGithubCommand({
      guest,
      user,
      args: ['auth', 'setup-git', '--hostname', hostname],
    });
    await runGithubCommand({
      guest,
      user,
      args: ['auth', 'status', '--hostname', hostname],
    });
  }
}

/**
 * runs native GitHub authentication with bounded, redacted failure details
 * @param params guest account, native arguments and optional stdin credential
 * @param params.guest target guest channel
 * @param params.user non-root account receiving native GitHub configuration
 * @param params.args native GitHub arguments without credentials
 * @param params.token optional credential delivered only as session input on stdin
 * @throws {Error} when native authentication, Git setup or status verification fails
 */
async function runGithubCommand(params: {
  guest: GuestChannel;
  user: string;
  args: string[];
  token?: Secret;
}): Promise<void> {
  const { guest, user, args, token } = params;
  const home = accountHome(user);
  const result = await runGuestResult(
    guest,
    [
      '/usr/sbin/runuser',
      '-u',
      user,
      '--',
      '/usr/bin/env',
      `--chdir=${home}`,
      `HOME=${home}`,
      `PATH=${ACCOUNT_PATH}`,
      // the bottle's keg, which only the Homebrew account can change
      HOMEBREW_GH,
      ...args,
    ],
    token ? { secret: { value: token, as: 'stdin' } } : {},
  );
  if (result.exitCode !== 0) {
    const detail = redactResolved(result.stderr)
      .replace(/\p{Cc}/gu, ' ')
      .trim()
      .slice(0, GITHUB_DIAGNOSTIC_LIMIT);
    const explanation = detail ? ': ' + detail : '.';
    throw new CommandFault({
      code: 'PROVIDER',
      message: `GitHub (${user}) ${args.join(' ')} failed (exit ${result.exitCode})${explanation}`,
    });
  }
}
