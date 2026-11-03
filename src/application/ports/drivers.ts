import type {
  GuestChannel,
  GuestProcess,
} from '#application/ports/guest-channel';
import type {
  AgentDeclaration,
  ExposureVisibility,
  HarnessDeclaration,
  NetworkDeclaration,
  ProviderDeclaration,
} from '#domain/declarations';
import type { GuestAsset } from '#domain/guest';
import type { AgentId, HarnessId, NetworkId, ProviderId } from '#domain/ids';
import type { AgentEnvironments } from '#domain/observations/agent';
import type {
  HarnessInspection,
  HarnessEvidence,
} from '#domain/observations/harness';
import type {
  NetworkStatus,
  NetworkStatuses,
} from '#domain/observations/network';
import type {
  PrerequisiteProblem,
  ProviderPreflightParams,
} from '#domain/prerequisites';
import type { WorkstationProfile } from '#domain/profile';
import type { ReadinessFinding } from '#domain/readiness';
import type { GuestServiceState } from '#domain/services';
import type { ToolSpec } from '#domain/tools';
import type {
  WorkstationMetadata,
  WorkstationRecord,
} from '#domain/workstation';

/** what core binds a provider to before any provider call */
export interface ProviderBinding {
  /** provider management credential kept on this computer */
  credential: string;
  /**
   * names of the managed services the provider may stop and restore while
   * replacing a service they depend on; every other dependent blocks the replacement
   */
  restorableServices: readonly string[];
}

/** a provider: where the workstation runs and how it is reached */
export interface ProviderDriver<
  Name extends string = string,
> extends ProviderDeclaration<Name> {
  /**
   * checks every declared prerequisite without a provider call, so a command
   * reports all missing or misconfigured items at once
   * @param params resolved credential and a host tool lookup
   * @returns every problem found, each with its fix; empty when ready
   */
  preflight(params: ProviderPreflightParams): Promise<PrerequisiteProblem[]>;
  /**
   * binds the provider management credential and the facts core supplies;
   * operations on an unbound driver reject with an authentication failure
   * @param binding management credential and the services core may restore
   * @returns the same provider bound to the credential
   */
  authenticate(binding: ProviderBinding): ProviderDriver<Name>;
  /**
   * lists managed workstations from live provider records
   * @returns managed workstations
   */
  list(): Promise<WorkstationRecord[]>;
  /**
   * fetches one managed workstation, rejecting with not-found when none exists
   * so the provider's own diagnostic reaches the user
   * @param name exact workstation name
   * @returns the managed workstation
   */
  get(name: string): Promise<WorkstationRecord>;
  /**
   * tells whether any provider resource, managed or not, already uses a name
   * @param name proposed workstation name
   * @returns true when creating the name would collide
   */
  isNameTaken(name: string): Promise<boolean>;
  /**
   * provisions privately and records ownership and the profile summary
   * @param name workstation name
   * @param profile validated profile
   * @param port ACP agent port a later `expose` publishes; a provider that
   * must declare the route when it provisions does so here, unreachable
   * until exposure
   * @returns the created workstation
   */
  create(
    name: string,
    profile: WorkstationProfile,
    port: number,
  ): Promise<WorkstationRecord>;
  /**
   * writes ownership, schema, setup state and profile summary; never credentials
   * @param workstation managed workstation
   * @param metadata setup state and profile summary to record
   * @returns the workstation as recorded after the update
   */
  setMetadata(
    workstation: WorkstationRecord,
    metadata: WorkstationMetadata,
  ): Promise<WorkstationRecord>;
  /**
   * publishes the ACP agent port, only after readiness
   * @param workstation managed workstation
   * @param port ACP agent port
   * @param visibility who may reach the port
   */
  expose(
    workstation: WorkstationRecord,
    port: number,
    visibility: ExposureVisibility,
  ): Promise<void>;
  /**
   * opens the provider-neutral guest channel
   * @param workstation managed workstation
   * @returns the guest channel
   */
  openGuest(workstation: WorkstationRecord): Promise<GuestChannel>;
  /**
   * opens a root shell that reads its commands from standard input, for a
   * setup session; how it becomes root is the provider's own
   * @param workstation managed workstation
   * @param shell absolute path of the OS family's shell, such as `/bin/dash`
   * @returns the running shell
   */
  openRootShell(
    workstation: WorkstationRecord,
    shell: string,
  ): Promise<GuestProcess>;
  /**
   * waits until the guest has finished booting, so setup never races the
   * provider's own boot work
   * @param workstation managed workstation
   */
  awaitGuestReady(workstation: WorkstationRecord): Promise<void>;
}

/** a coding CLI the user works through */
export interface HarnessDriver<
  Name extends string = string,
  Evidence extends HarnessEvidence | undefined = HarnessEvidence | undefined,
> extends HarnessDeclaration<Name> {
  /** the tools the harness installs, its own CLI first */
  tools: readonly ToolSpec[];
  /**
   * merges native configuration, preserving unrelated user settings
   * @param guest guest channel
   */
  configure(guest: GuestChannel): Promise<void>;
  /**
   * observes the harness's current native state
   * @param guest guest channel
   * @returns configuration and probe evidence
   */
  inspect(guest: GuestChannel): Promise<HarnessInspection<Evidence>>;
}

/** facts the agent's readiness checks compare */
export interface AgentReadinessEvidence<Environment = unknown> {
  /** services currently registered on the guest */
  services: readonly GuestServiceState[];
  /** what the running agent service reports about itself, absent when it could not be observed */
  environment: Environment | undefined;
}

/**
 * agent readiness findings, grouped so core can interleave them with the
 * network findings without changing the reporting order
 */
export interface AgentReadiness {
  /** the agent service itself */
  service: ReadinessFinding[];
  /** the running agent service answering about its environment */
  environment: ReadinessFinding[];
}

/** the single service behind the workstation's public URL */
export interface AgentDriver<
  Name extends string = string,
  HarnessName extends string = string,
  Environment = unknown,
> extends AgentDeclaration<Name, HarnessName> {
  /** the tools the agent installs: its own CLI, then the runtime it needs */
  tools: readonly ToolSpec[];
  /** the launcher the service runs, which reads its launch facts from environment.json */
  launcher: GuestAsset;
  /**
   * observes what the running agent service reports about itself
   * @param guest guest channel
   * @returns the environment the service reports, absent when it could not be probed
   */
  inspectEnvironment(guest: GuestChannel): Promise<Environment | undefined>;
  /**
   * proves the installed agent supports the startup options core relies on
   * @param guest guest channel
   */
  verifyStartup(guest: GuestChannel): Promise<void>;
  /**
   * derives readiness findings from already gathered evidence
   * @param evidence services and the environment the running service reports
   * @returns grouped readiness findings in reporting order
   */
  readiness(evidence: AgentReadinessEvidence<Environment>): AgentReadiness;
}

/** inputs for checking a network before provisioning */
export interface NetworkPreflightParams {
  /** device name the workstation will register under */
  hostname: string;
}

/** what a network preflight established */
export interface NetworkPreflightResult {
  /** reasons that block provisioning, in the order the checks were made */
  problems: unknown[];
}

/** inputs for network enrollment */
export interface NetworkEnrollParams {
  /** device name the workstation registers under */
  hostname: string;
}

/**
 * an optional private-network tool; a network that is no tool, such as one
 * that selects no private network, declares no tools
 */
export interface NetworkDriver<
  Name extends string = string,
  Status extends NetworkStatus = NetworkStatus,
> extends NetworkDeclaration<Name> {
  /** the tools the network installs, installed and updated only while it is selected; empty when it installs nothing */
  tools: readonly ToolSpec[];
  /**
   * validates caller inputs and the device name before provisioning, running
   * every check even when one fails
   * @param params device name
   * @returns every blocking problem
   */
  preflight(params: NetworkPreflightParams): Promise<NetworkPreflightResult>;
  /**
   * starts the daemon, enrols the device and requires live evidence
   * @param guest guest channel
   * @param params enrollment inputs
   */
  enroll(guest: GuestChannel, params: NetworkEnrollParams): Promise<void>;
  /**
   * inspects current network status without cached data
   * @param guest guest channel
   * @returns current status
   */
  status(guest: GuestChannel): Promise<Status>;
  /**
   * derives network readiness findings from already gathered status
   * @param status current status
   * @returns findings in reporting order
   */
  readiness(status: Status): ReadinessFinding[];
}

/** every registered driver, keyed by kind and identifier; the composition registry satisfies it */
export interface DriverRegistry {
  providers: { [Id in ProviderId]: ProviderDriver<Id> };
  harnesses: { [Id in HarnessId]: HarnessDriver<Id> };
  agents: {
    [Id in AgentId]: AgentDriver<Id, HarnessId, AgentEnvironments[Id]>;
  };
  networks: { [Id in NetworkId]: NetworkDriver<Id, NetworkStatuses[Id]> };
}
