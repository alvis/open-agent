import {
  configureHarnesses,
  harnessDrivers,
} from '#application/catalog/harnesses';
import { markInstallationReady } from '#application/installation/readiness';
import { traceStage } from '#kernel/operation';

import { installSetupPlan } from './installation';
import { setupNetwork } from './network';
import { setupAgent } from './sections';
import { exposeWhenServing } from './serving';

import type { AllSetupData } from '#application/data';
import type { ApplicationDependencies } from '#application/ports/dependencies';
import type { GuestChannel } from '#application/ports/guest-channel';

import type { SetupContext } from './context';

/**
 * reconciles every managed guest section: the setup plan installs the tools,
 * then the guest is named after its workstation and the network and
 * harnesses are configured before the plan
 * installs and starts the services, the
 * agent is verified to serve and exposed, and only then is the installation
 * recorded ready
 * @param dependencies the registered drivers, the profile defaults, the guest mechanics, what this computer provides
 * @param guest guest channel of the managed workstation
 * @param context full setup choices, prompts, and redaction values
 * @returns non-secret section outcomes after readiness succeeds
 */
export async function setupAll(
  dependencies: ApplicationDependencies,
  guest: GuestChannel,
  context: SetupContext,
): Promise<AllSetupData> {
  const { interaction } = context;
  interaction?.progress({
    stage: 'tools',
    message: 'Installing the guest environment and managed developer tools',
  });
  const configured = Promise.withResolvers<AllSetupData>();
  await installSetupPlan(dependencies, context, async () => {
    // a workstation whose create stopped short has no name recorded yet
    await dependencies.guest.label.write(guest, context.workstation.name);
    configured.resolve(
      await traceStage({
        stage: 'setup.native.configuration',
        action: async () => configureSections(dependencies, guest, context),
      }),
    );
  });
  await exposeWhenServing(dependencies, guest, context);
  await markInstallationReady(dependencies.guest, guest);
  const agent = context.options.withPairCode
    ? await setupAgent(dependencies, guest, context)
    : undefined;

  return { ...(await configured.promise), ...agent };
}

/**
 * configures each section in turn through its owner
 * @param dependencies the registered drivers, the profile defaults, the guest mechanics, what this computer provides
 * @param guest guest channel of the managed workstation
 * @param context full setup choices and mutation state
 * @returns the configured sections' outcomes
 */
async function configureSections(
  dependencies: ApplicationDependencies,
  guest: GuestChannel,
  context: SetupContext,
): Promise<AllSetupData> {
  const network = setupNetwork();
  await configureHarnesses(guest, {
    drivers: harnessDrivers(dependencies.registry, context.profile.harnesses),
  });

  return network;
}
