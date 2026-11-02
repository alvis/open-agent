import { HOME } from '#adapters/guest/platform/account';
import { runBoundedIO } from '#kernel/operation';

import { inspectClaudeInitialization } from './initialization';

import type { GuestChannel } from '#application/ports/guest-channel';
import type {
  HarnessInspection,
  NativeHarnessInspection,
} from '#domain/observations/harness';

import type { ClaudeInitialization } from './initialization';

/**
 * reads Claude's authentication and SDK initialization without a model turn
 * @param guest target guest
 * @returns configuration flags and initialization evidence
 */
export async function inspectClaude(
  guest: GuestChannel,
): Promise<HarnessInspection<ClaudeInitialization | undefined>> {
  const [initialization, authenticated] = await Promise.all([
    inspectClaudeInitialization(guest),
    runBoundedIO(async () => guest.exists(`${HOME}/.claude/.credentials.json`)),
  ] as const);

  return {
    configuration: claudeConfiguration({ authenticated }),
    evidence: initialization,
  };
}

/**
 * evaluates non-secret authentication state
 * @param evidence native authentication presence
 * @param evidence.authenticated whether native credentials exist
 * @returns Claude's configuration flags
 */
function claudeConfiguration(evidence: {
  authenticated: boolean;
}): NativeHarnessInspection {
  const { authenticated } = evidence;
  const authentication: NativeHarnessInspection['authentication'] =
    authenticated ? 'native' : 'not-configured';

  return {
    authentication,
  };
}
