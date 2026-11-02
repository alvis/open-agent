import { projectFields, same } from './fields';
import { projectMachine } from './machine';

import type { TerminateData } from '#application/data';

import type { MachineOutput } from './machine';

/** a deleted workstation */
export interface TerminateDataOutput {
  machine: MachineOutput;
  workstation: { status: 'deleted'; id: string; name: string };
}

/**
 * projects the termination result
 * @param data internal result
 * @returns output result
 */
export function projectTerminate(data: TerminateData): TerminateDataOutput {
  return projectFields<TerminateData, TerminateDataOutput>(data, {
    machine: projectMachine,
    workstation: (workstation) =>
      projectFields<typeof workstation, TerminateDataOutput['workstation']>(
        workstation,
        { status: same, id: same, name: same },
      ),
  });
}
