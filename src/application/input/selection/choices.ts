import { harnessIds } from '#domain/harnesses';
import { AGENT_IDS, PROVIDER_IDS } from '#domain/ids';
import { networkIds } from '#domain/networks';
import { isDriverId } from '#domain/profile';

import type { ApplicationDependencies } from '#application/ports/dependencies';
import type { InteractionChoice } from '#application/ports/interaction';
import type { ReleaseChannels } from '#domain/declarations';
import type { AgentId, HarnessId, NetworkId, ProviderId } from '#domain/ids';

/**
 * offers every registered provider
 * @param dependencies the registered drivers
 * @returns one labelled choice per provider
 */
export function providerChoices(
  dependencies: Pick<ApplicationDependencies, 'registry'>,
): Array<InteractionChoice<ProviderId>> {
  return PROVIDER_IDS.map((id) => ({
    label: dependencies.registry.providers[id].displayName,
    value: id,
  }));
}

/**
 * offers every registered ACP agent
 * @param dependencies the registered drivers
 * @returns one labelled choice per ACP agent
 */
export function agentChoices(
  dependencies: Pick<ApplicationDependencies, 'registry'>,
): Array<InteractionChoice<AgentId>> {
  return AGENT_IDS.map((id) => ({
    label: dependencies.registry.agents[id].displayName,
    value: id,
  }));
}

/**
 * offers the harnesses the selected ACP agent supports
 * @param dependencies the registered drivers, the profile defaults
 * @param agent selected agent id
 * @param preselected harnesses that start selected; the defaults when omitted
 * @returns one labelled choice per supported harness, preselected where chosen
 */
export function harnessChoices(
  dependencies: Pick<ApplicationDependencies, 'registry' | 'defaults'>,
  agent: string,
  preselected: readonly HarnessId[] = defaultHarnesses(dependencies, agent),
): Array<InteractionChoice<HarnessId>> {
  return supportedHarnesses(dependencies, agent).map((id) => ({
    label: dependencies.registry.harnesses[id].displayName,
    value: id,
    isPreselected: preselected.includes(id),
  }));
}

/**
 * offers every registered network
 * @param dependencies the registered drivers
 * @returns one labelled choice per network
 */
export function networkChoices(
  dependencies: Pick<ApplicationDependencies, 'registry'>,
): Array<InteractionChoice<NetworkId>> {
  return networkIds().map((id) => ({
    label: dependencies.registry.networks[id].displayName,
    value: id,
  }));
}

/**
 * offers the release channels an agent declares with the preferred one first
 * @param channels the agent's declared channels
 * @param preferred channel to offer first
 * @returns one labelled choice per channel, the preferred one first
 */
export function releaseChoices(
  channels: ReleaseChannels,
  preferred: string,
): Array<InteractionChoice<string>> {
  return [
    ...channels.channels.filter(({ id }) => id === preferred),
    ...channels.channels.filter(({ id }) => id !== preferred),
  ].map(({ id }) => ({ label: id, value: id }));
}

/**
 * lists the harnesses an agent supports
 * @param dependencies the registered drivers
 * @param agent agent id, possibly unregistered
 * @returns supported harness ids; every harness when the agent is unknown
 */
function supportedHarnesses(
  dependencies: Pick<ApplicationDependencies, 'registry'>,
  agent: string,
): HarnessId[] {
  return isDriverId(agent, {
    declarations: dependencies.registry,
    kind: 'agents',
  })
    ? harnessIds().filter((id) =>
        dependencies.registry.agents[agent].supportedHarnesses.includes(id),
      )
    : harnessIds();
}

/**
 * selects the default harnesses the agent supports
 * @param dependencies the registered drivers, the profile defaults
 * @param agent agent id
 * @returns default harnesses, or every supported harness when none of the defaults is
 */
export function defaultHarnesses(
  dependencies: Pick<ApplicationDependencies, 'registry' | 'defaults'>,
  agent: string,
): HarnessId[] {
  const supported = supportedHarnesses(dependencies, agent);
  const preselected = dependencies.defaults.selection.harnesses.filter((id) =>
    supported.includes(id),
  );

  return preselected.length > 0 ? preselected : supported;
}
