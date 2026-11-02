import type { OsImage } from '#domain/guest';
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
  /** where workstation data survives sleep */
  persistence: PersistenceMode;
  /** how the ACP agent port is published */
  exposure: ExposureMode;
  /** where list finds workstations without waking them */
  discovery: DiscoverySource;
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
  /** capability axes core branches on */
  capabilities: ProviderCapabilities;
  /** combinations validation rejects before any provider call */
  incompatibilities: readonly ProfileIncompatibility[];
  /** host tools and credential every provider-reaching command needs */
  prerequisites: ProviderPrerequisites;
  /** OS images the provider can create workstations from, the default first */
  images: readonly [OsImage, ...OsImage[]];
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

/** ACP agent identity and capabilities, declared as data */
export interface AgentDeclaration<
  Name extends string = string,
  HarnessName extends string = string,
> extends DriverDescriptor<'agents', Name> {
  /** harnesses the agent can drive; filters the harness menu */
  supportedHarnesses: readonly HarnessName[];
  /** what the agent launches per harness */
  harnessLaunchMode: HarnessLaunchMode;
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
