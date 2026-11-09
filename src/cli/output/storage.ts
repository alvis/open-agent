import { projectFields, same } from './fields';
import { asRecord, printable } from './records';

import type { StorageSummary } from '#application/data';
import type { JsonObject, JsonValue } from '#cli/serialization';
import type {
  StorageGrowthAttempt,
  StorageReport,
} from '#domain/observations/storage';
import type { StoragePolicy } from '#domain/storage';

/** a storage growth policy as output reports it */
export type StoragePolicyOutput =
  | { state: 'unsupported' }
  | { state: 'off' }
  | {
      state: 'on';
      thresholdPercent: number;
      stepGb: number;
      limitGb: number;
      mechanisms: string[];
    };

/** the storage a new workstation starts with and how it grows */
export interface StorageSummaryOutput {
  sizeGb: number;
  policy: StoragePolicyOutput;
}

/** the storage watcher's last growth attempt */
export interface StorageGrowthOutput {
  at: string;
  targetGb?: number;
  outcome: string;
  detail?: string;
}

/** a workstation's measured storage and how it grows */
export interface StorageReportOutput {
  sizeGb: number;
  usedGb: number;
  usedPercent: number;
  policy: StoragePolicyOutput | { state: 'not-recorded' };
  provisionedGb?: number;
  lastGrowth?: StorageGrowthOutput;
}

/**
 * projects a new workstation's storage
 * @param storage internal storage summary
 * @returns output storage summary
 */
export function projectStorageSummary(
  storage: StorageSummary,
): StorageSummaryOutput {
  return projectFields<StorageSummary, StorageSummaryOutput>(storage, {
    sizeGb: same,
    policy: projectStoragePolicy,
  });
}

/**
 * projects a workstation's measured storage
 * @param report internal storage report
 * @returns output storage report
 */
export function projectStorageReport(
  report: StorageReport,
): StorageReportOutput {
  return projectFields<StorageReport, StorageReportOutput>(report, {
    sizeGb: same,
    usedGb: same,
    usedPercent: same,
    policy: (policy) =>
      policy.state === 'not-recorded'
        ? { state: 'not-recorded' }
        : projectStoragePolicy(policy),
    provisionedGb: same,
    lastGrowth: (attempt) =>
      projectFields<StorageGrowthAttempt, StorageGrowthOutput>(attempt, {
        at: same,
        targetGb: same,
        outcome: same,
        detail: same,
      }),
  });
}

/**
 * projects a growth policy, keeping only the fields its state carries
 * @param policy internal growth policy
 * @returns output growth policy
 */
export function projectStoragePolicy(
  policy: StoragePolicy,
): StoragePolicyOutput {
  return policy.state === 'on'
    ? {
        state: 'on',
        thresholdPercent: policy.thresholdPercent,
        stepGb: policy.stepGb,
        limitGb: policy.limitGb,
        mechanisms: [...policy.mechanisms],
      }
    : { state: policy.state };
}

/**
 * condenses the measured storage into one line: its usage, how it grows, and
 * the storage watcher's last attempt when there is one. A guest-supplied
 * string is shown without control characters
 * @param value the storage report from the inspection, absent when unmeasured
 * @returns the storage line, or nothing when the storage was not measured
 */
export function storageLine(value: JsonValue | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  const storage = asRecord(value);

  return [
    `${figure(storage.usedGb)} of ${figure(storage.sizeGb)} GB used (${figure(storage.usedPercent)}%)`,
    policyPart(asRecord(storage.policy)),
    ...(storage.lastGrowth === undefined
      ? []
      : [growthPart(asRecord(storage.lastGrowth))]),
  ].join('; ');
}

/**
 * words how storage grows under its recorded policy
 * @param policy the recorded growth policy
 * @returns the policy part of the storage line
 */
function policyPart(policy: JsonObject): string {
  switch (policy.state) {
    case 'on':
      return `grows by ${figure(policy.stepGb)} GB at ${figure(policy.thresholdPercent)}% up to ${figure(policy.limitGb)} GB`;
    case 'off':
      return 'automatic growth off';
    case 'unsupported':
      return 'fixed';
    default:
      return 'policy not recorded';
  }
}

/**
 * words the storage watcher's last growth attempt, without a target when the
 * watcher could not learn the size to grow from
 * @param attempt the recorded attempt
 * @returns the last-growth part of the storage line
 */
function growthPart(attempt: JsonObject): string {
  const detail =
    typeof attempt.detail === 'string' ? `: ${printable(attempt.detail)}` : '';
  const target =
    attempt.targetGb === undefined ? '' : ` to ${figure(attempt.targetGb)} GB`;

  return `last growth${target} ${attempt.outcome === 'grown' ? 'succeeded' : 'failed'} at ${figure(attempt.at)}${detail}`;
}

/**
 * words a reported number or instant for a line of text, without control
 * characters
 * @param value a reported number or string
 * @returns the value as text, or a question mark when it is neither
 */
function figure(value: JsonValue | undefined): string {
  if (typeof value === 'number') {
    return String(value);
  }

  return typeof value === 'string' ? printable(value) : '?';
}
