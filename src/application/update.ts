import { CommandFault } from '#kernel/faults';
import { traceStage } from '#kernel/operation';

import type { ComponentCounts } from '#application/data';
import type { ApplicationDependencies } from '#application/ports/dependencies';
import type { GuestChannel } from '#application/ports/guest-channel';
import type { SetupSession } from '#application/ports/session';
import type { UpdateStatus } from '#domain/observations/updates';

/** longest a forced update may take */
const UPDATE_LIMIT_MS = 3_600_000;

/** one forced run of the update gate */
export interface UpdateRun {
  /** the root setup session the gate runs over */
  connection: SetupSession;
  /** guest channel the recorded outcome is read through */
  guest: GuestChannel;
  /** the stage the run is timed as; `setup.update` when absent */
  stage?: string;
  /** the tools the run upgrades; every recorded tool when absent or empty */
  only?: readonly string[];
}

/**
 * runs the update gate whether or not an update is due, timed as its own
 * stage; a selection makes the gate upgrade only the tools it names
 * @param dependencies the guest mechanics
 * @param run the session, the guest channel, the stage and the selection
 * @returns what the update recorded, when it recorded anything
 * @throws {CommandFault} when the gate could not record the update
 */
export async function runUpdate(
  dependencies: Pick<ApplicationDependencies, 'guest'>,
  run: UpdateRun,
): Promise<UpdateStatus | undefined> {
  const { connection, guest, stage = 'setup.update', only = [] } = run;
  const selection = only.length > 0 ? ['--only', only.join(',')] : [];
  const { exitCode } = await traceStage({
    stage,
    action: async () =>
      connection.run({
        argv: [
          dependencies.guest.facts.updateGateCommand,
          '--force',
          ...selection,
        ],
        account: 'root',
        timeoutMs: UPDATE_LIMIT_MS,
      }),
    context: { succeeded: (result) => result.exitCode === 0 },
  });
  if (exitCode !== 0) {
    throw new CommandFault({
      code: 'PROVIDER',
      message: `The update gate exited with status ${String(exitCode)}; see ${dependencies.guest.facts.updateLog} on the guest`,
    });
  }

  return dependencies.guest.environment.readUpdateStatus(guest);
}

/**
 * summarizes an update as counts of current, untouched and failed tools
 * @param status what the update recorded
 * @returns how many tools are current, were skipped and failed
 */
export function countOutcomes(status: UpdateStatus): ComponentCounts {
  const outcomes = status.tools.map(({ outcome }) => outcome);

  return {
    installed: outcomes.filter((outcome) => outcome === 'installed').length,
    skipped: outcomes.filter((outcome) => outcome === 'skipped').length,
    failed: outcomes.filter((outcome) => outcome === 'failed').length,
  };
}
