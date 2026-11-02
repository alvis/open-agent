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
  /** recorded selection and mutation tracking */
  context: Pick<SetupContext, 'mutation'> & { expected: WorkstationProfile };
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
  const { mutation, expected } = context;
  await dependencies.guest.environment.assertProfile(guest, expected);
  mutation.started = true;
  await dependencies.guest.environment.writeProfile(guest, profile);
}

/**
 * detects whether this setup invocation changes the persisted selection; the
 * tools section owns only the update due interval, so it changes the selection
 * only when the resolved interval differs from the recorded one, and the agent
 * section owns only the release channel, so it changes the selection only when
 * the resolved channel differs from the recorded one, whether a flag, the
 * environment or a prompt supplied it; a changed machine requirement is
 * persisted by every section, since any section may carry it
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
  if (isMachineChanged(profile, recorded)) {
    return true;
  }
  if (section === 'agent') {
    return isReleaseChanged(profile, recorded);
  }

  return section === 'tools'
    ? profile.options.updateDueIntervalDays !==
        recorded.options.updateDueIntervalDays
    : sectionFields(section).length > 0;
}

/**
 * detects whether a selection moves the ACP agent to another release channel
 * @param profile validated selection this run applies
 * @param recorded selection recorded before this run
 * @returns whether the channels differ
 */
export function isReleaseChanged(
  profile: WorkstationProfile,
  recorded: WorkstationProfile,
): boolean {
  return profile.options.agentRelease !== recorded.options.agentRelease;
}

/**
 * detects whether a selection changes the minimum machine size
 * @param profile validated selection this run applies
 * @param recorded selection recorded before this run
 * @returns whether the CPU or memory minimum differs
 */
function isMachineChanged(
  profile: WorkstationProfile,
  recorded: WorkstationProfile,
): boolean {
  return (
    profile.options.minCpus !== recorded.options.minCpus ||
    profile.options.minMemoryGb !== recorded.options.minMemoryGb
  );
}

/**
 * limits preflight credentials to the parts of the selection this run applies
 * @param section selected setup area
 * @param profile validated selection
 * @returns the profile with an untargeted gateway choice cleared
 */
export function targetedProfile(
  section: SetupSection,
  profile: WorkstationProfile,
): WorkstationProfile {
  const isProxyTargeted = sectionFields(section).includes('isProxyEnabled');

  return {
    ...profile,
    options: {
      ...profile.options,
      isProxyEnabled: isProxyTargeted && profile.options.isProxyEnabled,
    },
  };
}
