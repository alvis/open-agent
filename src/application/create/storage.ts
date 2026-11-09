import { effectiveStoragePolicy, initialStorageGb } from '#domain/storage';

import type { StorageSummary } from '#application/data';
import type { ApplicationDependencies } from '#application/ports/dependencies';
import type { WorkstationProfile } from '#domain/profile';

/**
 * derives the storage a new workstation starts with and the growth policy it runs with
 * @param dependencies the registered drivers
 * @param profile validated selection
 * @returns the starting size and the effective growth policy on the selected provider
 */
export function summarizeStorage(
  dependencies: Pick<ApplicationDependencies, 'registry'>,
  profile: WorkstationProfile,
): StorageSummary {
  const { storage } =
    dependencies.registry.providers[profile.provider].capabilities;

  return {
    sizeGb: initialStorageGb(storage, profile.options),
    policy: effectiveStoragePolicy(storage, profile.options),
  };
}
