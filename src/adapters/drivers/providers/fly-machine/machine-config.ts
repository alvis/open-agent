import { effectiveStoragePolicy } from '#domain/storage';

import {
  BOOT_INIT,
  BOOT_STOP_SECONDS,
  BOOT_STUB_MODE,
  BOOT_STUB_PATH,
  VOLUME_PATH,
} from './boot';
import { FLY_MACHINE_CAPABILITIES } from './capabilities';
import { guestOf } from './machines';
import { wireGuest } from './wire';

import type { OsImage } from '#domain/guest';
import type { ProfileOptions } from '#domain/profile';
import type { StoragePolicy } from '#domain/storage';

import type { FlyMachineOffer } from './machines';
import type { FlyGuest, FlyServiceRoute } from './wire';

/** a file the machine writes to its root filesystem on every boot */
interface MachineFile {
  /** absolute path on the root filesystem */
  guestPath: string;
  /** the file's text */
  contents: string;
  /** permission bits */
  mode: number;
}

/** how Fly grows the volume on its own once its usage passes a threshold */
type VolumeAutoExtend = Pick<
  Extract<StoragePolicy, { state: 'on' }>,
  'thresholdPercent' | 'stepGb' | 'limitGb'
>;

/** the machine this driver creates, before it is rendered for the API */
export interface MachineSpec {
  /** stock image the machine boots */
  image: string;
  /** CPUs and memory the machine runs on */
  guest: FlyGuest;
  /** program and arguments the machine runs as its init */
  init: readonly string[];
  /** files written to the root filesystem before the init runs */
  files: readonly MachineFile[];
  /** seconds a stop gives the init before Fly kills the machine */
  stopSeconds: number;
  /** whether the root filesystem outlives a stop: `always` keeps what setup installed there across restarts */
  rootfs: 'always';
  /** volume mounted as persistent storage */
  volume: string;
  /** where the volume is mounted */
  mountPath: string;
  /** growth the mount asks Fly to apply to the volume; absent when automatic growth is off */
  autoExtend?: VolumeAutoExtend;
  /** ACP agent port the declared service routes public traffic to */
  port: number;
  /** ownership, schema and profile summary */
  metadata: Readonly<Record<string, string>>;
}

/** what a new machine needs beyond the fixed shape */
interface MachineSpecParams {
  /** preset the machine runs on */
  machine: FlyMachineOffer;
  /** volume mounted as persistent storage */
  volume: string;
  /** the boot stub's text, which the machine writes to its root filesystem */
  bootStub: string;
  /** profile options whose growth policy the mount declares */
  options: ProfileOptions;
  /** ACP agent port a later exposure publishes */
  port: number;
  /** initial machine metadata */
  metadata: Readonly<Record<string, string>>;
}

/** stock Debian; the boot hook restores everything else from the volume */
const MACHINE_IMAGE = 'debian:bookworm-slim';
/** the OS images a workstation machine is created from */
export const FLY_MACHINE_IMAGES: readonly [OsImage, ...OsImage[]] = [
  {
    id: 'debian-12',
    ref: MACHINE_IMAGE,
    family: 'debian',
    release: { id: 'debian', versionId: '12' },
    // Fly Machines run on x86_64 hosts
    arch: ['x86_64'],
  },
];
const HTTPS_PORT = 443;
const HTTP_PORT = 80;
/** volume name; Fly volume names allow only letters, digits and underscores */
export const VOLUME_NAME = 'open_agent';

/**
 * describes a workstation machine, whose init is the boot stub its
 * configuration writes to the root filesystem, which keeps across restarts;
 * the stub runs the boot hook setup keeps on the volume. Its service is
 * declared now because changing it later restarts the machine, and it stays
 * unreachable until exposure assigns the app public addresses. When the
 * profile's growth policy is on, the mount asks Fly to grow the volume itself
 * @param params preset, volume, boot stub, profile options, ACP agent port and initial metadata
 * @returns the machine description
 */
export function machineSpec(params: MachineSpecParams): MachineSpec {
  const policy = effectiveStoragePolicy(
    FLY_MACHINE_CAPABILITIES.storage,
    params.options,
  );

  return {
    image: MACHINE_IMAGE,
    // a machine above 2 GB of memory cannot be suspended, only stopped
    guest: guestOf(params.machine),
    init: BOOT_INIT,
    files: [
      {
        guestPath: BOOT_STUB_PATH,
        contents: params.bootStub,
        mode: BOOT_STUB_MODE,
      },
    ],
    stopSeconds: BOOT_STOP_SECONDS,
    rootfs: 'always',
    volume: params.volume,
    mountPath: VOLUME_PATH,
    ...(policy.state === 'on'
      ? {
          autoExtend: {
            thresholdPercent: policy.thresholdPercent,
            stepGb: policy.stepGb,
            limitGb: policy.limitGb,
          },
        }
      : {}),
    port: params.port,
    metadata: params.metadata,
  };
}

/**
 * renders a machine description as the Machines API configuration: HTTPS on
 * 443, and HTTP on 80 redirected to HTTPS, route to the ACP agent port with
 * proxy auto-start on and auto-stop off
 * @param spec machine description
 * @returns the API configuration
 */
export function wireMachineConfig(spec: MachineSpec): Record<string, unknown> {
  return {
    image: spec.image,
    guest: wireGuest(spec.guest),
    init: { exec: [...spec.init] },
    files: spec.files.map((file) => ({
      guest_path: file.guestPath,
      raw_value: Buffer.from(file.contents).toString('base64'),
      mode: file.mode,
    })),
    stop_config: { timeout: `${spec.stopSeconds}s` },
    rootfs: { persist: spec.rootfs },
    mounts: [wireMount(spec)],
    restart: { policy: 'on-failure' },
    services: [
      {
        protocol: 'tcp',
        internal_port: spec.port,
        autostart: true,
        autostop: 'off',
        ports: [
          { port: HTTPS_PORT, handlers: ['tls', 'http'] },
          { port: HTTP_PORT, handlers: ['http'], force_https: true },
        ],
      },
    ],
    metadata: { ...spec.metadata },
  };
}

/**
 * tells whether a machine declares the service that publishes a port
 * @param routes services the machine declares
 * @param port ACP agent port
 * @returns true when the port is routed with proxy auto-start and no auto-stop
 */
export function declaresAgentService(
  routes: readonly FlyServiceRoute[],
  port: number,
): boolean {
  return routes.some(
    (route) =>
      route.internalPort === port &&
      route.autostart &&
      route.autostop === 'off',
  );
}

/**
 * renders the volume mount as the Machines API configuration, with the
 * growth Fly applies to the volume only when the spec asks for it
 * @param spec machine description
 * @returns the API mount
 */
function wireMount(spec: MachineSpec): Record<string, unknown> {
  const { autoExtend } = spec;

  return {
    volume: spec.volume,
    path: spec.mountPath,
    ...(autoExtend
      ? {
          extend_threshold_percent: autoExtend.thresholdPercent,
          add_size_gb: autoExtend.stepGb,
          size_gb_limit: autoExtend.limitGb,
        }
      : {}),
  };
}
