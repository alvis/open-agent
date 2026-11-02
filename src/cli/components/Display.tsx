import { Text } from 'ink';
import { useEffect, useState } from 'react';

import type { ProgressUpdate } from '#application/ports/interaction';
import type { StatusUpdate } from '#kernel/status';

const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
const SPINNER_INTERVAL_MS = 100;
const MILLISECONDS_PER_SECOND = 1000;

/**
 * reflects stages actually reported by the workflow
 * @param root0 progress props
 * @param root0.update reported stage and counts
 * @param root0.startedAt stage start time for a live interactive indicator
 * @returns current stage with live or completed timing
 */
export function TaskProgress({
  update,
  startedAt,
}: Readonly<{
  update: ProgressUpdate;
  startedAt?: number;
}>): React.JSX.Element {
  const [tick, setTick] = useState(0);
  const live = startedAt !== undefined && update.phase !== 'complete';
  useEffect(() => {
    if (!live) {
      return;
    }
    const timer = setInterval(
      () => setTick((value) => value + 1),
      SPINNER_INTERVAL_MS,
    );

    return () => clearInterval(timer);
  }, [live, startedAt]);
  const count =
    update.completed === undefined || update.total === undefined
      ? ''
      : ` ${update.completed}/${update.total}`;
  const elapsed = live
    ? ` (${Math.max(0, Math.floor((Date.now() - startedAt) / MILLISECONDS_PER_SECOND))}s)`
    : update.durationMs === undefined
      ? ''
      : ` (${(update.durationMs / MILLISECONDS_PER_SECOND).toFixed(1)}s)`;
  const indicator =
    update.phase === 'complete'
      ? update.outcome === 'failed'
        ? '✗ '
        : '✓ '
      : live
        ? `${SPINNER_FRAMES[tick % SPINNER_FRAMES.length]} `
        : '';

  return (
    <Text>
      {indicator}
      {update.stage}
      {count}: {update.message}
      {elapsed}
    </Text>
  );
}

/**
 * includes a word indicator as well as color in status text
 * @param root0 status props
 * @param root0.update reported status
 */
export function StatusMessage({
  update,
}: Readonly<{ update: StatusUpdate }>): React.JSX.Element {
  const color =
    update.kind === 'error'
      ? 'red'
      : update.kind === 'warning'
        ? 'yellow'
        : update.kind === 'success'
          ? 'green'
          : undefined;

  return (
    <Text color={color}>
      {update.kind.toUpperCase()}: {update.message}
    </Text>
  );
}
