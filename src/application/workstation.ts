import { createWorkstation } from '#application/create';
import { commandError } from '#application/failures';
import { validateCommandRequest } from '#application/validation';
import {
  currentOperation,
  cancellationReason,
  checkOperation,
  withOperation,
} from '#kernel/operation';

import type { CommandRequest } from '#application/contracts';
import type { ApplicationDependencies } from '#application/ports/dependencies';
import type { Interaction } from '#application/ports/interaction';
import type { CommandResult } from '#application/result';
import type { OperationContext } from '#kernel/operation';

/** the interaction and caller-owned cancellation scope one command runs with */
export interface CommandSession {
  /** optional prompts, status and progress boundary */
  interaction?: Interaction;
  /** optional explicit caller-owned cancellation scope */
  operation?: OperationContext;
}

/**
 * dispatches one workstation request without starting the CLI or printing its result
 * @param dependencies the registered drivers, the profile defaults, the guest mechanics, what this computer provides
 * @param request command and options
 * @param session the call's inputs: interaction, operation
 * @returns the structured command result with resolved errors redacted
 * @example
 * const result = await runCommand(createDependencies(), {
 *   command: 'create',
 *   options: { credentialFile: '.env', nonInteractive: true },
 * });
 */
export async function runCommand(
  dependencies: ApplicationDependencies,
  request: CommandRequest,
  session?: CommandSession,
): Promise<CommandResult> {
  const { interaction, operation } = session ?? {};
  try {
    if (operation) {
      return await withOperation(operation, async () =>
        runCommand(dependencies, request, { interaction }),
      );
    }
    checkOperation();
    currentOperation()?.select(request.command);
    validateCommandRequest(request);

    return await createWorkstation(dependencies, request, interaction);
  } catch (error) {
    return commandFailureResult(
      error,
      operation ?? currentOperation(),
      request,
    );
  }
}

/**
 * builds a failure without dropping bounded recovery details or exact identity
 * @param error primary rejection
 * @param context current invocation, if any
 * @param request selected command
 * @returns typed failure result
 */
function commandFailureResult(
  error: unknown,
  context: OperationContext | undefined,
  request: CommandRequest,
): CommandResult {
  const failure = commandError(
    context?.signal.aborted ? cancellationReason() : error,
  );
  const machine = context?.target?.name;

  return {
    command: context?.command ?? request.command,
    ok: false,
    error: {
      ...failure,
      machine,
      machineId: context?.target?.id,
      details:
        failure.code === 'CANCELLED' && machine
          ? [
              ...(failure.details ?? []),
              'Remote work may be unfinished; inspect before retrying mutations.',
            ]
          : failure.details,
    },
  };
}
