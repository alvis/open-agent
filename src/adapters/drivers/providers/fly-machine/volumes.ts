import { isRecord } from '#kernel/guards';

import { malformed } from './wire';

/** a Fly volume, as far as growing it depends on it */
export interface FlyVolume {
  /** volume identity */
  id: string;
  /** provisioned size, in whole GB */
  sizeGb: number;
}

/** a volume after the API extended it */
export interface FlyVolumeExtension {
  /** provisioned size after the extend, in whole GB */
  sizeGb: number;
  /** whether the machine must restart before the added space is usable */
  needsRestart: boolean;
}

/**
 * validates a volume record
 * @param data untrusted response body
 * @returns the volume identity and size
 */
export function parseVolume(data: unknown): FlyVolume {
  if (
    !isRecord(data) ||
    typeof data.id !== 'string' ||
    !Number.isSafeInteger(data.size_gb)
  ) {
    throw malformed('volume');
  }

  return { id: data.id, sizeGb: Number(data.size_gb) };
}

/**
 * validates the outcome of a volume extend, which wraps the volume beside
 * whether the machine needs a restart
 * @param data untrusted response body
 * @returns the extended size and whether a restart is needed
 */
export function parseVolumeExtension(data: unknown): FlyVolumeExtension {
  if (!isRecord(data) || !isRecord(data.volume)) {
    throw malformed('volume extension');
  }

  return {
    sizeGb: parseVolume(data.volume).sizeGb,
    needsRestart: data.needs_restart === true,
  };
}
