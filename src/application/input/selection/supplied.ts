import { AGENT_IDS } from '#domain/ids';
import { validateProfile } from '#domain/profile';
import { selectionInputs } from '#domain/selection-inputs';

import { environmentReader } from './sources';

import type { ApplicationDependencies } from '#application/ports/dependencies';
import type { ProfileField, ProfileViolation } from '#domain/profile';
import type { SelectionField } from '#domain/selection-inputs';

import type { SelectionContext } from './sources';

/** the values a caller's flags and environment supply, before prompts and defaults */
export interface SuppliedSelection {
  /** requested provider driver id */
  provider?: string;
  /** requested ACP agent driver id */
  agent?: string;
  /** requested harness driver ids */
  harnesses?: readonly string[];
  /** requested network driver id */
  network?: string;
}

/**
 * validates what can be known before the workstation's recorded profile is:
 * catalog ids and each capability whose drivers are all
 * determined, because they were supplied or the catalog registers only one
 * @param dependencies the registered drivers, the profile defaults
 * @param supplied values a setup run supplies
 * @returns every violation the supplied values alone raise
 */
export function suppliedSelectionViolations(
  dependencies: Pick<ApplicationDependencies, 'registry' | 'defaults'>,
  supplied: SuppliedSelection,
): ProfileViolation[] {
  const provider = supplied.provider;
  const agent = supplied.agent ?? AGENT_IDS[0];
  const determined = new Set<ProfileField>([
    ...(provider === undefined ? [] : (['provider'] as const)),
    'agent',
    ...(supplied.harnesses === undefined ? [] : (['harnesses'] as const)),
    ...(supplied.network === undefined ? [] : (['network'] as const)),
  ]);
  const validation = validateProfile({
    declarations: dependencies.registry,
    candidate: {
      provider: provider ?? dependencies.defaults.selection.provider,
      agent,
      harnesses:
        supplied.harnesses ?? dependencies.defaults.selection.harnesses,
      network: supplied.network ?? dependencies.defaults.selection.network,
    },
  });

  return validation.isValid
    ? []
    : validation.violations.filter(({ fields }) =>
        fields.every((field) => determined.has(field)),
      );
}

/**
 * reads every field a run owns from its flag, then the selected credential file,
 * then the process environment; the provider and agent flags are always read
 * @param dependencies the registered drivers, which declare the selection inputs
 * @param context flags and sources
 * @param fields fields the run owns
 * @returns the supplied values
 */
export function readSelection(
  dependencies: Pick<ApplicationDependencies, 'registry'>,
  context: Omit<SelectionContext, 'interaction'>,
  fields: readonly SelectionField[],
): SuppliedSelection {
  const { options, sources } = context;
  const read = environmentReader(sources);
  const inputs = selectionInputs();
  const owned = (field: SelectionField): string | undefined =>
    fields.includes(field) ? inputs[field].environment : undefined;
  const harnessEnvironment = owned('harnesses');
  const networkEnvironment = owned('network');

  return {
    provider: read.choice({
      flag: options.provider,
      environment: owned('provider'),
    }),
    agent: read.choice({ flag: options.agent, environment: owned('agent') }),
    harnesses: harnessEnvironment
      ? (options.harness ?? read.list(harnessEnvironment))
      : undefined,
    network: networkEnvironment
      ? read.choice({
          flag: options.network,
          environment: networkEnvironment,
        })
      : undefined,
  };
}
