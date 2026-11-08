import { hostGrowthRefusal } from '#domain/storage';
import { CommandFault } from '#kernel/faults';
import { publishStatus } from '#kernel/operation';

import type { SuppliedSelection } from '#application/input/selection/supplied';
import type {
  ProviderDriver,
  StorageExtension,
} from '#application/ports/drivers';
import type { Interaction } from '#application/ports/interaction';
import type { WorkstationRecord } from '#domain/workstation';

/** what an explicit storage growth needs */
interface StorageGrowthParams {
  /** authenticated provider hosting the workstation */
  provider: ProviderDriver;
  /** managed workstation selected for this run */
  workstation: WorkstationRecord;
  /** values the run's flags supply; the storage size comes from its flag alone */
  supplied: SuppliedSelection;
  /** optional inline prompts, which receive the status line */
  interaction?: Interaction;
}

/**
 * refuses a storage size this run supplied that the provider cannot grow to,
 * from its declared storage alone, so before any prompt, provider call or
 * guest connection: a provider that cannot grow its storage on request, or a
 * size above its maximum. The growth limit governs only automatic growth and
 * does not apply
 * @param provider the provider hosting the workstation, by its declaration
 * @param supplied values the run's flags supply; the storage size comes from its flag alone
 * @throws {CommandFault} when the provider cannot grow its storage to the supplied size
 */
export function requireGrowableStorage(
  provider: Pick<ProviderDriver, 'displayName' | 'capabilities'>,
  supplied: SuppliedSelection,
): void {
  const requestedGb = supplied.options.minStorageGb;
  const refusal =
    requestedGb === undefined
      ? undefined
      : hostGrowthRefusal(provider.capabilities.storage, requestedGb);
  if (refusal !== undefined) {
    throw new CommandFault({
      code: 'INPUT',
      message: `Cannot grow storage on ${provider.displayName}: ${refusal}`,
    });
  }
}

/**
 * grows the workstation's storage to the size this run supplied, but only
 * when it supplied one, after requireGrowableStorage accepted the size. The
 * provider refuses a size below the current one, since storage never shrinks.
 * The size is a provider fact, never recorded as the profile's minimum
 * @param params provider, workstation, supplied size and status sink
 * @returns the size now provisioned and whether it needs a restart, or undefined when no size was supplied
 */
export async function growStorageWhenRequested(
  params: StorageGrowthParams,
): Promise<StorageExtension | undefined> {
  const { provider, workstation, supplied, interaction } = params;
  const requestedGb = supplied.options.minStorageGb;
  if (requestedGb === undefined) {
    return undefined;
  }
  if (!provider.extendStorage) {
    throw new CommandFault({
      code: 'INPUT',
      message: `Cannot grow the storage of ${workstation.name} on ${provider.displayName}: the provider cannot grow its storage on request`,
    });
  }
  const grown = await provider.extendStorage(workstation, requestedGb);
  if (grown.sizeGb > requestedGb) {
    throw new CommandFault({
      code: 'INPUT',
      message: `Storage of ${workstation.name} is already ${String(grown.sizeGb)} GB; storage never shrinks`,
    });
  }
  if (grown.sizeGb < requestedGb) {
    throw new CommandFault({
      code: 'PROVIDER',
      message: `${provider.displayName} reported storage of ${String(grown.sizeGb)} GB after growing it to ${String(requestedGb)} GB`,
    });
  }
  publishStatus(
    grown.needsRestart
      ? {
          kind: 'warning',
          message: `Storage is ${String(grown.sizeGb)} GB; the new space becomes usable after the next restart of ${workstation.name}`,
        }
      : { kind: 'success', message: `Storage is ${String(grown.sizeGb)} GB` },
    interaction,
  );

  return grown;
}
