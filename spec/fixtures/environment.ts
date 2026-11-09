import { ENVIRONMENT_SCHEMA } from '#adapters/guest/environment/contracts';
import { registry } from '#composition/registry';
import { agentPort } from '#domain/services';
import { OPEN_AGENT_VERSION } from '#kernel/version';

import type { GuestEnvironment } from '#domain/observations/environment';
import type { ProfileOptions, WorkstationProfile } from '#domain/profile';

/** the profile options a release before storage growth recorded */
type EarlierOptions = Omit<
  ProfileOptions,
  | 'minStorageGb'
  | 'autoExtend'
  | 'autoExtendThresholdPercent'
  | 'autoExtendStepGb'
  | 'storageLimitGb'
>;

/** environment.json as a release before storage growth wrote it */
export interface EarlierEnvironment extends Omit<
  GuestEnvironment,
  'profile' | 'storage'
> {
  /** the recorded profile, without the storage options */
  profile: Omit<WorkstationProfile, 'options'> & { options: EarlierOptions };
}

/**
 * builds the environment.json a finished setup of a profile records, with no
 * tools, jobs or network and only the agent's service
 * @param profile the recorded profile
 * @param overrides fields that differ from a ready setup
 * @returns a complete environment record
 */
export function environmentOf(
  profile: WorkstationProfile,
  overrides: Partial<GuestEnvironment> = {},
): GuestEnvironment {
  return {
    schema: ENVIRONMENT_SCHEMA,
    openAgent: { version: OPEN_AGENT_VERSION, setupAt: '2026-10-14T00:00:00Z' },
    setup: { state: 'ready', skipped: [] },
    os: { family: 'debian' },
    profile,
    tools: [],
    schedule: { dueDays: 7 },
    provider: {
      id: profile.provider,
      serviceBackend: 'provider',
      keepAwakeMode: 'none',
      idleForms: ['provider-managed'],
      wakeMode: 'url-traffic',
      supportsCliWakeSleep: false,
      maxAwakeDeadlineMinutes: null,
      transportNetworks: [],
      idleTimeoutMinutes: profile.options.idleTimeoutMinutes,
      holdMaxMinutes: profile.options.holdMaxMinutes,
      awakeAdapter: null,
    },
    agent: {
      id: profile.agent,
      service: registry.agents[profile.agent].service.name,
      account: 'agent',
      port: agentPort(registry, profile.agent),
      harnesses: [],
    },
    network: null,
    services: [registry.agents[profile.agent].service],
    jobs: [],
    ...overrides,
  };
}

/**
 * builds the environment.json a release before storage growth recorded: its
 * profile has no storage options and the record no growth policy
 * @param profile the recorded profile, whose storage options are dropped
 * @returns a complete environment record of that release
 */
export function earlierEnvironmentOf(
  profile: WorkstationProfile,
): EarlierEnvironment {
  const {
    minStorageGb: _minStorageGb,
    autoExtend: _autoExtend,
    autoExtendThresholdPercent: _autoExtendThresholdPercent,
    autoExtendStepGb: _autoExtendStepGb,
    storageLimitGb: _storageLimitGb,
    ...options
  } = profile.options;
  const { storage: _storage, ...environment } = environmentOf(profile);

  return { ...environment, profile: { ...profile, options } };
}
