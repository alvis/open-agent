import { GUEST_ROOT } from '#adapters/guest/platform/layout';
import { runGuestResult } from '#adapters/guest/platform/run';
import { parseStorageProbe } from '#domain/observations/storage';

import type { GuestChannel } from '#application/ports/guest-channel';
import type {
  RecordedStoragePolicy,
  StorageReport,
} from '#domain/observations/storage';

/** the storage watcher's state, root's alone, in the governor's run directory */
const STORAGE_STATE_PATH = `${GUEST_ROOT}/run/storage.json`;
/** seconds df may take, as the watcher allows it */
const MEASURE_LIMIT_SECONDS = 10;
/** longest the whole guest command may take */
const PROBE_TIMEOUT_MS = 30_000;
/** most bytes of the watcher's state read, one beyond what the watcher writes so an oversized state is refused */
const STATE_READ_BYTES = 4097;
/** the line that separates the measure from the watcher's state */
const STATE_MARKER = '--- storage.json';
/**
 * measures the filesystem at the storage path and prints the watcher's state
 * after a marker when it is a regular file, never one a link names; it runs as
 * root, which alone reads the state
 */
const STORAGE_PROBE = [
  `measure=$(timeout ${String(MEASURE_LIMIT_SECONDS)} df -P -k -- "$1") || exit 1`,
  `printf '%s\\n' "$measure"`,
  'if test -f "$2" && ! test -L "$2"; then',
  `  printf '%s\\n' '${STATE_MARKER}'`,
  `  head -c ${String(STATE_READ_BYTES)} -- "$2"`,
  'fi',
].join('\n');

/** what the storage probe measures and reports */
export interface StorageInspectionParams {
  /** guest path whose filesystem holds the persistent data */
  path: string;
  /** the growth policy the workstation recorded */
  policy: RecordedStoragePolicy;
}

/**
 * measures the workstation's storage and reads the watcher's last attempt
 * in one root command on the guest
 * @param guest target guest
 * @param params the storage path and the recorded policy
 * @returns the storage report
 * @throws {Error} when the filesystem cannot be measured or what the guest printed is malformed
 */
export async function inspectStorage(
  guest: GuestChannel,
  params: StorageInspectionParams,
): Promise<StorageReport> {
  const { exitCode, stdout } = await runGuestResult(
    guest,
    [
      '/bin/sh',
      '-c',
      STORAGE_PROBE,
      'oa-storage',
      params.path,
      STORAGE_STATE_PATH,
    ],
    { timeoutMs: PROBE_TIMEOUT_MS },
  );
  if (exitCode !== 0) {
    throw new Error(`The storage at ${params.path} could not be measured`);
  }
  const marker = `\n${STATE_MARKER}\n`;
  const split = stdout.indexOf(marker);

  return parseStorageProbe({
    measure: split === -1 ? stdout : stdout.slice(0, split),
    ...(split === -1 ? {} : { state: stdout.slice(split + marker.length) }),
    policy: params.policy,
  });
}
