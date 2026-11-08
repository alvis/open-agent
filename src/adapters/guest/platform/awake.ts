import { guestAsset } from '#adapters/guest/platform/assets';
import { ROOT_ONLY_MODE, SHARED_MODE } from '#domain/guest';

/**
 * the storage watcher, root's library the governor's per-minute tick sources:
 * it grows the workstation's storage through the provider's storage adapter
 * when the recorded growth policy lets the guest extend it
 */
export const STORAGE_WATCHER_ASSET = guestAsset(
  'governor/storage.sh',
  ROOT_ONLY_MODE,
);

/**
 * the idle governor and awake command, root's file every account runs:
 * harness hooks record awake events with it as the agent, root records
 * managed holds and runs the per-minute tick, which sources the storage
 * watcher its header names
 */
export const AWAKE_ASSET = guestAsset('governor/awake.sh', SHARED_MODE, {
  OA_STORAGE_WATCHER: STORAGE_WATCHER_ASSET.installAs,
});

/** the awake command harness hooks and managed holds run */
export const AWAKE_COMMAND = AWAKE_ASSET.installAs;

/** an awake event the command records */
export type AwakeAction = 'heartbeat' | 'hold-open' | 'hold-close';

/** longest budget, in milliseconds, an awake event may be given */
export const AWAKE_DEADLINE_MS = 8_000;
