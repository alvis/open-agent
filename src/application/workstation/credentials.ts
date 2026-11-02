import { enteredCredentialProblem } from '#domain/prerequisites';
import { rememberSecret } from '#kernel/redaction';

import type { WorkstationCommandParams } from '#application/contracts';
import type { ProviderCredential } from '#application/input/provider-credential';
import type { ApplicationDependencies } from '#application/ports/dependencies';
import type { ProviderId } from '#domain/ids';

/**
 * asks for a provider credential in interactive mode, asking again while the
 * entered value is a credential shape the provider refuses
 * @param dependencies the registered drivers
 * @param params the call's inputs: request, provider, interaction
 * @returns the entered credential, or none in non-interactive mode
 */
export async function enterCommandCredential(
  dependencies: Pick<ApplicationDependencies, 'registry'>,
  params: WorkstationCommandParams<ProviderId>,
): Promise<ProviderCredential> {
  const { request, provider, interaction } = params;
  if (!interaction || request.options.nonInteractive) {
    return {};
  }
  const { credential } =
    dependencies.registry.providers[provider].prerequisites;
  const token = await interaction.secret({
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
  rememberSecret(token);

  return { token, source: 'the entered token' };
}
