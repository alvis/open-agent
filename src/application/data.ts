import type { CreatePreflight } from '#application/create/context';
import type { MachineSummary } from '#application/machine';
import type { ReadinessAssessment } from '#application/readiness';
import type { GuestInspection } from '#domain/observations/inspection';
import type { WorkstationProfile } from '#domain/profile';

/** current service state without executable arguments */
export interface ServiceSummary {
  name: string;
  state?: string;
}

/** successful creation with verified preflight and current guest evidence */
export interface CreateData {
  machine: MachineSummary;
  preflight: CreatePreflight;
  /** driver selection the workstation recorded */
  profile: WorkstationProfile;
  readiness: ReadinessAssessment;
  network: GuestInspection['network'];
  services: ServiceSummary[];
  native: GuestInspection['native'];
}

/** success payload for each executed command */
export interface CommandData {
  create: CreateData;
}

/** failed creation can still preserve verified preflight facts */
export interface CreateFailureData {
  preflight: CreatePreflight;
  readiness?: ReadinessAssessment;
  setup?: 'ready';
  recovery?: {
    privacy: 'confirmed' | 'unconfirmed';
    incompleteLabel: 'confirmed' | 'unconfirmed';
  };
}

/** typed observations that remain meaningful after failure */
export interface CommandFailureData {
  create: CreateFailureData;
}
