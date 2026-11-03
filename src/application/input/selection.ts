import {
  agentChoices,
  defaultHarnesses,
  harnessChoices,
  networkChoices,
  providerChoices,
} from './selection/choices';
import { activePrompts } from './selection/sources';
import { readSelection } from './selection/supplied';

import type { ApplicationDependencies } from '#application/ports/dependencies';
import type { ProfileCandidate } from '#domain/profile';
import type { SelectionField } from '#domain/selection-inputs';

import type { Prompts, SelectionContext } from './selection/sources';
import type { SuppliedSelection } from './selection/supplied';

/** a resolved, not yet validated selection */
export interface SelectionResolution {
  /** selection to validate against the catalog */
  candidate: ProfileCandidate;
}

/** every field a new workstation's selection reads */
const CREATE_FIELDS: readonly SelectionField[] = [
  'provider',
  'agent',
  'harnesses',
  'network',
];

/** the named inputs of resolveCreateNetwork */
interface CreateNetworkParams {
  /** network named by a flag or the environment */
  supplied: string | undefined;
  /** active prompts, absent when none may be asked */
  prompts: Prompts | undefined;
}

/**
 * resolves the network of a new workstation: the supplied value, a prompt,
 * then the default
 * @param dependencies the registered drivers, the profile defaults
 * @param params the call's inputs: supplied, prompts
 * @returns the selected network
 */
async function resolveCreateNetwork(
  dependencies: Pick<ApplicationDependencies, 'registry' | 'defaults'>,
  params: CreateNetworkParams,
): Promise<string> {
  const { supplied, prompts } = params;

  return (
    supplied ??
    (await prompts?.choose('Network', networkChoices(dependencies))) ??
    dependencies.defaults.selection.network
  );
}

/**
 * reads the values a create run supplies
 * @param dependencies the registered drivers, which declare the selection inputs
 * @param context flags and sources
 * @returns the supplied values
 */
function readCreateSelection(
  dependencies: Pick<ApplicationDependencies, 'registry'>,
  context: Omit<SelectionContext, 'interaction'>,
): SuppliedSelection {
  return readSelection(dependencies, context, CREATE_FIELDS);
}

/**
 * resolves a new workstation's selection in dependency order: provider, ACP
 * agent, harnesses the agent supports, then network; each step takes the flag,
 * the environment, the selected credential file, a prompt, then the default,
 * and a step with one choice is skipped; every supplied value is read before
 * the first prompt
 * @param dependencies the registered drivers, the profile defaults
 * @param context flags, sources and optional prompts
 * @returns the candidate profile to validate
 */
export async function resolveCreateSelection(
  dependencies: Pick<ApplicationDependencies, 'registry' | 'defaults'>,
  context: SelectionContext,
): Promise<SelectionResolution> {
  const supplied = readCreateSelection(dependencies, context);
  const prompts = activePrompts(context);
  const provider =
    supplied.provider ??
    (await prompts?.choose('Provider', providerChoices(dependencies))) ??
    dependencies.defaults.selection.provider;
  const agent =
    supplied.agent ??
    (await prompts?.choose('ACP agent', agentChoices(dependencies))) ??
    dependencies.defaults.selection.agent;
  const harnesses =
    supplied.harnesses ??
    (await prompts?.chooseMany(
      'Harnesses',
      harnessChoices(dependencies, agent),
    )) ??
    defaultHarnesses(dependencies, agent);
  const network = await resolveCreateNetwork(dependencies, {
    supplied: supplied.network,
    prompts,
  });

  return {
    candidate: {
      provider,
      agent,
      harnesses,
      network,
    },
  };
}
