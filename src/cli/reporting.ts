import { stderr } from 'node:process';

import { redactResolved } from '#kernel/redaction';

import type { ProgressUpdate } from '#application/ports/interaction';
import type { StageEvent } from '#kernel/operation';
import type { StatusUpdate } from '#kernel/status';

import type { InteractionSession } from './interaction';

type CurrentSession = () => InteractionSession | undefined;

/**
 * reports real stage lifecycle events on stderr or the command-lifetime Ink root
 * @param session current interactive session, when available
 * @returns invocation-local stage observer
 */
export function createStageReporter(
  session: CurrentSession,
): (event: StageEvent) => void {
  return (event) => {
    publishStage(event, session);
  };
}

/**
 * publishes only whitelisted stage identity, result and timing
 * @param event real action lifecycle event
 * @param session current terminal session
 */
function publishStage(event: StageEvent, session: CurrentSession): void {
  const message =
    event.event === 'start'
      ? 'Running'
      : event.outcome === 'failed'
        ? 'Failed'
        : 'Completed';
  const update: ProgressUpdate = {
    stage: event.stage,
    message,
    phase: event.event,
    outcome: event.outcome,
    durationMs: event.durationMs,
  };
  const activeSession = session();
  if (activeSession) {
    activeSession.progress(update);

    return;
  }
  const phase =
    event.event === 'start'
      ? 'started'
      : event.outcome === 'failed'
        ? 'failed'
        : 'completed';
  const timing =
    event.durationMs === undefined ? '' : ` (${event.durationMs} ms)`;
  stderr.write(redactResolved(`${event.stage}: ${phase}${timing}\n`));
}

/**
 * reports warnings, errors and routine status on stderr or the command-lifetime Ink root
 * @param session current interactive session, when available
 * @returns invocation-local status observer
 */
export function createStatusReporter(
  session: CurrentSession,
): (update: StatusUpdate) => void {
  return (update) => {
    const activeSession = session();
    if (activeSession) {
      activeSession.status(update);

      return;
    }
    const kind =
      update.kind === 'warning'
        ? 'Warning'
        : update.kind === 'error'
          ? 'Error'
          : 'Info';
    stderr.write(redactResolved(`${kind}: ${update.message}\n`));
  };
}
