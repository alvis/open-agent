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
 * persists a validated selection; the update gate reads the tools section's
 * due interval from environment.json, so storing it is the whole change. The
 * setup session holds the guest's setup lock, so nothing else changes the
 * record meanwhile
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
 * detects whether this setup invocation changes the persisted selection; the
 * tools section owns only the update due interval, so it changes the selection
 * only when the resolved interval differs from the recorded one
 * @param section selected setup area
 * @param profile validated selection this run applies
 * @param recorded selection recorded before this run
 * @returns whether profile persistence is required
 */
export function profileUpdateSelected(
  section: SetupSection,
  profile: WorkstationProfile,
  recorded: WorkstationProfile,
): boolean {
  return section === 'tools'
    ? profile.options.updateDueIntervalDays !==
        recorded.options.updateDueIntervalDays
    : sectionFields(section).length > 0;
}
