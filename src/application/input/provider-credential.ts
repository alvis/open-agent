import { readEnvironmentSources, resolveSecret } from './sources';

import type { CommandOptions } from '#application/contracts';
import type { ApplicationDependencies } from '#application/ports/dependencies';
import type { ProviderId } from '#domain/ids';

import type { InputSources } from './sources';

/** a provider credential and the place it was read from */
export interface ProviderCredential {
  /** the credential, when any declared source holds one */
  token?: string;
  /** where the credential was read from, named for the caller */
  source?: string;
}

/** where a provider credential may be read from */
interface ProviderCredentialSources {
  /** the explicit secret reference that names this provider's credential */
  reference?: string;
  /** process and credential file values, read from the options when omitted */
  sources?: Pick<InputSources, 'processEnv' | 'fileEnv'>;
}

/** the named inputs of resolve provider credential */
export interface ResolveProviderCredentialParams {
  /** parsed env file path */
  options: CommandOptions;
  /** provider whose declared credential is read */
  provider: ProviderId;
  /** explicit reference and preloaded sources */
  selection?: ProviderCredentialSources;
}

/**
 * resolves a provider's management credential from its declared sources, in
 * explicit reference, credential file, then process environment order
 * @param dependencies the registered drivers, what this computer provides
 * @param params the call's inputs: options, provider, selection
 * @returns the credential and where it came from, if any source holds one
 */
export async function resolveProviderCredential(
  dependencies: Pick<ApplicationDependencies, 'registry' | 'host'>,
  params: ResolveProviderCredentialParams,
): Promise<ProviderCredential> {
  const { options, provider, selection = {} } = params;
  const { reference } = selection;
  if (reference) {
    return {
      token: await resolveSecret(dependencies, reference, undefined),
      source: `--provider-token-source ${reference}`,
    };
  }
  const { credential } =
    dependencies.registry.providers[provider].prerequisites;
  const sources =
    selection.sources ?? (await readEnvironmentSources(dependencies, options));
  const candidates = [
    {
      value: sources.fileEnv[credential.environment],
      source: `${credential.environment} in ${options.credentialFile ?? 'the credential file'}`,
    },
    {
      value: sources.processEnv[credential.environment],
      source: `${credential.environment} in the process environment`,
    },
  ];
  const direct = candidates.find(({ value }) => Boolean(value));
  if (direct) {
    return {
      token: await resolveSecret(dependencies, undefined, direct.value),
      source: direct.source,
    };
  }

  return {};
}
