import { compareSemver, isSemver, OPEN_AGENT_VERSION } from '#kernel/version';

import type { WorkstationRecord } from '#domain/workstation';

/**
 * names the release a workstation's metadata records when it is newer than
 * this one, without waking the guest or refusing the workstation
 * @param workstation record of the machine checked
 * @returns the newer recorded release, or nothing when this open-agent may manage it
 */
export function newerMetadataRelease(
  workstation: WorkstationRecord,
): string | undefined {
  const recorded = workstation.metadata.version;

  return recorded && isNewerRelease(recorded) ? recorded : undefined;
}

/**
 * tells whether a recorded release is newer than this one
 * @param recorded release a workstation records
 * @returns true only for a semantic version above this release
 */
function isNewerRelease(recorded: string): boolean {
  return isSemver(recorded) && compareSemver(recorded, OPEN_AGENT_VERSION) > 0;
}
