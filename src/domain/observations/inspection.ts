import type { NativeConfigurationInspection } from '#domain/observations/native';
import type { NetworkStatus } from '#domain/observations/network';
import type { GuestServiceState } from '#domain/services';

import type { GuestEnvironment } from './environment';
import type { GovernorReport } from './governor';
import type { UpdateStatus } from './updates';

/** current explicit guest inspection result */
export interface GuestInspection {
  services: GuestServiceState[];
  network: NetworkStatus;
  native?: NativeConfigurationInspection;
  /** the environment setup recorded */
  environment: GuestEnvironment;
  /** what the updater recorded about its last run; absent before it ran */
  updates?: UpdateStatus;
  probeFailures: InspectionProbeFailure[];
  /** the idle governor's recorded state, reported but never a readiness failure */
  governor: GovernorReport;
}

/** a live probe that could not establish its current guest state */
export interface InspectionProbeFailure {
  probe: 'services' | 'network' | 'native';
  reason: string;
}
