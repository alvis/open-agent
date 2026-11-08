import { providerChoices } from './choices';
import { resolveMachine } from './options';
import { resolveStorage } from './storage';
import { storagePolicyFlags } from './supplied';

import type { CommandOptions } from '#application/contracts';
import type { ApplicationDependencies } from '#application/ports/dependencies';
import type { ProfileOptions } from '#domain/profile';

import type {
  ResolvedStorage,
  StorageContext,
  StorageOptions,
} from './storage';

/** what the provider step of a new workstation's selection takes */
interface ProviderStepContext extends Omit<
  StorageContext,
  'provider' | 'flags'
> {
  /** flags of the run, whose storage policy flags validation refuses rather than ignores */
  options: CommandOptions;
  /** the supplied provider, if any */
  provider?: string;
}

/** the provider of a new workstation and the sizes checked against it */
interface ProviderStep {
  /** selected provider, validated later against the catalog */
  provider: string;
  /** the machine minimums and the storage options */
  sizes: Pick<ProfileOptions, 'minCpus' | 'minMemoryGb'> & StorageOptions;
  /** what validation must know of where the storage options came from */
  storageRequests: Omit<ResolvedStorage, 'options'>;
}

/**
 * resolves the provider of a new workstation, then the machine and storage
 * minimums, asked right after it since they are checked against it
 * @param dependencies the registered drivers, the profile defaults
 * @param context flags, supplied provider and options, base options and prompts
 * @returns the provider, its machine and storage options, and what validation must know of the storage requests
 */
export async function resolveCreateProvider(
  dependencies: Pick<ApplicationDependencies, 'registry' | 'defaults'>,
  context: ProviderStepContext,
): Promise<ProviderStep> {
  const { options, supplied, base, prompts } = context;
  const asked = { supplied, base, ...(prompts && { prompts }) };
  const provider =
    context.provider ??
    (await prompts?.choose('Provider', providerChoices(dependencies))) ??
    dependencies.defaults.selection.provider;
  const machine = await resolveMachine(dependencies, { provider, ...asked });
  const { options: storage, ...storageRequests } = await resolveStorage(
    dependencies,
    { provider, flags: storagePolicyFlags(options), ...asked },
  );

  return { provider, sizes: { ...machine, ...storage }, storageRequests };
}
