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

/** selected workstation and explicitly requested inspection or local action */
export interface ShowData {
  machine: MachineSummary;
  inspection?: GuestInspection & { readiness?: ReadinessAssessment };
  action?: 'copy';
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

/** completed workstation deletion */
export interface TerminateData {
  machine: MachineSummary;
  workstation: { status: 'deleted'; id: string; name: string };
}

/** native agent setup */
export interface AgentSetupData {
  service?: 'configured';
}

/** selected native networking outcome */
export interface NetworkSetupData {
  network: { status: 'disabled'; readiness: 'skipped' };
}

/** all-section recovery retains each independently selected outcome */
export interface AllSetupData
  extends Partial<AgentSetupData>, NetworkSetupData {}

/** concrete outcomes keyed by the executed guest setup section */
interface SetupSectionData {
  all: AllSetupData;
  agent: AgentSetupData;
  network: NetworkSetupData;
}

/** section identity stays correlated with its concrete result */
export type AppliedSetupSection = {
  [Section in keyof SetupSectionData]: {
    section: Section;
  } & SetupSectionData[Section];
}[keyof SetupSectionData];

/** setup configures one guest */
export type SetupData = AppliedSetupSection & {
  machine: MachineSummary;
};

/** success payload for each executed command */
export interface CommandData {
  create: CreateData;
  setup: SetupData;
  list: ListData;
  show: ShowData;
  terminate: TerminateData;
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
  setup: {
    readiness?: ReadinessAssessment;
    recovery?: { incompleteLabel: 'confirmed' | 'unconfirmed' };
  };
  list: never;
  show: never;
  terminate: TerminateData;
  doctor: DoctorData;
}
