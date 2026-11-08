import { ProviderFault } from '#kernel/provider-fault';

import type { StorageExtension } from '#application/ports/drivers';

import type { FlyApi } from './api';
import type { FlyMachine } from './wire';

/** one machine's volume and the size it grows to */
interface GrowVolumeParams {
  /** authenticated Machines API client */
  api: FlyApi;
  /** app name, which is the workstation name */
  app: string;
  /** the machine as observed, whose mount names the volume */
  machine: FlyMachine;
  /** size to grow the volume to, in whole GB */
  sizeGb: number;
}

/**
 * grows the volume the machine mounts to a size, never shrinking it: a size
 * at or below the current one makes no extend call. The volume is the one
 * the machine's mount names, so the call cannot reach another volume of the
 * app that carries the same name
 * @param params client, app, observed machine and size
 * @returns the size now provisioned and whether the space needs a restart to be usable
 * @throws {ProviderFault} when the machine mounts no volume, or Fly refuses the size
 */
export async function growVolume(
  params: GrowVolumeParams,
): Promise<StorageExtension> {
  const { api, app, machine, sizeGb } = params;
  const { volume } = machine;
  if (volume === undefined) {
    throw new ProviderFault({
      code: 'failed',
      message: `Fly machine ${machine.id} of ${app} mounts no volume to grow`,
    });
  }
  const current = await api.getVolume(app, volume);
  if (sizeGb <= current.sizeGb) {
    return { sizeGb: current.sizeGb, needsRestart: false };
  }

  return api.extendVolume(app, volume, sizeGb).catch((error: unknown) => {
    throw error instanceof ProviderFault
      ? new ProviderFault({
          code: error.code,
          message: `Fly could not grow volume ${volume} of ${app} to ${String(sizeGb)} GB: ${error.message}`,
          cause: error,
        })
      : error;
  });
}
