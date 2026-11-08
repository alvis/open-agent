import { each, projectFields, same } from './fields';
import { projectUpdateTool } from './inspection';
import { projectMachine } from './machine';
import { projectComponents } from './setup';

import type { ServiceRestart, UpgradeData } from '#application/data';

import type { UpdateStatusOutput } from './inspection';
import type { MachineOutput } from './machine';
import type { ComponentCountsOutput } from './setup';

/** what an upgrade did to one service still running an older tool */
export interface ServiceRestartOutput {
  service: string;
  tools: readonly string[];
  outcome: string;
  reason?: string;
}

/** the tools an upgrade installed and the services it restarted */
export interface UpgradeDataOutput {
  machine: MachineOutput;
  selection: readonly string[];
  components?: ComponentCountsOutput;
  tools: UpdateStatusOutput['tools'];
  restarts?: ServiceRestartOutput[];
}

/**
 * projects the upgrade result
 * @param data internal result
 * @returns output result
 */
export function projectUpgrade(data: UpgradeData): UpgradeDataOutput {
  return projectFields<UpgradeData, UpgradeDataOutput>(data, {
    machine: projectMachine,
    selection: same,
    components: projectComponents,
    tools: each(projectUpdateTool),
    restarts: each(projectRestart),
  });
}

/**
 * projects one service restart
 * @param restart internal restart
 * @returns output restart
 */
function projectRestart(restart: ServiceRestart): ServiceRestartOutput {
  const { service, tools, outcome } = restart;

  return restart.outcome === 'restarted'
    ? { service, tools, outcome }
    : { service, tools, outcome, reason: restart.reason };
}
