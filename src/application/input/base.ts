import { defaultProfile } from '#domain/profile';
import { runOperation } from '#kernel/operation';

import { resolveProviderCredential } from './provider-credential';

import type { CommandOptions } from '#application/contracts';

import type { ApplicationDependencies } from '#application/ports/dependencies';
import type {
  CredentialStoreLocation,
  ManagementCredentialName,
} from '#domain/credentials';
import type { WorkstationProfile } from '#domain/profile';

import type { InputSources } from './sources';
import type { ResolvedInputs } from './types';

interface SecretValues {
  providerToken?: string;
  providerTokenSource?: string;
}

/** selected local fallback requirements for this real input resolution */
interface BaseInputSelection {
  /** driver selection whose declared inputs are read */
  profile?: WorkstationProfile;
  credentialStore?: CredentialStoreLocation;
}

/** environment names of the provider credentials this run reads */
interface DeclaredNames {
  provider: { environment: string; store: ManagementCredentialName };
}

/** the named inputs of resolve base inputs */
export interface ResolveBaseInputsParams {
  /** parsed explicit values and secret references */
  options: CommandOptions;
  /** process, credential file, and profile values */
  sources: InputSources;
  /** resolved profile and selected local credential fallback */
  selection?: BaseInputSelection;
}

/**
 * resolves initial create/setup inputs before optional inline prompts
 * @param dependencies the registered drivers, the profile defaults, what this computer provides
 * @param params the call's inputs: options, sources, selection
 * @returns initial inputs
 */
export async function resolveBaseInputs(
  dependencies: Pick<ApplicationDependencies, 'registry' | 'defaults' | 'host'>,
  params: ResolveBaseInputsParams,
): Promise<{ input: ResolvedInputs }> {
  const { options, sources, selection = {} } = params;
  const profile = selection.profile ?? defaultProfile(dependencies.defaults);
  const names = declaredNames(dependencies, profile);
  const sourceNames: Record<string, string> = {};
  const secrets = await resolveSelectedSecrets(dependencies, {
    options,
    profile,
    sources,
    credentialStore: selection.credentialStore,
  });
  annotateSecretSources(secrets, {
    names,
    sources: sourceNames,
  });
  const input: ResolvedInputs = {
    name: options.name,
    providerToken: secrets.providerToken,
    profile,
    sources: sourceNames,
    missing: [],
  };

  return { input };
}

/**
 * reads the credential and input names the selected drivers declare
 * @param dependencies the registered drivers
 * @param profile driver selection
 * @returns provider credential names
 */
function declaredNames(
  dependencies: Pick<ApplicationDependencies, 'registry'>,
  profile: WorkstationProfile,
): DeclaredNames {
  const { credential } =
    dependencies.registry.providers[profile.provider].prerequisites;

  return {
    provider: { environment: credential.environment, store: credential.store },
  };
}

/** the named inputs of resolve selected secrets */
interface ResolveSelectedSecretsParams {
  /** parsed secret references and local credential policy */
  options: CommandOptions;
  /** driver selection whose provider credential is read */
  profile: WorkstationProfile;
  /** process and credential file values */
  sources: InputSources;
  /** optional explicitly selected real store */
  credentialStore?: CredentialStoreLocation;
}

/**
 * resolves secret references without transferring management credentials to the guest
 * @param dependencies the registered drivers, what this computer provides
 * @param params the call's inputs: options, profile, sources, credentialStore
 * @returns the provider credential and its source
 */
async function resolveSelectedSecrets(
  dependencies: Pick<ApplicationDependencies, 'registry' | 'host'>,
  params: ResolveSelectedSecretsParams,
): Promise<SecretValues> {
  const { options, profile, sources, credentialStore } = params;
  const provider = await runOperation(async () =>
    resolveProviderCredential(dependencies, {
      options,
      provider: profile.provider,
      selection: {
        reference: options.providerTokenSource,
        sources,
        credentialStore,
      },
    }),
  );

  return {
    providerToken: provider.token,
    providerTokenSource: provider.source,
  };
}

/**
 * labels selected local and explicit secret sources without recording values
 * @param secrets resolved secret presence
 * @param context declared credential names and the source descriptions updated in place
 * @param context.names credential names the selected drivers declare
 * @param context.sources source descriptions keyed by environment name
 */
function annotateSecretSources(
  secrets: SecretValues,
  context: {
    names: DeclaredNames;
    sources: Record<string, string>;
  },
): void {
  const { names, sources } = context;
  if (secrets.providerTokenSource) {
    sources[names.provider.environment] = secrets.providerTokenSource;
  }
}
