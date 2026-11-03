import type { AgentId } from '#domain/ids';
import type { AgentEnvironments } from '#domain/observations/agent';
import type { GuestEnvironment } from '#domain/observations/environment';
import type { GuestInspection } from '#domain/observations/inspection';
import type { UpdateStatus } from '#domain/observations/updates';
import type { WorkstationProfile } from '#domain/profile';
import type { ServiceDefinition } from '#domain/services';
import type { RefusedSource } from '#domain/tools';
import type { WorkstationRecord } from '#domain/workstation';
import type { CommandFault } from '#kernel/faults';

import type { ProviderDriver } from './drivers';
import type { GuestChannel, GuestServiceControl } from './guest-channel';
import type {
  AssemblyParams,
  PlanReport,
  PlanRunParams,
  SetupAssembly,
} from './plan';
import type { SetupConnectionParams, SetupSession } from './session';

/**
 * what the guest tells of the agent's own CLI against its release channel:
 * untracked when the CLI follows no channel on npm, known with the version
 * installed (absent when none can be read) and the one the channel's
 * dist-tag names now, or unknown when the registry could not be asked
 */
export type AgentReleaseState =
  | { status: 'untracked' }
  | { status: 'known'; installed?: string; tagged: string }
  | { status: 'unknown'; reason: string };

/** the fixed places and commands the guest programs are reached at */
export interface GuestFacts {
  /** the idle governor's command, run by hooks and holds */
  awakeCommand: string;
  /** the update gate's installed command, run as root to force an update */
  updateGateCommand: string;
  /** the updater's log on the guest */
  updateLog: string;
  /** where setup records environment.json */
  environmentPath: string;
}

/** one thing an inspection reads, named without its commands */
export type InspectionProbe =
  'inspection' | 'services' | 'network' | 'native' | 'governor';

/** the lifecycle of one probe an inspection runs */
export type ProbeEvent =
  | { probe: InspectionProbe; phase: 'started' }
  | {
      probe: InspectionProbe;
      phase: 'completed' | 'failed';
      /** how long the probe ran, in milliseconds */
      durationMs: number;
    };

/** what an inspection observes and reads besides the guest itself */
export interface InspectionParams {
  /** observer for actual probe starts and elapsed completions */
  onProbe?: (event: ProbeEvent) => void;
}

/**
 * where a command learns which release set a workstation up: `metadata` never
 * wakes the guest, `guest` reads environment.json and fails when it cannot,
 * and `guest-or-metadata` falls back to the metadata when the guest is unreadable
 */
export type ReleaseSource = 'metadata' | 'guest' | 'guest-or-metadata';

/** what the provider's own services are installed from */
export interface ProviderServiceParams {
  /** the provider's own service control */
  control: GuestServiceControl;
  /** the services the plan records */
  services: readonly ServiceDefinition[];
  /** names of the services an earlier setup recorded */
  previous: readonly string[];
}

/** how the guest's recorded environment is read and written */
export interface GuestEnvironmentAccess {
  /**
   * reads the environment setup recorded on the guest
   * @param guest target guest
   * @returns the record
   * @throws {CommandFault} when its format version is unknown
   * @throws {Error} when it is missing or malformed
   */
  read(guest: GuestChannel): Promise<GuestEnvironment>;
  /**
   * reads the environment setup recorded, when it recorded one
   * @param guest target guest
   * @returns the record, or nothing before setup first wrote it
   */
  find(guest: GuestChannel): Promise<GuestEnvironment | undefined>;
  /**
   * replaces the recorded environment atomically, readable by every account
   * @param guest target guest
   * @param environment the record
   * @throws {CommandFault} when the record's profile is invalid
   */
  write(guest: GuestChannel, environment: GuestEnvironment): Promise<void>;
  /**
   * records a profile whose change no tool, service or job follows
   * @param guest target guest
   * @param profile the profile to record
   */
  writeProfile(guest: GuestChannel, profile: WorkstationProfile): Promise<void>;
  /**
   * reads what the updater recorded about its last run
   * @param guest target guest
   * @returns the record, or nothing when no update ran or it cannot be read
   */
  readUpdateStatus(guest: GuestChannel): Promise<UpdateStatus | undefined>;
}

/** the mechanics of a guest's native tooling configuration */
export interface GuestNativeConfiguration {
  /**
   * asks the selected agent's own environment check
   * @param guest target guest
   * @param agent selected ACP agent, else the default
   * @returns what the running agent service reports, absent when it could not be probed
   */
  inspectAgentEnvironment(
    guest: GuestChannel,
    agent?: AgentId,
  ): Promise<AgentEnvironments[AgentId] | undefined>;
}

/**
 * everything the application asks of a guest's mechanics: the setup session,
 * the plan and its steps, the installed tools, the recorded environment, the
 * inspection probes and the native configuration. The adapters implement it; the application
 * decides when each runs
 */
export interface GuestMechanics {
  /** the fixed places and commands of the guest */
  facts: GuestFacts;
  session: {
    /**
     * binds a setup session to a workstation without opening it
     * @param params the provider and the workstation
     * @returns the session
     */
    connect(params: SetupConnectionParams): SetupSession;
  };
  plan: {
    /**
     * assembles the setup plan for a probed release
     * @param params the provider, profile, release and version
     * @returns the steps, the resolved tools and the environment they record
     * @throws {CommandFault} when a required tool has no usable source on the guest
     */
    assemble(params: AssemblyParams): Promise<SetupAssembly>;
    /**
     * tells whether the plan installs Homebrew formulae whose bottles the
     * installed Homebrew should be asked about
     * @param assembly the assembled plan
     * @returns true when the foundation installs Homebrew and a tool resolved to a formula
     */
    needsBottleProbe(assembly: SetupAssembly): boolean;
    /**
     * asks the installed Homebrew which formulae have no bottle
     * @param session the setup session, whose foundation has run
     * @param assembly the assembled plan
     * @returns the sources the guest turns down
     * @throws {CommandFault} when Homebrew cannot report
     */
    probeBottles(
      session: SetupSession,
      assembly: SetupAssembly,
    ): Promise<readonly RefusedSource[]>;
    /**
     * runs steps in the order their needs allow, reporting facts only
     * @param params the steps, the session opener and the progress callback
     * @returns every step's outcome
     */
    run(params: PlanRunParams): Promise<PlanReport>;
    /**
     * refuses, before the provider creates anything, a selection whose
     * required tools no source serves on the provider's default image
     * @param provider the provider, whose default image is checked
     * @param profile the selection
     * @throws {CommandFault} when a required tool has no usable source on the image
     */
    assertImageTools(
      provider: Pick<ProviderDriver, 'images'>,
      profile: WorkstationProfile,
    ): void;
  };
  tools: {
    /**
     * reads the version of the agent's own CLI the guest has installed and
     * the one its release channel names now
     * @param session the setup session, opened when it is not
     * @param profile the selection, whose agent and release channel are read
     * @returns both versions, or why the channel's could not be read
     */
    inspectAgentRelease(
      session: SetupSession,
      profile: WorkstationProfile,
    ): Promise<AgentReleaseState>;
  };
  services: {
    /**
     * registers the services a provider runs itself
     * @param params the provider's control, the services and the earlier names
     */
    installProvider(params: ProviderServiceParams): Promise<void>;
  };
  environment: GuestEnvironmentAccess;
  inspection: {
    /**
     * reads current service, route and installation state
     * @param guest target guest
     * @param params the probe observer
     * @returns current service, network, native, environment and update status
     */
    inspect(
      guest: GuestChannel,
      params?: InspectionParams,
    ): Promise<GuestInspection>;
  };
  native: GuestNativeConfiguration;
  label: {
    /**
     * names the guest after its workstation
     * @param guest target guest
     * @param label name of the workstation the guest belongs to
     */
    write(guest: GuestChannel, label: string): Promise<void>;
  };
  release: {
    /**
     * refuses a workstation a newer open-agent release set up
     * @param provider the provider the workstation runs on
     * @param workstation record of the machine checked
     * @param source where the recorded release is read from
     * @throws {CommandFault} when the recorded release is newer than this one
     */
    assertSupported(
      provider: Pick<ProviderDriver, 'openGuest'>,
      workstation: WorkstationRecord,
      source: ReleaseSource,
    ): Promise<void>;
    /**
     * names the release a workstation's metadata records when it is newer
     * than this one, without waking the guest
     * @param workstation record of the machine checked
     * @returns the newer recorded release, or nothing
     */
    newerMetadata(workstation: WorkstationRecord): string | undefined;
  };
}
