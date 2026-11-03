import { CommandFault } from '#kernel/faults';
import { promptUnavailableDetail } from '#kernel/operation';

import { validateMachineName } from './machine';

import type { CommandOptions, CommandRequest } from '#application/contracts';

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
  if (request.command === 'setup') {
    validateSetupOptions(options);
  } else {
    validateNonSetupOptions(options);
  }
}

/**
 * keeps setup mutations on the setup command
 * @param options parsed flags for a command other than setup
 */
function validateNonSetupOptions(options: CommandOptions): void {
  if (options.section) {
    throw new CommandValidationError({
      message: 'Setup-only options require the setup command',
    });
  }
}

/**
 * requires a usable setup section
 * @param options parsed setup flags
 */
function validateSetupOptions(options: CommandOptions): void {
  validateSetupIntegrationOptions(options, options.section);
  if (!options.section && options.nonInteractive) {
    throw new CommandValidationError({
      message: [
        'Non-interactive setup requires --section',
        promptUnavailableDetail(),
      ]
        .filter(Boolean)
        .join('. '),
    });
  }
}

/**
 * keeps explicit integration choices within sections that apply their side effects
 * @param options parsed setup flags
 * @param section explicit or inferred setup section
 */
export function validateSetupIntegrationOptions(
  options: CommandOptions,
  section: CommandOptions['section'],
): void {
  if (!section || section === 'all') {
    return;
  }
  if (section !== 'network' && options.network !== undefined) {
    throw new CommandValidationError({
      message: 'Network switches require --section network or --section all',
    });
  }
  if (options.harness !== undefined) {
    throw new CommandValidationError({
      message: 'Harness switches require --section all',
    });
  }
}
