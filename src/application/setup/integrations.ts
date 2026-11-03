import { sectionFields } from '#application/input/selection';

import type { SetupSection } from '#application/contracts';
import type { ApplicationDependencies } from '#application/ports/dependencies';
import type { GuestChannel } from '#application/ports/guest-channel';
import type { WorkstationProfile } from '#domain/profile';

import type { SetupContext } from './context';

/** the named inputs of persist setup profile */
export interface PersistSetupProfileParams {
  /** selected managed guest */
  guest: GuestChannel;
  /** validated selection this run applies */
  profile: WorkstationProfile;
  /** mutation tracking */
  context: Pick<SetupContext, 'mutation'>;
}

/**
 * persists a validated selection. The setup session holds the guest's setup
 * lock, so nothing else changes the record meanwhile
 * @param dependencies the guest mechanics
 * @param params the call's inputs: guest, profile, context
 */
export async function persistSetupProfile(
  dependencies: Pick<ApplicationDependencies, 'guest'>,
  params: PersistSetupProfileParams,
): Promise<void> {
  const { guest, profile, context } = params;
  const { mutation } = context;
  mutation.started = true;
  await dependencies.guest.environment.writeProfile(guest, profile);
}

/**
 * detects whether this setup invocation changes the persisted selection
 * @param section selected setup area
 * @returns whether profile persistence is required
 */
export function profileUpdateSelected(section: SetupSection): boolean {
  return sectionFields(section).length > 0;
}
