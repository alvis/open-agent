import { hasWorkHooks } from '#adapters/drivers/harnesses/shared/hooks';
import { awakeHooksReadiness } from '#adapters/drivers/harnesses/shared/readiness';
import { HOME } from '#adapters/guest/platform/account';
import { AWAKE_COMMAND } from '#adapters/guest/platform/awake';
import { readJsonObject } from '#adapters/guest/platform/native/configuration';
import { runBoundedIO } from '#kernel/operation';

import { CLAUDE_WORK_HOOKS } from './hooks';
import { inspectClaudeInitialization } from './initialization';
import { CLAUDE_SETTINGS } from './paths';

import type { GuestChannel } from '#application/ports/guest-channel';
import type {
  HarnessInspection,
  NativeHarnessInspection,
} from '#domain/observations/harness';
import type { ReadinessFinding } from '#domain/readiness';

import type { ClaudeInitialization } from './initialization';

/**
 * reads Claude settings and SDK initialization without a model turn
 * @param guest target guest
 * @returns configuration flags and initialization evidence
 */
export async function inspectClaude(
  guest: GuestChannel,
): Promise<HarnessInspection<ClaudeInitialization | undefined>> {
  const [settings, initialization, authenticated] = await Promise.all([
    readJsonObject(guest, CLAUDE_SETTINGS),
    inspectClaudeInitialization(guest),
    runBoundedIO(async () => guest.exists(`${HOME}/.claude/.credentials.json`)),
  ] as const);

  return {
    configuration: claudeConfiguration({ settings, authenticated }),
    evidence: initialization,
  };
}

/**
 * evaluates non-secret hook and authentication state
 * @param evidence settings and native authentication presence
 * @param evidence.settings parsed Claude user settings
 * @param evidence.authenticated whether native credentials exist
 * @returns Claude's configuration flags
 */
function claudeConfiguration(evidence: {
  settings: Record<string, unknown>;
  authenticated: boolean;
}): NativeHarnessInspection {
  const { settings, authenticated } = evidence;
  const authentication: NativeHarnessInspection['authentication'] =
    authenticated ? 'native' : 'not-configured';

  return {
    awakeHooksInstalled: hasWorkHooks(settings.hooks, {
      owned: CLAUDE_WORK_HOOKS,
      command: { program: AWAKE_COMMAND },
    }),
    authentication,
  };
}

/**
 * derives Claude's readiness from gathered native evidence
 * @param inspection native configuration evidence, absent when inspection failed
 * @returns the awake-hook finding
 */
export function claudeReadiness(
  inspection: NativeHarnessInspection | undefined,
): ReadinessFinding[] {
  return [awakeHooksReadiness('Claude', inspection)];
}
