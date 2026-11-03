import { createEnvironmentAccess } from './environment/store';
import { createInspection } from './inspection';
import { writeWorkstationLabel } from './label';
import { configureGit, configureGithub } from './native/git';
import { createNativeInspection } from './native/inspection';
import { assertImageTools, assemblePlan } from './plan/assembly';
import { needsBottleProbe, probeBottles } from './plan/bottles';
import { runPlan } from './plan/execution';
import { AWAKE_COMMAND } from './platform/awake';
import { ENVIRONMENT_PATH, UPDATE_LOG } from './platform/layout';
import { assertSupportedRelease, newerMetadataRelease } from './release-guard';
import { installProviderServices } from './services/provider';
import { SetupConnection } from './session/connection';
import { inspectAgentRelease } from './tools/channel';
import { UPDATE_GATE_ASSET } from './updates';

import type { DriverRegistry } from '#application/ports/drivers';
import type { GuestMechanics } from '#application/ports/guest';
import type { ProfileDefaults } from '#domain/profile';

/** what the guest mechanics read */
interface GuestMechanicsParams {
  /** every registered driver */
  registry: DriverRegistry;
  /** the default profile selection */
  defaults: ProfileDefaults;
}

/**
 * builds the mechanics the application drives a guest with
 * @param params what the mechanics read
 * @returns everything the application asks of a guest
 */
export function createGuestMechanics(
  params: GuestMechanicsParams,
): GuestMechanics {
  const { registry, defaults } = params;
  const environment = createEnvironmentAccess(registry);
  const native = createNativeInspection({ registry, defaults });

  return {
    facts: {
      awakeCommand: AWAKE_COMMAND,
      updateGateCommand: UPDATE_GATE_ASSET.installAs,
      updateLog: UPDATE_LOG,
      environmentPath: ENVIRONMENT_PATH,
    },
    session: {
      connect: ({ provider, workstation }) =>
        new SetupConnection(provider, workstation),
    },
    plan: {
      assemble: async (params) => assemblePlan(registry, params),
      needsBottleProbe,
      probeBottles,
      run: runPlan,
      assertImageTools: (provider, profile) => {
        assertImageTools(registry, provider, profile);
      },
    },
    tools: {
      inspectAgentRelease: async (session, profile) =>
        inspectAgentRelease(registry, session, profile),
    },
    services: {
      installProvider: async ({ control, services, previous }) =>
        installProviderServices(control, services, previous),
    },
    environment,
    inspection: createInspection({ registry, environment, native }),
    native: {
      inspectAgentEnvironment: async (guest, agent) =>
        native.inspectAgentEnvironment(guest, agent),
      configureGit,
      configureGithub,
    },
    label: { write: writeWorkstationLabel },
    release: {
      assertSupported: assertSupportedRelease,
      newerMetadata: newerMetadataRelease,
    },
  };
}
