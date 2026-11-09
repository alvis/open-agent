import { CommandFault } from '#kernel/faults';

import type { GuestEnvironment } from '#domain/observations/environment';
import type { WorkstationRecord } from '#domain/workstation';

/**
 * refuses a workstation an open-agent release before `upgrade` set up: its
 * update gate takes no tool selection, and its recorded services name no tools
 * they run on, so no stale service could be found; setup installs both
 * @param environment what the guest records, whose agent service declares its tools from this release on
 * @param workstation the workstation upgraded
 * @throws {CommandFault} CONFLICT naming the setup that brings the guest up to date
 */
export function assertUpgradable(
  environment: GuestEnvironment,
  workstation: WorkstationRecord,
): void {
  const declared = environment.services.some(
    ({ name, runsOn }) =>
      name === environment.agent.service && runsOn !== undefined,
  );
  if (!declared) {
    throw new CommandFault({
      code: 'CONFLICT',
      message: `${workstation.name} was set up by an open-agent release that cannot upgrade its tools selectively`,
      details: [`Run: open-agent setup ${JSON.stringify(workstation.name)}`],
    });
  }
}

/**
 * refuses a tool the workstation does not record, before anything is upgraded
 * @param environment what the guest records, whose tools are the known ones
 * @param named the tools asked for, when any were named
 * @throws {CommandFault} USAGE naming every unknown tool
 */
export function assertRecordedTools(
  environment: GuestEnvironment,
  named: readonly string[] | undefined,
): void {
  const recorded = environment.tools.map(({ name }) => name);
  const unknown = (named ?? []).filter((name) => !recorded.includes(name));
  if (unknown.length > 0) {
    throw new CommandFault({
      code: 'USAGE',
      message: `Unknown ${unknown.length === 1 ? 'tool' : 'tools'}: ${unknown.join(', ')}`,
      details: [`Recorded tools: ${recorded.join(', ') || 'none'}`],
    });
  }
}
