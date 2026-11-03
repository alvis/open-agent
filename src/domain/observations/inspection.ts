import type { NativeConfigurationInspection } from '#domain/observations/native';
import type { NetworkStatus } from '#domain/observations/network';
import type { GuestServiceState } from '#domain/services';

import type { GuestEnvironment } from './environment';

/** current explicit guest inspection result */
export interface GuestInspection {
  services: GuestServiceState[];
  network: NetworkStatus;
  native?: NativeConfigurationInspection;
  /** the environment setup recorded */
  environment: GuestEnvironment;
  probeFailures: InspectionProbeFailure[];
}

/** a live probe that could not establish its current guest state */
export interface InspectionProbeFailure {
  probe: 'services' | 'network' | 'native';
  reason: string;
}
