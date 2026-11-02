import { projectFields, same } from './fields';

import type { WorkstationProfile, ProfileSummary } from '#domain/profile';

/** the driver selection a workstation recorded */
export interface ProfileSummaryOutput {
  provider: string;
  agent: string;
  harnesses: readonly string[];
  network: string;
}

/** driver selection a workstation recorded */
export type ProfileOutput = ProfileSummaryOutput;

/**
 * projects the driver selection
 * @param summary internal profile summary
 * @returns output profile summary
 */
export function projectProfileSummary(
  summary: ProfileSummary,
): ProfileSummaryOutput {
  return projectFields<ProfileSummary, ProfileSummaryOutput>(summary, {
    provider: same,
    agent: same,
    harnesses: same,
    network: same,
  });
}

/**
 * projects a recorded profile
 * @param profile internal profile
 * @returns output profile
 */
export function projectProfile(profile: WorkstationProfile): ProfileOutput {
  return projectFields<WorkstationProfile, ProfileOutput>(profile, {
    provider: same,
    agent: same,
    harnesses: same,
    network: same,
  });
}
