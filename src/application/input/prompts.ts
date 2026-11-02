import { machineNameProblem } from '#application/machine';
import { enteredCredentialProblem } from '#domain/prerequisites';
import { rememberSecret } from '#kernel/redaction';

import type { CommandOptions } from '#application/contracts';
import type { ApplicationDependencies } from '#application/ports/dependencies';
import type { Interaction } from '#application/ports/interaction';

import type { RequiredInput, ResolvedInputs } from './types';

interface PromptContext {
  options: CommandOptions;
  interaction?: Interaction;
  required: readonly RequiredInput[];
}

interface ActivePromptContext extends PromptContext {
  interaction: Interaction;
}

/**
 * prompts for missing values only in interactive mode
 * @param dependencies the registered drivers, what this computer provides
 * @param input resolved values to complete in place
 * @param context parsed options and inline prompt boundary
 */
export async function resolveInteractiveInputs(
  dependencies: Pick<ApplicationDependencies, 'registry' | 'host'>,
  input: ResolvedInputs,
  context: PromptContext,
): Promise<void> {
  const { options, interaction, required } = context;
  if (!interaction || options.nonInteractive) {
    return;
  }
  await promptPublicInputs(dependencies, { input, required, interaction });
  await promptSecrets(dependencies, input, {
    options,
    required,
    interaction,
  });
}

/** the named inputs of prompt public inputs */
interface PromptPublicInputsParams {
  /** values to complete in place */
  input: ResolvedInputs;
  /** inputs needed by the selected workflow */
  required: readonly RequiredInput[];
  /** inline text prompts */
  interaction: Interaction;
}

/**
 * asks for missing non-secret create and setup values
 * @param dependencies the registered drivers
 * @param params the call's inputs: input, required, interaction
 */
async function promptPublicInputs(
  dependencies: Pick<ApplicationDependencies, 'registry'>,
  params: PromptPublicInputsParams,
): Promise<void> {
  const { input, required, interaction } = params;
  if (required.includes('name')) {
    input.name ??= await interaction.input({
      message: 'Workstation name',
      required: true,
      validate: machineNameProblem,
    });
  }
}

/**
 * prompts only for missing management credentials
 * @param dependencies the registered drivers, what this computer provides
 * @param input values to complete in place
 * @param context active secret prompts
 */
async function promptSecrets(
  dependencies: Pick<ApplicationDependencies, 'registry' | 'host'>,
  input: ResolvedInputs,
  context: ActivePromptContext,
): Promise<void> {
  const { required, interaction } = context;
  const { credential } =
    dependencies.registry.providers[input.profile.provider].prerequisites;
  if (required.includes('providerToken') && !input.providerToken) {
    const { provider } = input.profile;
    input.providerToken = await interaction.secret({
      message: credential.label,
      description: `It needs ${credential.scope}. ${credential.obtain}`,
      required: true,
      validate: (value) =>
        enteredCredentialProblem({
          declarations: dependencies.registry,
          provider,
          token: value,
        }),
    });
    rememberSecret(input.providerToken);
    input.sources[credential.environment] = 'the entered token';
  }
}
