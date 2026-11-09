import { isRecord } from '#kernel/guards';

import { isRecordedCount, isRecordedInstant, isRecordedText } from './records';

import type { KeepAwakeMode } from '#domain/declarations';

// the governor records its state after every recompute; the host reads it
// back through root's report, so the record is data and its shape is checked
// field by field

/** most holds the record lists */
const RECORDED_HOLD_LIMIT = 32;
/** most diagnostics the record keeps */
const DIAGNOSTIC_LIMIT = 8;
/** a harness or managed operation, as `--source` names it */
const SOURCE_NAME = /^[a-z][a-z0-9-]{0,31}$/;
/** a hashed session identifier, as the governor records it */
const SESSION_HASH = /^[0-9a-f]{64}$/;

const ADAPTER_ACTIONS: readonly unknown[] = [
  'apply-deadline',
  'enter-idle-form',
];

// every value of the axis, keyed so a value added to the axis fails typecheck
// here until the reader accepts it
const KEEP_AWAKE_MODES: Readonly<Record<KeepAwakeMode, true>> = {
  'native-deadline': true,
  'governed': true,
  'none': true,
};

/** a hold the governor recorded as open */
interface RecordedHold {
  /** harness or managed operation that opened it */
  source: string;
  /** SHA-256 of the session identifier, in hexadecimal */
  session: string;
  /** ISO 8601 instant the hold expires unless refreshed */
  expiresAt: string;
}

/** the last call the governor made to the provider's awake adapter */
interface AdapterResult {
  /** ISO 8601 instant of the call */
  at: string;
  /** what the governor asked the adapter to do */
  action: 'apply-deadline' | 'enter-idle-form';
  /** the deadline applied, or the idle form entered; absent after a failure */
  result?: string;
  /** non-secret reason the call failed; absent after a success */
  failure?: string;
}

/** the idle governor's state after its last recompute */
export interface GovernorState {
  /** record format */
  version: 1;
  /** ISO 8601 instant of the recompute */
  updatedAt: string;
  /** the provider's keep-awake mode; absent before the host records a provider */
  keepAwakeMode?: KeepAwakeMode;
  /** minutes without heartbeat or hold before sleep, as applied */
  idleTimeoutMinutes: number;
  /** minutes a hold lasts after its last refresh, as applied */
  holdMaxMinutes: number;
  /** ISO 8601 instant of the latest heartbeat; absent before the first */
  lastHeartbeat?: string;
  /** holds still open, latest expiry first */
  holds: RecordedHold[];
  /** total open holds, including any beyond the listed ones */
  openHolds: number;
  /** ISO 8601 instant the workstation stays awake until; absent when nothing keeps it awake */
  deadline?: string;
  /** whether the governor may initiate sleep */
  sleepPermitted: boolean;
  /** the last awake adapter call, kept across recomputes that make none */
  adapter?: AdapterResult;
  /** non-secret notes from the last recompute */
  diagnostics: string[];
}

/** the governor state as the root report hands it to the host */
export type GovernorReport =
  | {
      /** the record exists and is valid */
      recorded: true;
      /** the validated record */
      state: GovernorState;
    }
  | {
      /** no valid record could be read */
      recorded: false;
      /** non-secret reason */
      reason: string;
    };

/**
 * validates a governor report at a trust boundary
 * @param value untrusted decoded report
 * @returns whether the report is complete and its state valid
 */
export function isGovernorReport(value: unknown): value is GovernorReport {
  return (
    isRecord(value) &&
    ((value.recorded === true && isGovernorState(value.state)) ||
      (value.recorded === false && isRecordedText(value.reason)))
  );
}

/**
 * validates a decoded governor state record field by field
 * @param value untrusted decoded record
 * @returns whether every field has its type and bound
 */
function isGovernorState(value: unknown): value is GovernorState {
  return (
    isRecord(value) &&
    value.version === 1 &&
    isRecordedInstant(value.updatedAt) &&
    (value.keepAwakeMode === undefined ||
      (typeof value.keepAwakeMode === 'string' &&
        Object.hasOwn(KEEP_AWAKE_MODES, value.keepAwakeMode))) &&
    isRecordedCount(value.idleTimeoutMinutes) &&
    isRecordedCount(value.holdMaxMinutes) &&
    (value.lastHeartbeat === undefined ||
      isRecordedInstant(value.lastHeartbeat)) &&
    hasRecordedHolds(value) &&
    (value.deadline === undefined || isRecordedInstant(value.deadline)) &&
    typeof value.sleepPermitted === 'boolean' &&
    (value.adapter === undefined || isAdapterResult(value.adapter)) &&
    Array.isArray(value.diagnostics) &&
    value.diagnostics.length <= DIAGNOSTIC_LIMIT &&
    value.diagnostics.every(isRecordedText)
  );
}

/**
 * validates the recorded holds and their count
 * @param value untrusted decoded record
 * @returns whether the record lists at most the recorded limit of valid holds
 * and counts no fewer open holds than it lists
 */
function hasRecordedHolds(value: Record<string, unknown>): boolean {
  return (
    Array.isArray(value.holds) &&
    value.holds.length <= RECORDED_HOLD_LIMIT &&
    value.holds.every(isRecordedHold) &&
    isRecordedCount(value.openHolds) &&
    value.openHolds >= value.holds.length
  );
}

/**
 * validates one recorded hold
 * @param value untrusted decoded hold
 * @returns whether the hold is complete
 */
function isRecordedHold(value: unknown): value is RecordedHold {
  return (
    isRecord(value) &&
    typeof value.source === 'string' &&
    SOURCE_NAME.test(value.source) &&
    typeof value.session === 'string' &&
    SESSION_HASH.test(value.session) &&
    isRecordedInstant(value.expiresAt)
  );
}

/**
 * validates the recorded adapter call
 * @param value untrusted decoded result
 * @returns whether the result names its action and exactly one outcome
 */
function isAdapterResult(value: unknown): value is AdapterResult {
  return (
    isRecord(value) &&
    isRecordedInstant(value.at) &&
    ADAPTER_ACTIONS.includes(value.action) &&
    (value.result === undefined) !== (value.failure === undefined) &&
    (value.result === undefined || isRecordedText(value.result)) &&
    (value.failure === undefined || isRecordedText(value.failure))
  );
}
