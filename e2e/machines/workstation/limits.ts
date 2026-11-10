import type { MachineType } from '../providers';

/**
 * maximum time allowed for workstation creation, by machine type: a Fly
 * Machine installs the whole tool set from bottles and packages
 */
export const CREATE_TIMEOUT_MS: Readonly<Record<MachineType, number>> = {
  'sprite': 1_200_000,
  'fly-machine': 3_600_000,
};

/**
 * the machine size every workstation is created with, by machine type: Fly's
 * default shared-cpu-2x has a CPU quota of an eighth of a core once its burst
 * is spent, which held a create's tool installs past an hour, so a Fly
 * Machine runs on shared-cpu-8x, whose quota is four times that
 */
export const MACHINE_SIZE_FLAGS: Readonly<
  Record<MachineType, readonly string[]>
> = {
  'sprite': [],
  'fly-machine': ['--cpu', '8', '--mem', '4'],
};

/** maximum time allowed for workstation commands */
export const COMMAND_TIMEOUT_MS = 480_000;

/** maximum time allowed for read-only CLI commands */
export const READ_TIMEOUT_MS = 120_000;

/** maximum time allowed for network device authorization */
export const DEVICE_TIMEOUT_MS = 60_000;

/** interval between network device authorization checks */
export const DEVICE_POLL_MS = 5_000;
