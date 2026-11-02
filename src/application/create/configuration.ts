import { awakeHookCommand } from '#application/catalog/awake';
import {
  configureHarnesses,
  harnessDrivers,
} from '#application/catalog/harnesses';
import { networkDriver } from '#application/catalog/networks';
import { installWorkstation } from '#application/installation';
import { markInstallationReady } from '#application/installation/readiness';
import { traceStage } from '#kernel/operation';
import { Secret } from '#kernel/secret';

import type { ApplicationDependencies } from '#application/ports/dependencies';
import type { ProviderDriver } from '#application/ports/drivers';
import type { GuestChannel } from '#application/ports/guest-channel';
import type { Interaction } from '#application/ports/interaction';
import type { SetupSession } from '#application/ports/session';
import type { GitIdentity } from '#domain/git';
import type { WorkstationProfile } from '#domain/profile';

interface NewWorkstationConfiguration {
  /** workstation name, used as the network device hostname and the agent's environment label */
  hostname: string;
  /** validated selection the workstation is created with */
  profile: WorkstationProfile;
  githubToken?: string;
  githubHost?: string;
  gitIdentity?: GitIdentity;
  runtimeEnv: Record<string, string>;
}

/** the named inputs of configure new workstation */
export interface ConfigureNewWorkstationParams {
  /** the provider the workstation runs on */
  provider: ProviderDriver;
  /** the root setup session */
  connection: SetupSession;
  /** optional progress boundary */
  interaction?: Interaction;
  /** confirmed guest setup values */
  configuration: NewWorkstationConfiguration;
}

/**
 * installs the workstation through its setup plan, enrolling the network and
 * writing the native harness and account configuration before the services
 * start, since the agent's launcher reads its runtime environment and
 * committer only as it starts, then records the installation as ready
 * @param dependencies the registered drivers, the guest mechanics
 * @param params the call's inputs: provider, connection, interaction, configuration
 * @returns the guest channel the configuration ran over
 */
export async function configureNewWorkstation(
  dependencies: Pick<ApplicationDependencies, 'registry' | 'guest'>,
  params: ConfigureNewWorkstationParams,
): Promise<GuestChannel> {
  const { provider, configuration } = params;
  const { connection, interaction } = params;
  const { profile } = configuration;
  interaction?.progress({
    stage: 'tools',
    message: 'Installing the guest environment and managed developer tools',
  });
  await traceStage({
    stage: 'create.tools',
    action: async () =>
      installWorkstation(dependencies.guest, {
        provider,
        connection,
        profile,
        interaction,
        beforeServices: async (guest) =>
          enrolAndConfigure(dependencies, {
            guest,
            configuration,
            interaction,
          }),
      }),
  });
  const guest = await connection.guest();
  await dependencies.guest.label.write(guest, configuration.hostname);
  await markInstallationReady(dependencies.guest, guest);

  return guest;
}

/** the named inputs of enrol and configure */
interface EnrolAndConfigureParams {
  /** guest channel of the managed workstation */
  guest: GuestChannel;
  /** confirmed guest setup values */
  configuration: NewWorkstationConfiguration;
  /** optional progress boundary */
  interaction?: Interaction;
}

/**
 * enrols the selected network, writes the native harness and account
 * configuration
 * @param dependencies the registered drivers, the guest mechanics
 * @param params the call's inputs: guest, configuration, interaction
 */
async function enrolAndConfigure(
  dependencies: Pick<ApplicationDependencies, 'registry' | 'guest'>,
  params: EnrolAndConfigureParams,
): Promise<void> {
  const { guest, configuration, interaction } = params;
  const { profile } = configuration;
  const network = networkDriver(dependencies.registry, profile.network);
  await traceStage({
    stage: 'create.network',
    action: async () =>
      network.enroll(guest, { hostname: configuration.hostname }),
  });
  interaction?.progress({
    stage: 'configuration',
    message: 'Writing native harness and account configuration',
  });
  await traceStage({
    stage: 'create.configuration',
    action: async () => configureNative(dependencies, guest, configuration),
  });
}

/**
 * applies selected native account configuration
 * @param dependencies the registered drivers, the guest mechanics
 * @param guest guest channel of the managed workstation
 * @param configuration selected non-secret and transient secret inputs
 */
async function configureNative(
  dependencies: Pick<ApplicationDependencies, 'registry' | 'guest'>,
  guest: GuestChannel,
  configuration: NewWorkstationConfiguration,
): Promise<void> {
  const { profile, githubToken, githubHost } = configuration;
  const drivers = harnessDrivers(dependencies.registry, profile.harnesses);
  await dependencies.guest.native.configureRuntimeEnv(
    guest,
    configuration.runtimeEnv,
    dependencies.registry.providers[profile.provider].shellAccounts,
  );
  if (githubToken) {
    await dependencies.guest.native.configureGithub(
      guest,
      Secret.fromHost('github', githubToken),
      {
        hostname: githubHost,
        shellAccounts:
          dependencies.registry.providers[profile.provider].shellAccounts,
      },
    );
  }
  if (configuration.gitIdentity) {
    await dependencies.guest.native.configureGit(
      guest,
      configuration.gitIdentity,
    );
  }
  await configureHarnesses(guest, {
    drivers,
    awakeHook: awakeHookCommand(dependencies.guest.facts),
  });
}
