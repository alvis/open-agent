import {
  ensurePrivateDirectory,
  writeOwnedFile,
} from '#adapters/guest/platform/account';
import { readJsonObject } from '#adapters/guest/platform/native/configuration';
import { isRecord } from '#kernel/guards';

import { CLAUDE_CONFIG_DIR, CLAUDE_SETTINGS } from './paths';

import type { GuestChannel } from '#application/ports/guest-channel';

/**
 * applies the base environment to Claude user settings
 * @param guest target guest
 */
export async function configureClaude(guest: GuestChannel): Promise<void> {
  await ensurePrivateDirectory(guest, CLAUDE_CONFIG_DIR);
  const current = await readJsonObject(guest, CLAUDE_SETTINGS);
  const previousEnv = isRecord(current.env) ? current.env : {};
  const next = {
    ...current,
    env: {
      ...previousEnv,
      DISABLE_AUTOUPDATER: '1',
    },
  };
  await writeOwnedFile(
    guest,
    CLAUDE_SETTINGS,
    `${JSON.stringify(next, null, 2)}\n`,
  );
}
