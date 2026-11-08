import { commandError } from '#application/failures';
import { selectManagedMachine, showWorkstation } from '#application/inspection';
import { summarizeMachine } from '#application/machine';
import { withBackNavigation } from '#application/navigation';
import { setupWorkstation } from '#application/setup';
import { terminateWorkstation } from '#application/terminate';
import { upgradeWorkstation } from '#application/upgrade';
import { CommandFault } from '#kernel/faults';
import { InteractionExit, returnOnBack } from '#kernel/navigation';
import { currentOperation, checkOperation } from '#kernel/operation';

import type {
  CommandRequest,
  WorkstationCommandParams,
} from '#application/contracts';
import type { MachineSummary } from '#application/machine';
import type { ApplicationDependencies } from '#application/ports/dependencies';
import type { ProviderDriver } from '#application/ports/drivers';
import type {
  Interaction,
  InteractionChoice,
} from '#application/ports/interaction';
import type { CommandResult } from '#application/result';
import type { CommandName } from '#kernel/commands';

/** workstation command context with an active interaction */
type InteractiveWorkstationCommandParams = WorkstationCommandParams & {
  interaction: Interaction;
};

interface WorkstationActionContext {
  request: CommandRequest;
  machine: MachineSummary;
  agentUrl: string | undefined;
  provider: ProviderDriver;
  interaction: Interaction;
}

type WorkstationAction =
  'details' | 'pair' | 'inspect' | 'setup' | 'upgrade' | 'copy' | 'terminate';

/**
 * lists the actions for one workstation, named after its recorded drivers
 * @param dependencies the registered drivers, the profile defaults
 * @param machine selected workstation and its recorded driver selection
 * @returns menu choices; pairing only when the recorded agent supports it
 */
function workstationActions(
  dependencies: Pick<ApplicationDependencies, 'registry' | 'defaults'>,
  machine: MachineSummary,
): Array<InteractionChoice<WorkstationAction>> {
  const agent =
    dependencies.registry.agents[
      machine.profile?.agent ?? dependencies.defaults.selection.agent
    ];

  const pairing: Array<InteractionChoice<WorkstationAction>> =
    agent.supportsPairing
      ? [
          {
            label: `Pair another ${agent.displayName} client`,
            value: 'pair',
            description: `Add a new pairing code to the ${agent.displayName} URL, valid for 5 minutes`,
          },
        ]
      : [];

  return [
    { label: 'Show details', value: 'details' },
    ...pairing,
    {
      label: 'Inspect workstation',
      value: 'inspect',
      description:
        'Check live services, routing and native harnesses; may wake the workstation',
    },
    {
      label: 'Configure a section',
      value: 'setup',
      description:
        'Choose plugins, network, proxy, Git, tools or another setup area',
    },
    {
      label: 'Upgrade tools',
      value: 'upgrade',
      description:
        'Choose managed tools to upgrade now and whether to restart the services still running older ones',
    },
    { label: `Copy ${agent.displayName} URL`, value: 'copy' },
    { label: 'Permanently terminate', value: 'terminate' },
  ];
}

/**
 * presents explicit actions after showing a control-plane machine summary
 * @param dependencies the registered drivers, the profile defaults, the guest mechanics, what this computer provides
 * @param params the call's inputs: request, provider, interaction
 * @returns the selected action's structured result
 */
export async function chooseWorkstationAction(
  dependencies: ApplicationDependencies,
  params: InteractiveWorkstationCommandParams,
): Promise<CommandResult> {
  const { request, provider, interaction } = params;
  let requestedMachine = request.machine;
  for (;;) {
    const workstation = await selectManagedMachine(dependencies, {
      provider,
      requestedName: requestedMachine,
      interaction,
      release: 'metadata',
    });
    const machine = summarizeMachine(dependencies, workstation);
    checkOperation();
    interaction.status({
      kind: 'info',
      message: `${machine.name} (${machine.id}) · ${machine.state}`,
    });
    const result = await chooseMachineAction(dependencies, {
      request,
      machine,
      agentUrl: workstation.url,
      provider,
      interaction,
    });
    if (result) {
      return result;
    }
    requestedMachine = undefined;
  }
}

/**
 * keeps pre-mutation action navigation within the selected workstation
 * @param dependencies the registered drivers, the profile defaults, the guest mechanics, what this computer provides
 * @param context original request, machine summary, provider and active prompts
 * @returns final action result or back to the machine list
 */
async function chooseMachineAction(
  dependencies: ApplicationDependencies,
  context: WorkstationActionContext,
): Promise<CommandResult | undefined> {
  const { request, machine, interaction } = context;
  const menu = withBackNavigation(interaction, 'back to workstation list');
  for (;;) {
    const action = await returnOnBack(async () =>
      menu.select(
        { message: 'Workstation action' },
        workstationActions(dependencies, machine),
      ),
    );
    if (!action) {
      return undefined;
    }
    const result = await returnOnBack(async () =>
      applyWorkstationAction(dependencies, action, {
        ...context,
        request: { ...request, machine: machine.name },
      }),
    );
    if (result) {
      return result;
    }
  }
}

/**
 * dispatches an explicitly selected action with a safe parent destination
 * @param dependencies the registered drivers, the profile defaults, the guest mechanics, what this computer provides
 * @param action selected task identity
 * @param context exact request, live summary, provider and prompts
 * @returns the selected task result
 */
async function applyWorkstationAction(
  dependencies: ApplicationDependencies,
  action: WorkstationAction,
  context: WorkstationActionContext,
): Promise<CommandResult> {
  const { request, machine, agentUrl, provider, interaction } = context;
  const nested = withBackNavigation(interaction, 'back to actions');
  const actionRequest = menuActionRequest(request);
  currentOperation()?.select(actionCommand(action));
  try {
    if (action === 'setup' || action === 'upgrade' || action === 'terminate') {
      return await runMenuCommand(dependencies, action, {
        request: actionRequest,
        provider,
        interaction: nested,
      });
    }
    if (action === 'copy') {
      return await copyWorkstationUrl(dependencies, machine, agentUrl);
    }

    return await showWorkstation(dependencies, {
      request: {
        ...actionRequest,
        options: {
          ...actionRequest.options,
          withPairCode: action === 'pair',
          inspect: action === 'inspect',
        },
      },
      provider,
      interaction: nested,
    });
  } catch (error) {
    if (error instanceof InteractionExit && error.action === 'back') {
      throw error;
    }

    return {
      command: actionCommand(action),
      ok: false,
      error: {
        ...commandError(error),
        machine: machine.name,
        machineId: machine.id,
      },
    };
  }
}

/**
 * runs the command a mutating menu action stands for; an upgrade asks for
 * its tools and restart, since a menu request carries no upgrade flags
 * @param dependencies the registered drivers, the profile defaults, the guest mechanics, what this computer provides
 * @param command the command the action runs
 * @param params the action's own request, provider and nested prompts
 * @returns the command's result
 */
async function runMenuCommand(
  dependencies: ApplicationDependencies,
  command: Extract<CommandName, 'setup' | 'upgrade' | 'terminate'>,
  params: InteractiveWorkstationCommandParams,
): Promise<CommandResult> {
  const request = { ...params.request, command };
  if (command === 'setup') {
    return setupWorkstation(dependencies, { ...params, request });
  }
  if (command === 'upgrade') {
    return upgradeWorkstation(dependencies, { ...params, request, ask: true });
  }

  return terminateWorkstation(dependencies, { ...params, request });
}

/**
 * sends the provider agent URL to the desktop clipboard
 * @param dependencies what this computer provides
 * @param machine current machine summary
 * @param agentUrl provider URL of the selected workstation, when present
 * @returns the completed local action and machine summary
 */
async function copyWorkstationUrl(
  dependencies: Pick<ApplicationDependencies, 'host'>,
  machine: MachineSummary,
  agentUrl: string | undefined,
): Promise<CommandResult> {
  if (!agentUrl) {
    throw new CommandFault({
      code: 'PROVIDER',
      message: 'Workstation has no provider agent URL',
    });
  }
  await dependencies.host.clipboard.copyUrl(agentUrl);

  return { command: 'show', ok: true, data: { machine, action: 'copy' } };
}

/**
 * clears outer consent before executing an independently selected menu action
 * @param request outer show invocation and exact selected machine
 * @returns action request requiring its own consent
 */
function menuActionRequest(request: CommandRequest): CommandRequest {
  return {
    ...request,
    options: {
      ...request.options,
      yes: false,
      withPairCode: false,
      inspect: false,
    },
  };
}

/**
 * identifies the command selected by a workstation action
 * @param action selected menu action
 * @returns actual command identity
 */
function actionCommand(action: WorkstationAction): CommandName {
  return action === 'setup' || action === 'upgrade' || action === 'terminate'
    ? action
    : 'show';
}
