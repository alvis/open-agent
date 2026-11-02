import type { RequiredInput, ResolvedInputs } from './types';

/**
 * enumerates all provisioning values absent, each with every place it is
 * read from
 * @param input values resolved from explicit and local sources
 * @param required inputs needed by the selected workflow
 * @returns one actionable line per missing input
 */
export function missingProvisioningInputs(
  input: ResolvedInputs,
  required: readonly RequiredInput[],
): string[] {
  return [
    ...(required.includes('name') && !input.name
      ? ['workstation name (--name)']
      : []),
  ];
}
