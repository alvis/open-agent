import { projectFields, same } from './fields';
import { projectProfileSummary } from './profile';

import type { MachineSummary } from '#application/machine';

import type { FieldProjectors } from './fields';
import type { ProfileSummaryOutput } from './profile';

/** a workstation as listed or shown, before any guest inspection */
export interface MachineOutput {
  id: string;
  name: string;
  organization: string;
  createdAt?: string;
  state: string;
  agentUrl?: string;
  setup: string;
  profile?: ProfileSummaryOutput;
  readiness: 'not inspected';
}

/** projectors for every field of a machine summary, shared by list entries */
export const machineFields: FieldProjectors<MachineSummary> = {
  id: same,
  name: same,
  organization: same,
  createdAt: same,
  state: same,
  agentUrl: same,
  setup: same,
  profile: projectProfileSummary,
  readiness: same,
};

/**
 * projects a workstation summary
 * @param machine internal summary
 * @returns output summary
 */
export function projectMachine(machine: MachineSummary): MachineOutput {
  return projectFields<MachineSummary, MachineOutput>(machine, machineFields);
}
