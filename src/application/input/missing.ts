import { prerequisiteDetails, missingInput } from '#domain/prerequisites';

import type { InputPrerequisite } from '#domain/prerequisites';

import type { RequiredInput, ResolvedInputs } from './types';

/** the GitHub token guest setup authenticates with, as a declared input */
const GITHUB_TOKEN_INPUT: InputPrerequisite = {
  environment: 'GH_TOKEN',
  prompt: 'GitHub token',
  flag: '--github-token-source env:NAME, file:PATH, or keychain:SERVICE/ACCOUNT',
};

/** what an absent GitHub token needs, in the missingInput wording */
export const MISSING_GITHUB_TOKEN = prerequisiteDetails([
  missingInput(
    GITHUB_TOKEN_INPUT,
    'Or pass --no-github to skip GitHub authentication.',
  ),
]);

/**
 * enumerates all provisioning values absent before remote account discovery,
 * each with every place it is read from
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
