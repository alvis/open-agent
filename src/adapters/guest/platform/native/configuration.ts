import { guestFileExists, readGuestFile } from '#adapters/guest/platform/files';
import { CommandFault } from '#kernel/faults';
import { isRecord } from '#kernel/guards';

import type { GuestChannel } from '#application/ports/guest-channel';

/**
 * reads an optional native JSON object without overwriting unrelated fields
 * @param guest target guest
 * @param path native configuration file
 * @returns parsed object, or an empty object for an absent file
 */
export async function readJsonObject(
  guest: GuestChannel,
  path: string,
): Promise<Record<string, unknown>> {
  if (!(await guestFileExists(guest, path))) {
    return {};
  }
  const text = await readGuestFile(guest, path);
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (cause) {
    throw new CommandFault({
      code: 'INPUT',
      message: `Native JSON configuration at ${path} is malformed`,
      cause,
      causeVisibility: 'private',
    });
  }
  if (!isRecord(parsed)) {
    throw new CommandFault({
      code: 'INPUT',
      message: `Native JSON configuration at ${path} is not an object`,
    });
  }

  return parsed;
}
