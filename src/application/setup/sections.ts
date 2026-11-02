import { markInstallationReady } from '#application/installation/readiness';

import { installSetupPlan } from './installation';

import type { AgentSetupData } from '#application/data';
import type { ApplicationDependencies } from '#application/ports/dependencies';
import type { GuestChannel } from '#application/ports/guest-channel';

import type { SetupContext } from './context';

/**
 * installs persistent agent services
 * @param dependencies the registered drivers, the guest mechanics
 * @param guest guest channel of the managed workstation
 * @param context status reporter and mutation state
 * @returns service outcome
 */
export async function setupAgent(
  dependencies: Pick<ApplicationDependencies, 'registry' | 'guest'>,
  guest: GuestChannel,
  context: SetupContext,
): Promise<AgentSetupData> {
  await installSetupPlan(dependencies, context);
  await markInstallationReady(dependencies.guest, guest);

  return { service: 'configured' };
}
