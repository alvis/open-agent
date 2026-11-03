import { selectionInputs } from '#domain/selection-inputs';

import { environmentReader } from './sources';

import type { ApplicationDependencies } from '#application/ports/dependencies';
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
