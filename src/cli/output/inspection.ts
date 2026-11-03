import { mapValues, projectFields, same } from './fields';

import type { ServiceSummary } from '#application/data';
import type { T3Environment } from '#domain/observations/agent';
import type { NativeHarnessInspection } from '#domain/observations/harness';
import type {
  HarnessAgentState,
  NativeConfigurationInspection,
} from '#domain/observations/native';
import type { NetworkStatus } from '#domain/observations/network';
import type { GuestServiceState } from '#domain/services';

import type { EnvironmentOutput } from './environment';
import type { ProbeFailureOutput } from './readiness';

/** current state of one service on the guest */
export interface GuestServiceOutput {
  name: string;
  status?: string;
  needs: readonly string[];
  startedAt?: string;
}

/** current service state without executable arguments */
export interface ServiceSummaryOutput {
  name: string;
  state?: string;
}

/** what the guest network reports */
export interface NetworkOutput {
  online: boolean;
  skipped: boolean;
  reason?: string;
}

/** native configuration of one harness */
export interface NativeHarnessOutput {
  authentication: string;
}

/** the agent environment the guest reports */
export type AgentEnvironmentOutput =
  | {
      ok: true;
      serverVersion: string;
      label?: string;
      orchestrationProtocolVersion?: number;
    }
  | { ok: false; reason: string };

/** the evidence the guest observed for a harness */
export interface HarnessStateOutput {
  /** evidence the guest observed, passed through as recorded */
  evidence: unknown;
}

/** native configuration the guest reports, by harness */
export interface NativeOutput {
  claude?: NativeHarnessOutput;
  agentEnvironment?: AgentEnvironmentOutput;
  harnesses: Record<string, HarnessStateOutput>;
}

/** everything a guest inspection observed */
export interface InspectionOutput {
  services: GuestServiceOutput[];
  network: NetworkOutput;
  native?: NativeOutput;
  environment: EnvironmentOutput;
  probeFailures: ProbeFailureOutput[];
}

/**
 * projects the state of one guest service
 * @param service internal state
 * @returns output state
 */
export function projectGuestService(
  service: GuestServiceState,
): GuestServiceOutput {
  return projectFields<GuestServiceState, GuestServiceOutput>(service, {
    name: same,
    status: same,
    needs: same,
    startedAt: same,
  });
}

/**
 * projects a service name and state
 * @param service internal summary
 * @returns output summary
 */
export function projectServiceSummary(
  service: ServiceSummary,
): ServiceSummaryOutput {
  return projectFields<ServiceSummary, ServiceSummaryOutput>(service, {
    name: same,
    state: same,
  });
}

/**
 * projects the guest network state
 * @param network internal state
 * @returns output state
 */
export function projectNetworkStatus(network: NetworkStatus): NetworkOutput {
  return projectFields<NetworkStatus, NetworkOutput>(network, {
    online: same,
    skipped: same,
    reason: same,
  });
}

/**
 * projects the native configuration of a harness
 * @param native internal inspection
 * @returns output inspection
 */
function projectNativeHarness(
  native: NativeHarnessInspection,
): NativeHarnessOutput {
  return projectFields<NativeHarnessInspection, NativeHarnessOutput>(native, {
    authentication: same,
  });
}

/**
 * projects the agent environment the guest reports
 * @param environment internal environment
 * @returns output environment
 */
function projectAgentEnvironment(
  environment: T3Environment,
): AgentEnvironmentOutput {
  return environment.ok
    ? projectFields<typeof environment, AgentEnvironmentOutput>(environment, {
        ok: same,
        serverVersion: same,
        label: same,
        orchestrationProtocolVersion: same,
      })
    : projectFields<typeof environment, AgentEnvironmentOutput>(environment, {
        ok: same,
        reason: same,
      });
}

/**
 * projects the evidence observed for a harness
 * @param state internal state
 * @returns output state
 */
function projectHarnessState(state: HarnessAgentState): HarnessStateOutput {
  return projectFields<HarnessAgentState, HarnessStateOutput>(state, {
    evidence: same,
  });
}

/**
 * projects the native configuration the guest reports
 * @param native internal inspection
 * @returns output inspection
 */
export function projectNative(
  native: NativeConfigurationInspection,
): NativeOutput {
  return projectFields<NativeConfigurationInspection, NativeOutput>(native, {
    claude: projectNativeHarness,
    agentEnvironment: projectAgentEnvironment,
    harnesses: mapValues(projectHarnessState),
  });
}
