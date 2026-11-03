import { CommandFault } from '#kernel/faults';
import { promptUnavailableDetail } from '#kernel/operation';

import { validateMachineName } from './machine';

import type { CommandRequest } from '#application/contracts';

import type { CommandFaultParams } from '#kernel/faults';

/** input failure that can be reported before provider access */
export class CommandValidationError extends CommandFault {
  /**
   * identifies invalid command syntax or conflicting flags
   * @param params actionable usage explanation and original failure
   */
  constructor(params: Omit<CommandFaultParams, 'code'>) {
    super({ ...params, code: 'USAGE' });
  }
}

/**
 * checks deterministic flag conflicts before token lookup or remote I/O
 * @param request parsed command and options to check
 * @param interactionAvailable whether this invocation can ask for consent
 */
export function validateCommandRequest(
  request: CommandRequest,
  interactionAvailable = true,
): void {
  const options = request.options;
  if (request.machine !== undefined) {
    validateMachineName(request.machine);
  }
  if (request.command === 'create' && options.name !== undefined) {
    validateMachineName(options.name);
  }
  if (
    request.command === 'terminate' &&
    (options.nonInteractive || !interactionAvailable) &&
    (!request.machine || !options.yes)
  ) {
    throw new CommandValidationError({
      message: [
        'Non-interactive termination requires an exact workstation name and --yes',
        promptUnavailableDetail(),
      ]
        .filter(Boolean)
        .join('. '),
    });
  }
}
