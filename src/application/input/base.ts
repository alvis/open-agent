import { defaultProfile } from '#domain/profile';
import { runOperation } from '#kernel/operation';

import { resolveProviderCredential } from './provider-credential';

import { resolveSecret, runtimeEnvironment } from './sources';

import type { CommandOptions } from '#application/contracts';

import type { ApplicationDependencies } from '#application/ports/dependencies';
import type {
  CredentialStoreLocation,
  ManagementCredentialName,
} from '#domain/credentials';
import type { WorkstationProfile } from '#domain/profile';

import type { InputSources } from './sources';
import type { ResolvedInputs } from './types';

type SourceReader = (name: string, explicit?: string) => string | undefined;

interface SecretValues {
  providerToken?: string;
  providerTokenSource?: string;
  proxyApiKey?: string;
  githubCandidate?: string;
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
 * @returns initial inputs and candidate GitHub credential
 */
export async function resolveBaseInputs(
  dependencies: Pick<ApplicationDependencies, 'registry' | 'defaults' | 'host'>,
  params: ResolveBaseInputsParams,
): Promise<{ input: ResolvedInputs; githubCandidate?: string }> {
  const { options, sources, selection = {} } = params;
  const profile = selection.profile ?? defaultProfile(dependencies.defaults);
  const names = declaredNames(dependencies, profile);
  const sourceNames: Record<string, string> = {};
  const value = sourceReader(options, sources, sourceNames);
  const runtimeEnv = runtimeEnvironment(
    dependencies,
    sources.runtimeFileEnv ?? {},
  );
  const secrets = await resolveSelectedSecrets(dependencies, {
    options,
    value,
    profile,
    sources,
    credentialStore: selection.credentialStore,
  });
  annotateSecretSources(options, secrets, {
    names,
    proxyApiKey:
      dependencies.registry.gateways.cliproxyapi.inputs.apiKey.environment,
    sources: sourceNames,
  });
  const input: ResolvedInputs = {
    name: options.name,
    providerToken: secrets.providerToken,
    proxyUrl: value(
      dependencies.registry.gateways.cliproxyapi.inputs.baseUrl.environment,
      options.proxyUrl,
    ),
    proxyApiKey: secrets.proxyApiKey,
    profile,
    runtimeEnv,
    setupFile: sources.setupFile,
    sources: sourceNames,
    missing: [],
  };

  return { input, githubCandidate: secrets.githubCandidate };
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

/**
 * selects non-secret values in explicit, credential file, process, profile order
 * @param options parsed selected credential file path
 * @param sources process, dotenv, and profile values
 * @param names output map of selected source descriptions
 * @returns a precedence-aware value reader
 */
function sourceReader(
  options: CommandOptions,
  sources: InputSources,
  names: Record<string, string>,
): SourceReader {
  return (name, explicit) => {
    const ordered = [
      { value: explicit, description: 'flag' },
      {
        value: sources.fileEnv[name],
        description: options.credentialFile ?? 'credential file',
      },
      { value: sources.processEnv[name], description: 'process environment' },
      { value: sources.profile[name], description: 'saved profile' },
    ];
    const selected = ordered.find((entry) => Boolean(entry.value));
    if (selected) {
      names[name] = selected.description;
    }

    return selected?.value;
  };
}

/** the named inputs of resolve selected secrets */
interface ResolveSelectedSecretsParams {
  /** parsed secret references and local credential policy */
  options: CommandOptions;
  /** non-secret precedence reader for environment values */
  value: SourceReader;
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
 * @param params the call's inputs: options, value, profile, sources, credentialStore
 * @returns selected secrets before optional GitHub confirmation
 */
async function resolveSelectedSecrets(
  dependencies: Pick<ApplicationDependencies, 'registry' | 'host'>,
  params: ResolveSelectedSecretsParams,
): Promise<SecretValues> {
  const { options, value, profile, sources, credentialStore } = params;
  const [provider, proxyApiKey, githubCandidate] = await runOperation(
    async () =>
      Promise.all([
        resolveProviderCredential(dependencies, {
          options,
          provider: profile.provider,
          selection: {
            reference: options.providerTokenSource,
            sources,
            credentialStore,
          },
        }),
        resolveSecret(
          dependencies,
          options.proxyApiKeySource,
          value(
            dependencies.registry.gateways.cliproxyapi.inputs.apiKey
              .environment,
          ),
        ),
        options.github === false
          ? Promise.resolve(undefined)
          : resolveSecret(
              dependencies,
              options.githubTokenSource,
              value('GH_TOKEN') ?? value('GITHUB_TOKEN'),
            ),
      ]),
  );

  return {
    providerToken: provider.token,
    providerTokenSource: provider.source,
    proxyApiKey,
    githubCandidate,
  };
}

/**
 * labels selected local and explicit secret sources without recording values
 * @param options parsed explicit secret references
 * @param secrets resolved secret presence
 * @param context declared credential names and the source descriptions updated in place
 * @param context.names credential names the selected drivers declare
 * @param context.proxyApiKey environment variable the gateway reads its API key from
 * @param context.sources source descriptions keyed by environment name
 */
function annotateSecretSources(
  options: CommandOptions,
  secrets: SecretValues,
  context: {
    names: DeclaredNames;
    proxyApiKey: string;
    sources: Record<string, string>;
  },
): void {
  const { names, proxyApiKey, sources } = context;
  if (secrets.providerTokenSource) {
    sources[names.provider.environment] = secrets.providerTokenSource;
  }
  if (options.proxyApiKeySource) {
    sources[proxyApiKey] = 'explicit secret reference';
  }
  if (options.githubTokenSource) {
    sources.GH_TOKEN = 'explicit secret reference';
  }
}
