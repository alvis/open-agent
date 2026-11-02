import { CommandFault } from '#kernel/faults';

import { traceStage } from '#kernel/operation';

import { selectManagedMachine } from './inspection';

import { summarizeMachine } from './machine';

import type {
  CommandRequest,
  WorkstationCommandParams,
} from '#application/contracts';
import type { TerminateData } from '#application/data';
import type { ApplicationDependencies } from '#application/ports/dependencies';
import type { Interaction } from '#application/ports/interaction';
import type { CommandResult } from '#application/result';
import type { WorkstationRecord } from '#domain/workstation';

/**
 * permanently deletes one verified managed workstation
 * @param dependencies the registered drivers, the profile defaults, the guest mechanics, what this computer provides
 * @param params the call's inputs: request, provider, interaction
 * @returns exact deletion outcome
 */
export async function terminateWorkstation(
  dependencies: ApplicationDependencies,
  params: WorkstationCommandParams,
): Promise<CommandResult> {
  const { request, provider, interaction } = params;
  if (!interaction && (!request.machine || !request.options.yes)) {
    throw new CommandFault({
      code: 'USAGE',
      message:
        'Non-interactive termination requires an exact workstation name and --yes',
    });
  }
  const workstation = await selectManagedMachine(dependencies, {
    provider,
    requestedName: request.machine,
    interaction,
    release: 'guest-or-metadata',
  });
  assertTerminationTarget(workstation, request);
  if (!(await confirmDeletion(workstation, request, interaction))) {
    return {
      command: 'terminate',
      ok: false,
      error: {
        code: 'CANCELLED',
        message: 'Typed name did not match; no resources were deleted',
      },
    };
  }
  const machine = summarizeMachine(dependencies, workstation);
  interaction?.progress({
    stage: 'terminate',
    message: `Deleting workstation ${workstation.name}`,
  });
  await traceStage({
    stage: 'terminate.provider',
    action: async () => provider.delete(workstation),
  });
  const data: TerminateData = {
    machine,
    workstation: { status: 'deleted', id: machine.id, name: workstation.name },
  };

  return { command: 'terminate', ok: true, data };
}

/**
 * requires an exact typed name unless the caller supplied exact target and consent
 * @param workstation the ownership-checked live workstation
 * @param request parsed target and non-interactive consent
 * @param interaction optional inline confirmation prompt
 * @returns whether deletion was confirmed
 */
async function confirmDeletion(
  workstation: WorkstationRecord,
  request: CommandRequest,
  interaction?: Interaction,
): Promise<boolean> {
  if (
    !interaction ||
    (request.options.yes &&
      request.machine !== undefined &&
      request.machine.length > 0)
  ) {
    return true;
  }
  interaction.status({
    kind: 'warning',
    message: `Permanently deleting ${workstation.name} (${workstation.id}) destroys its filesystem and repositories.`,
  });
  const typedName = await interaction.input({
    message: `Type ${workstation.name} to delete it`,
    required: true,
  });

  return typedName === workstation.name;
}

/**
 * checks immutable identity and the exact requested name before deletion consent
 * @param workstation selected provider workstation
 * @param request explicitly requested deletion target
 */
function assertTerminationTarget(
  workstation: WorkstationRecord,
  request: CommandRequest,
): void {
  if (!workstation.id || !workstation.organization) {
    throw new CommandFault({
      code: 'PROVIDER',
      message: 'Selected workstation lacks immutable provider identity',
    });
  }
  if (request.machine && request.machine !== workstation.name) {
    throw new CommandFault({
      code: 'CONFLICT',
      message:
        'Named termination target does not match the verified workstation; no resources were deleted',
    });
  }
}
