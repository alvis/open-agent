import { pairAgent } from '#application/catalog/services';
import { markInstallationReady } from '#application/installation/readiness';
import { PairingSecret } from '#kernel/pairing-secret';

import { installSetupPlan } from './installation';

import type { AgentSetupData } from '#application/data';
import type { ApplicationDependencies } from '#application/ports/dependencies';
import type { GuestChannel } from '#application/ports/guest-channel';

import type { SetupContext } from './context';

/**
 * installs persistent agent services, or mints a requested native pairing
 * @param dependencies the registered drivers, the guest mechanics
 * @param guest guest channel of the managed workstation
 * @param context pairing options, status reporter, and mutation state
 * @returns service or pairing outcome
 */
export async function setupAgent(
  dependencies: Pick<ApplicationDependencies, 'registry' | 'guest'>,
  guest: GuestChannel,
  context: SetupContext,
): Promise<AgentSetupData> {
  const { options, interaction, profile } = context;
  if (!options.withPairCode) {
    await installSetupPlan(dependencies, context);
    await markInstallationReady(dependencies.guest, guest);

    return { service: 'configured', pairing: { status: 'not requested' } };
  }
  const pairing = await pairAgent(dependencies.registry, guest, profile.agent);
  interaction?.status({
    kind: 'success',
    message: `New ${dependencies.registry.agents[profile.agent].displayName} pairing expires ${pairing.expiresAt ?? 'per native policy'}`,
  });

  return {
    pairing: {
      status: 'created',
      expiresAt: pairing.expiresAt,
      token: new PairingSecret({ token: pairing.token }),
    },
  };
}
