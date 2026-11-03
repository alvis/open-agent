import { providerPreflight } from '#application/catalog/preflight';
import { bindProvider } from '#application/catalog/providers';
import { prerequisiteDetails } from '#domain/prerequisites';

import type { ProviderCredential } from '#application/input/provider-credential';
import type { ProviderAvailability } from '#application/inspection';
import type { ApplicationDependencies } from '#application/ports/dependencies';
import type { ProviderId } from '#domain/ids';

/** a provider with its resolved management credential */
interface AvailableProviderCredential {
  id: ProviderId;
  credential: ProviderCredential;
}

/**
 * notes that a provider's workstations could not be listed because it has no credential
 * @param dependencies the registered drivers
 * @param id provider without a credential
 * @returns the provider as unavailable with unknown workstation status, naming the credential that would list them
 */
export function skippedProvider(
  dependencies: Pick<ApplicationDependencies, 'registry'>,
  id: ProviderId,
): ProviderAvailability {
  const { credential } = dependencies.registry.providers[id].prerequisites;

  return {
    id,
    code: 'INPUT',
    reason: `workstation status unknown, no ${credential.label} was found; supply one in ${credential.environment}, or with --provider ${id} --provider-token-source, to list its workstations`,
  };
}

/**
 * preflights each provider with a credential and binds the ready ones
 * @param dependencies the registered drivers, what this computer provides
 * @param available providers with a resolved credential
 * @returns bound providers, or the reason each one is unavailable
 */
export async function providerAvailability(
  dependencies: Pick<ApplicationDependencies, 'registry' | 'host'>,
  available: readonly AvailableProviderCredential[],
): Promise<ProviderAvailability[]> {
  return Promise.all(
    available.map(async ({ id, credential }) => {
      const problems = await providerPreflight(
        { registry: dependencies.registry, host: dependencies.host },
        id,
        credential,
      );

      return credential.token && problems.length === 0
        ? {
            id,
            driver: bindProvider(dependencies.registry, id, credential.token),
          }
        : {
            id,
            code: 'INPUT' as const,
            reason: prerequisiteDetails(problems).join(' '),
          };
    }),
  );
}
