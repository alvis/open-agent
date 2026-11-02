import { validateProfile } from '#domain/profile';
import { CommandFault } from '#kernel/faults';

import { resolveBaseInputs } from './input/base';
import { missingProvisioningInputs } from './input/missing';
import { resolveInteractiveInputs } from './input/prompts';
import { resolveCreateSelection } from './input/selection';
import { readEnvironmentSources } from './input/sources';

import type { CommandOptions } from '#application/contracts';
import type { ApplicationDependencies } from '#application/ports/dependencies';
import type { Interaction } from '#application/ports/interaction';
import type { WorkstationProfile } from '#domain/profile';

import type { SelectionResolution } from './input/selection';
import type { InputSources } from './input/sources';
import type { ResolvedInputs, RequiredInput } from './input/types';

const BASE_CREATE_INPUTS: readonly RequiredInput[] = ['name', 'providerToken'];

interface ResolveInputsOptions {
  profile?: WorkstationProfile;
  required?: readonly RequiredInput[];
  sources?: InputSources;
}

/** the named inputs of resolve inputs */
export interface ResolveInputsParams {
  /** parsed flags and explicit secret sources */
  options: CommandOptions;
  /** optional inline prompts */
  interaction?: Interaction;
  /** inputs or extended resolution settings */
  requirementSelection?: readonly RequiredInput[] | ResolveInputsOptions;
}

/**
 * resolves explicit arguments, selected dotenv, process environment, profile, then prompts
 * @param dependencies the registered drivers, the profile defaults, what this computer provides
 * @param params the call's inputs: options, interaction, requirementSelection
 * @returns values and an aggregate of inputs still missing
 */
export async function resolveInputs(
  dependencies: Pick<ApplicationDependencies, 'registry' | 'defaults' | 'host'>,
  params: ResolveInputsParams,
): Promise<ResolvedInputs> {
  const {
    options,
    interaction,
    requirementSelection = BASE_CREATE_INPUTS,
  } = params;
  const resolution = isResolveInputsOptions(requirementSelection)
    ? requirementSelection
    : { required: requirementSelection };
  const required = resolution.required ?? BASE_CREATE_INPUTS;
  const sources =
    resolution.sources ?? (await readEnvironmentSources(dependencies, options));
  const { input } = await resolveBaseInputs(dependencies, {
    options,
    sources,
    selection: {
      profile: resolution.profile,
    },
  });
  await resolveInteractiveInputs(dependencies, input, {
    options,
    interaction,
    required,
  });

  return { ...input, missing: missingProvisioningInputs(input, required) };
}

/**
 * resolves the driver selection in dependency order, validates it before any
 * provider call, then resolves the inputs the selection needs
 * @param dependencies the registered drivers, the profile defaults, what this computer provides
 * @param options parsed flags and explicit input sources
 * @param interaction optional inline choice prompts
 * @returns create inputs with requirements derived from the resolved selection
 */
export async function resolveCreateInputs(
  dependencies: Pick<ApplicationDependencies, 'registry' | 'defaults' | 'host'>,
  options: CommandOptions,
  interaction?: Interaction,
): Promise<ResolvedInputs> {
  const sources = await readEnvironmentSources(dependencies, options);
  const resolution = await resolveCreateSelection(dependencies, {
    options,
    sources,
    interaction,
  });
  const profile = requireValidProfile(dependencies, resolution);

  return resolveInputs(dependencies, {
    options,
    interaction,
    requirementSelection: {
      required: BASE_CREATE_INPUTS,
      profile,
      sources,
    },
  });
}

/**
 * validates a resolved selection against the catalog and driver capabilities
 * @param dependencies the registered drivers
 * @param resolution selection resolved from every source
 * @returns the profile, once every catalog and capability rule holds
 * @throws {CommandFault} listing every violation at once
 */
export function requireValidProfile(
  dependencies: Pick<ApplicationDependencies, 'registry'>,
  resolution: SelectionResolution,
): WorkstationProfile {
  const validation = validateProfile({
    declarations: dependencies.registry,
    candidate: resolution.candidate,
  });
  if (!validation.isValid) {
    throw selectionFault(validation.violations.map(({ message }) => message));
  }

  return validation.profile;
}

/**
 * reports every selection problem in one error
 * @param details one line per problem
 * @returns the INPUT fault
 */
function selectionFault(details: readonly string[]): CommandFault {
  return new CommandFault({
    code: 'INPUT',
    message: 'The workstation selection is invalid',
    details: [...details],
  });
}

/**
 * narrows extended input resolution settings from a plain requirement list
 * @param value requirement list or extended resolution settings
 * @returns whether the value contains extended settings
 */
function isResolveInputsOptions(
  value: readonly RequiredInput[] | ResolveInputsOptions,
): value is ResolveInputsOptions {
  return !Array.isArray(value);
}
