import { isRecord } from '#kernel/guards';

import { isRecordedCount, isRecordedInstant, isRecordedText } from './records';

import type { StoragePolicy } from '#domain/storage';

// the storage probe measures the filesystem at the storage path with
// `df -P -k` and reads the storage watcher's state, which root writes; both
// reach the host as text, so each is parsed and checked here

/** a growth policy as inspection reports it: the one recorded at creation, or not-recorded for a workstation created before it was recorded */
export type RecordedStoragePolicy = StoragePolicy | { state: 'not-recorded' };

/** a storage growth attempt the provider carried out */
export interface GrownStorageAttempt {
  /** ISO 8601 instant of the attempt */
  at: string;
  /** size, in whole GB, the attempt asked for */
  targetGb: number;
  outcome: 'grown';
  /** non-secret account of the outcome */
  detail?: string;
}

/**
 * a storage growth attempt that failed; it has no target when the watcher
 * could not learn the storage's size to grow from
 */
export interface FailedStorageAttempt {
  /** ISO 8601 instant of the attempt */
  at: string;
  /** size, in whole GB, the attempt asked for; absent when the size query failed */
  targetGb?: number;
  outcome: 'failed';
  /** non-secret account of the outcome */
  detail?: string;
}

/**
 * the storage watcher's last attempt to grow the storage. Unlike the
 * specification's single shape, a failed attempt may have no target, as the
 * watcher records none when it could not learn the storage's size
 */
export type StorageGrowthAttempt = GrownStorageAttempt | FailedStorageAttempt;

/** a workstation's storage as inspection measured it, and how it grows */
export interface StorageReport {
  /** filesystem size at the storage path, in GB */
  sizeGb: number;
  /** used space, in GB */
  usedGb: number;
  /** used share, 0 to 100 */
  usedPercent: number;
  /** the recorded policy, or not-recorded */
  policy: RecordedStoragePolicy;
  /**
   * size, in whole GB, the provider last reported provisioned to the storage
   * watcher; absent when the watcher never learned it. An addition to the
   * specification's shape, as the filesystem shows less than is provisioned
   */
  provisionedGb?: number;
  /** the watcher's last attempt; absent when it never ran */
  lastGrowth?: StorageGrowthAttempt;
}

/** what the storage probe gathered on the guest */
export interface StorageProbeOutput {
  /** what `df -P -k` printed for the storage path */
  measure: string;
  /** the storage watcher's recorded state; absent when the watcher never ran */
  state?: string;
  /** the growth policy the workstation recorded */
  policy: RecordedStoragePolicy;
}

/** KB in a GB, which is 1024^3 bytes, as the storage watcher counts it */
const KB_PER_GB = 1_048_576;

/** tenths in a unit, to report sizes to one decimal place */
const TENTHS = 10;

/** usage, in percent, at which storage counts as nearly full whatever its policy */
const FULL_PERCENT = 95;

/**
 * share of the growth limit at which the filesystem counts as having reached
 * it when the provider's provisioned size is unknown: df leaves out the ext4
 * metadata overhead, about 2 to 3% of the volume, so a volume grown to the
 * limit measures that much below it, and one a step short measures less
 */
const LIMIT_ALLOWANCE = 0.97;

/** most bytes the storage watcher's state holds */
const STATE_BYTES = 4096;

/** whole percent in all of a filesystem */
const PERCENT = 100;

/** a size, used or available field of `df -P -k`, in KB */
const KB_FIELD = /^\d{1,15}$/u;

/** the capacity field of `df -P -k`, a dash when df cannot compute it */
const CAPACITY_FIELD = /^(?:\d{1,3}%|-)$/u;

/** the KB fields before the capacity in a data line of `df -P -k` */
const KB_FIELD_COUNT = 3;

/** the fields the watcher's state may hold, and those of its last attempt */
const STATE_FIELDS: ReadonlySet<string> = new Set([
  'version',
  'lastSizeGb',
  'sizeChangedAt',
  'lastAttempt',
]);
const ATTEMPT_FIELDS: ReadonlySet<string> = new Set([
  'at',
  'targetGb',
  'outcome',
  'detail',
  'sizeGb',
]);
const ATTEMPT_OUTCOMES: readonly unknown[] = ['grown', 'failed'];

/** the storage watcher's state, `storage.json` in the governor's run directory */
interface StorageWatcherState {
  /** record format */
  version: 1;
  /** size, in whole GB, the provider last reported provisioned; absent before the watcher learned it */
  lastSizeGb?: number;
  /** ISO 8601 instant that size was first reported */
  sizeChangedAt?: string;
  /** the last attempt; absent before the first */
  lastAttempt?: StorageGrowthAttempt & {
    /** size, in whole GB, the provider reported after a grown attempt */
    sizeGb?: number;
  };
}

/**
 * turns what the storage probe gathered into a storage report
 * @param output the filesystem measure, the watcher's state and the recorded policy
 * @returns the size and usage to one decimal place, the policy and the watcher's last attempt
 * @throws {Error} when the measure or the watcher's state is malformed
 */
export function parseStorageProbe(output: StorageProbeOutput): StorageReport {
  const { policy } = output;
  const [sizeKb, usedKb, availableKb] = parseMeasure(output.measure);
  const { lastSizeGb, lastAttempt } =
    output.state === undefined ? {} : parseWatcherState(output.state);

  return {
    sizeGb: gigabytes(sizeKb),
    usedGb: gigabytes(usedKb),
    // as df and the watcher round it, so the threshold reads the same
    usedPercent:
      usedKb + availableKb > 0
        ? Math.ceil((usedKb * PERCENT) / (usedKb + availableKb))
        : PERCENT,
    policy,
    ...(lastSizeGb === undefined ? {} : { provisionedGb: lastSizeGb }),
    ...(lastAttempt ? { lastGrowth: growthAttempt(lastAttempt) } : {}),
  };
}

/**
 * words what needs attention in a storage report; none of it fails readiness
 * @param report the measured storage
 * @returns a warning when the storage is nearly full, when it is past its growth threshold with its size at the growth limit, and when the last growth attempt failed; the provisioned size decides the limit when the watcher learned it, else the filesystem's with an allowance for its metadata
 */
export function storageWarnings(report: StorageReport): string[] {
  const { sizeGb, usedGb, usedPercent, policy, provisionedGb, lastGrowth } =
    report;
  const target =
    lastGrowth?.targetGb === undefined
      ? ''
      : ` to ${String(lastGrowth.targetGb)} GB`;
  const growthDetail =
    lastGrowth?.detail === undefined ? '' : `: ${lastGrowth.detail}`;
  const isAtLimit =
    policy.state === 'on' &&
    usedPercent >= policy.thresholdPercent &&
    (provisionedGb === undefined
      ? sizeGb >= policy.limitGb * LIMIT_ALLOWANCE
      : provisionedGb >= policy.limitGb);

  return [
    ...(usedPercent >= FULL_PERCENT
      ? [
          `Storage is ${String(usedPercent)}% full: ${String(usedGb)} of ${String(sizeGb)} GB used`,
        ]
      : []),
    ...(isAtLimit
      ? [
          `Storage is ${String(usedPercent)}% full at its growth limit of ${String(policy.limitGb)} GB and no longer grows automatically`,
        ]
      : []),
    ...(lastGrowth?.outcome === 'failed'
      ? [
          `The last storage growth${target} at ${lastGrowth.at} failed${growthDetail}`,
        ]
      : []),
  ];
}

/**
 * reads the size, used and available KB from what `df -P -k` printed, finding
 * them before the capacity field since the filesystem name and mount point may
 * hold spaces
 * @param measure the command's output: a header line, then one data line
 * @returns the size, used and available KB
 * @throws {Error} when the output holds no data line or a size of zero
 */
function parseMeasure(measure: string): [number, number, number] {
  const fields = (measure.split('\n')[1] ?? '').trim().split(/\s+/u);
  const capacity = fields.findIndex(
    (field, index) =>
      index > KB_FIELD_COUNT &&
      CAPACITY_FIELD.test(field) &&
      fields[index + 1]?.startsWith('/') === true &&
      fields
        .slice(index - KB_FIELD_COUNT, index)
        .every((kb) => KB_FIELD.test(kb)),
  );
  const field = (back: number): number => Number(fields[capacity - back]);
  if (capacity === -1 || field(KB_FIELD_COUNT) === 0) {
    throw new Error('The storage measure is malformed');
  }

  return [field(KB_FIELD_COUNT), field(2), field(1)];
}

/**
 * parses the storage watcher's state and checks its shape strictly
 * @param text the state's contents
 * @returns the validated state
 * @throws {Error} when the state is too long, not JSON, or not a watcher state
 */
function parseWatcherState(text: string): StorageWatcherState {
  const state = text.length <= STATE_BYTES ? decode(text) : undefined;
  if (!isWatcherState(state)) {
    throw new Error('The storage watcher state is not valid');
  }

  return state;
}

/**
 * decodes JSON, turning malformed text into nothing
 * @param text untrusted text
 * @returns the decoded value, or undefined when the text is not JSON
 */
function decode(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/**
 * validates a decoded watcher state field by field, refusing any field the
 * watcher does not write
 * @param value untrusted decoded state
 * @returns whether every field is known and has its type and bound
 */
function isWatcherState(value: unknown): value is StorageWatcherState {
  return (
    isRecord(value) &&
    Object.keys(value).every((key) => STATE_FIELDS.has(key)) &&
    value.version === 1 &&
    (value.lastSizeGb === undefined || isRecordedCount(value.lastSizeGb)) &&
    (value.sizeChangedAt === undefined ||
      isRecordedInstant(value.sizeChangedAt)) &&
    (value.lastAttempt === undefined || isAttempt(value.lastAttempt))
  );
}

/**
 * validates the watcher's recorded attempt
 * @param value untrusted decoded attempt
 * @returns whether every field is known and has its type and bound
 */
function isAttempt(
  value: unknown,
): value is NonNullable<StorageWatcherState['lastAttempt']> {
  return (
    isRecord(value) &&
    Object.keys(value).every((key) => ATTEMPT_FIELDS.has(key)) &&
    isRecordedInstant(value.at) &&
    ATTEMPT_OUTCOMES.includes(value.outcome) &&
    // only a failed attempt may lack a target, when the size query failed
    (value.targetGb === undefined
      ? value.outcome === 'failed'
      : isRecordedCount(value.targetGb)) &&
    (value.detail === undefined || isRecordedText(value.detail)) &&
    (value.sizeGb === undefined || isRecordedCount(value.sizeGb))
  );
}

/**
 * keeps the fields of the watcher's attempt the report carries
 * @param attempt the validated attempt
 * @returns the attempt without the size the provider reported after it
 */
function growthAttempt(
  attempt: NonNullable<StorageWatcherState['lastAttempt']>,
): StorageGrowthAttempt {
  const { sizeGb: _reported, ...growth } = attempt;

  return growth;
}

/**
 * converts KB to GB to one decimal place
 * @param kb a size in KB
 * @returns the size in GB, rounded to the nearest tenth
 */
function gigabytes(kb: number): number {
  return Math.round((kb / KB_PER_GB) * TENTHS) / TENTHS;
}
