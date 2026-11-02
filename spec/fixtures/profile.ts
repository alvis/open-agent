import { defaults } from '#composition/defaults';
import { registry } from '#composition/registry';
import { defaultProfile } from '#domain/profile';
import { summarizeProfile } from '#domain/recorded';
import { agentPort } from '#domain/services';

import type { ProfileSummary, WorkstationProfile } from '#domain/profile';

/** default profile of a workstation created without a private network */
export const DISABLED_NETWORK_PROFILE: WorkstationProfile =
  defaultProfile(defaults);

/** ACP agent port of the default profile, which create declares to the provider */
export const DEFAULT_AGENT_PORT = agentPort(
  registry,
  DISABLED_NETWORK_PROFILE.agent,
);

/** profile summary a default workstation without a private network records */
export const DISABLED_NETWORK_SUMMARY: ProfileSummary = summarizeProfile(
  DISABLED_NETWORK_PROFILE,
);
