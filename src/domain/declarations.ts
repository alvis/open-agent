import type { GuestAsset, OsImage } from '#domain/guest';
import type { GuestCommand } from '#domain/guest-command';
import type {
  AgentId,
  DriverKind,
  HarnessId,
  NetworkId,
  ProviderId,
} from '#domain/ids';
import type { ProviderPrerequisites } from '#domain/prerequisites';
import type { WorkstationProfile } from '#domain/profile';
import type { ServiceDefinition } from '#domain/services';
import type { ToolSpec } from '#domain/tools';

/** how core reaches the guest */
type GuestChannelMode = 'provider-exec';

/** who decides when the workstation sleeps */
export type KeepAwakeMode = 'native-deadline' | 'none';

/** a state an idle workstation can enter */
export type IdleForm = 'provider-managed' | 'disk-snapshot';

/** how a sleeping workstation is woken */
export type WakeMode = 'url-traffic' | 'cli-restore' | 'always-on';

/** where workstation data survives sleep */
type PersistenceMode = 'provider-disk' | 'snapshot' | 'host-disk';

/** how the ACP agent port is published */
type ExposureMode = 'provider-url' | 'network-only';

/** where list finds workstations without waking them */
type DiscoverySource = 'provider-metadata';

/** what an ACP agent launches for each selected harness */
type HarnessLaunchMode = 'native-cli' | 'acp-adapter';

/** who can reach the ACP agent's public port */
export type ExposureVisibility = 'private' | 'public';

/** one swappable implementation of a driver kind */
export interface DriverDescriptor<
  Kind extends DriverKind = DriverKind,
  Name extends string = string,
> {
  /** catalog identifier, unique within its kind */
  id: Name;
  /** driver kind the descriptor belongs to */
  kind: Kind;
  /** human-readable name shown in menus and output */
  displayName: string;
}

/** how a provider differs from others, declared as data */
export interface ProviderCapabilities {
  /** how core reaches the guest */
  guestChannel: GuestChannelMode;
  /** who decides when the workstation sleeps */
  keepAwakeMode: KeepAwakeMode;
  /** idle forms in preference order */
  idleForms: readonly IdleForm[];
  /** how a sleeping workstation is woken */
  wakeMode: WakeMode;
  /** a cli-restore provider opts in to governor-initiated sleep */
  supportsCliWakeSleep: boolean;
  /**
   * furthest ahead, in minutes, the provider can keep a workstation awake with
   * one deadline; null when it has no limit. An idle timeout or turn-hold
   * maximum above it is refused when the profile is validated
   */
  maxAwakeDeadlineMinutes: number | null;
  /** where workstation data survives sleep */
  persistence: PersistenceMode;
  /** how the ACP agent port is published */
  exposure: ExposureMode;
  /** where list finds workstations without waking them */
  discovery: DiscoverySource;
  /** changing the machine size restarts a running workstation to take effect */
  resizeRestarts: boolean;
}

/** one machine size a provider offers */
export interface MachineOffer {
  /** the provider's own name for the size, such as `shared-cpu-2x` */
  label: string;
  /** CPUs the size provides */
  cpus: number;
  /** memory the size provides, in whole gigabytes */
  memoryGb: number;
}

/** the smallest machine a workstation must run on */
export interface MachineRequirement {
  /** minimum CPUs */
  cpus: number;
  /** minimum memory, in whole gigabytes */
  memoryGb: number;
}

/** a driver selection combination a provider cannot host */
export interface ProfileIncompatibility {
  /** human-readable explanation reported by validation */
  reason: string;
  /**
   * tells whether this incompatibility applies to a profile
   * @param profile profile whose driver ids are all known to the catalog
   * @returns true when the provider cannot host the profile
   */
  appliesTo(profile: WorkstationProfile): boolean;
}

/** provider identity and capability axes, declared as data */
export interface ProviderDeclaration<
  Name extends string = string,
> extends DriverDescriptor<'providers', Name> {
  /** capability axes core and the idle governor branch on */
  capabilities: ProviderCapabilities;
  /** machine sizes the provider offers, cheapest first */
  machines: readonly MachineOffer[];
  /** combinations validation rejects before any provider call */
  incompatibilities: readonly ProfileIncompatibility[];
  /** host tools and credential every provider-reaching command needs */
  prerequisites: ProviderPrerequisites;
  /** guest login accounts the provider adds beside the agent account; they share its GitHub CLI login */
  shellAccounts: readonly string[];
  /** OS images the provider can create workstations from, the default first */
  images: readonly [OsImage, ...OsImage[]];
  /** guest program the idle governor runs to apply an awake deadline; absent when nothing keeps the provider awake */
  awakeAsset?: GuestAsset;
}

/** a process that speaks ACP on a harness's behalf */
export interface AcpAdapterSpec {
  /** the adapter as a tool, installed and upgraded with its harness */
  tool: ToolSpec;
  /** command the ACP agent runs to launch the adapter */
  launch: GuestCommand;
}

/** harness identity and capabilities, declared as data */
export interface HarnessDeclaration<
  Name extends string = string,
> extends DriverDescriptor<'harnesses', Name> {
  /** ACP adapter the harness provides, when it provides one */
  acpAdapter?: AcpAdapterSpec;
  /** environment the ACP agent passes when spawning the harness */
  spawnEnvironment: Readonly<Record<string, string>>;
}

/** short-lived pairing credential an ACP agent issues */
export interface AgentPairing {
  /** pairing secret; never logged */
  token: string;
  /** expiry as an ISO 8601 timestamp */
  expiresAt?: string;
}

/** one release channel an agent can be installed and kept updated from */
export interface ReleaseChannel {
  /** the name a user selects, such as `stable` */
  id: string;
  /** the npm dist-tag the agent's package is installed and updated from */
  distTag: string;
}

/** an ordered set of release channels and the one chosen when none is selected */
export interface ReleaseChannels {
  /** the channels in menu order */
  channels: readonly ReleaseChannel[];
  /** the identifier of the channel selected by default; one of the channels */
  defaultChannel: string;
}

/** ACP agent identity and capabilities, declared as data */
export interface AgentDeclaration<
  Name extends string = string,
  HarnessName extends string = string,
> extends DriverDescriptor<'agents', Name> {
  /** harnesses the agent can drive; filters the harness menu */
  supportedHarnesses: readonly HarnessName[];
  /** what the agent launches per harness */
  harnessLaunchMode: HarnessLaunchMode;
  /** can issue a pairing code */
  supportsPairing: boolean;
  /** release channels the agent installs from; absent when it has one */
  releaseChannels?: ReleaseChannels;
  /** command, account, public port and dependencies on nothing */
  service: ServiceDefinition;
}

/** network identity, declared as data */
export type NetworkDeclaration<Name extends string = string> = DriverDescriptor<
  'networks',
  Name
>;

/**
 * the data every registered driver declares, keyed by kind and identifier;
 * domain rules read it as a parameter, and the driver registry is assignable to it
 */
export interface ProductDeclarations {
  providers: { [Id in ProviderId]: ProviderDeclaration<Id> };
  harnesses: { [Id in HarnessId]: HarnessDeclaration<Id> };
  agents: { [Id in AgentId]: AgentDeclaration<Id, HarnessId> };
  networks: { [Id in NetworkId]: NetworkDeclaration<Id> };
}
