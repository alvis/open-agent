import type { CreatePreflight } from '#application/create/context';
import type { MachineSummary } from '#application/machine';
import type { ReadinessAssessment } from '#application/readiness';
import type { ProviderId } from '#domain/ids';
import type { GuestInspection } from '#domain/observations/inspection';
import type { WorkstationProfile } from '#domain/profile';
import type { CommandErrorCode } from '#kernel/faults';

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

/** a provider list could not query, with the normalized failure code */
export interface UnavailableProvider {
  /** provider that could not be queried */
  provider: ProviderId;
  /** failure class, such as AUTH for a revoked credential */
  code: CommandErrorCode;
  /** redacted reason */
  reason: string;
}

/** live control-plane list merged across every provider with credentials */
export interface ListData {
  machines: Array<
    MachineSummary & {
      provider: ProviderId;
      /** the release that set it up, when newer than this open-agent, which then refuses to manage it */
      newerRelease?: string;
    }
  >;
  /** providers that could not be queried, with the reason */
  unavailable: UnavailableProvider[];
}

/** selected workstation and explicitly requested inspection */
export interface ShowData {
  machine: MachineSummary;
  inspection?: GuestInspection & { readiness?: ReadinessAssessment };
}

/** readiness evidence retained even when the workstation is not ready */
export interface CurrentReadiness extends ReadinessAssessment {
  network: GuestInspection['network'];
  native: GuestInspection['native'];
  services: ServiceSummary[];
  environment: GuestInspection['environment'];
}

/** bounded doctor inspection result */
export interface DoctorData {
  machine: MachineSummary;
  currentReadiness: CurrentReadiness;
}

/** success payload for each executed command */
export interface CommandData {
  create: CreateData;
  list: ListData;
  show: ShowData;
  doctor: DoctorData;
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
  list: never;
  show: never;
  doctor: DoctorData;
}
