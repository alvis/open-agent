/** every registered provider driver, in catalog order */
export const PROVIDER_IDS = ['sprite'] as const;

/** every registered harness driver, in catalog order */
export const HARNESS_IDS = ['claude'] as const;

/** every registered ACP agent driver, in catalog order */
export const AGENT_IDS = ['t3'] as const;

/** every registered network driver, in catalog order */
export const NETWORK_IDS = ['none'] as const;

/** identifier of a registered provider driver */
export type ProviderId = (typeof PROVIDER_IDS)[number];

/** identifier of a registered harness driver */
export type HarnessId = (typeof HARNESS_IDS)[number];

/** identifier of a registered ACP agent driver */
export type AgentId = (typeof AGENT_IDS)[number];

/** identifier of a registered network driver */
export type NetworkId = (typeof NETWORK_IDS)[number];

/** the kinds of driver a workstation selects */
export type DriverKind = 'providers' | 'harnesses' | 'agents' | 'networks';

/** registered identifiers, keyed by driver kind */
interface DriverIds {
  providers: ProviderId;
  harnesses: HarnessId;
  agents: AgentId;
  networks: NetworkId;
}

/** identifier of a registered driver of one kind, or of any kind */
export type DriverId<Kind extends DriverKind = DriverKind> = DriverIds[Kind];

/** the network a workstation selects when it joins no private network */
export const NO_NETWORK = 'none' satisfies NetworkId;
