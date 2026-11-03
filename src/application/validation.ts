import { validateMachineName } from './machine';

import type { CommandRequest } from '#application/contracts';

/**
 * checks deterministic flag conflicts before token lookup or remote I/O
 * @param request parsed command and options to check
 */
export function validateCommandRequest(request: CommandRequest): void {
  const options = request.options;
  if (request.command === 'create' && options.name !== undefined) {
    validateMachineName(options.name);
  }
}
