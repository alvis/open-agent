import { commandError } from '#application/failures';
import { requireWorkstationUrl } from '#application/machine';
import {
  ReadinessFault,
  assessReadiness,
  servedVersionMismatch,
} from '#application/readiness';
import { inspectUntilServing } from '#application/serving';
import { agentPort } from '#domain/services';
import {
  cancellationReason,
  checkOperation,
  currentOperation,
} from '#kernel/operation';
import { OPEN_AGENT_VERSION } from '#kernel/version';

import { configureNewWorkstation } from './configuration';
import { createResult } from './outcome';

import type { ApplicationDependencies } from '#application/ports/dependencies';
import type { Interaction } from '#application/ports/interaction';
import type { SetupSession } from '#application/ports/session';
import type { CommandResult } from '#application/result';
import type { GuestInspection } from '#domain/observations/inspection';
import type { WorkstationRecord } from '#domain/workstation';

import type { CreateContext } from './context';

interface CreateFinalizationContext {
  workstation: WorkstationRecord;
  observed: GuestInspection;
  context: CreateContext;
  interaction?: Interaction;
}

/** the named inputs of finish create */
export interface FinishCreateParams {
  /** exact newly created provider workstation */
  workstation: WorkstationRecord;
  /** inputs confirmed before creation */
  context: CreateContext;
  /** optional progress boundary */
  interaction?: Interaction;
}

/**
 * configure, verify and expose one newly created private workstation
 * @param dependencies the registered drivers, the guest mechanics
 * @param params the call's inputs: workstation, context, interaction
 * @returns ready machine and current non-secret guest evidence
 */
export async function finishCreate(
  dependencies: Pick<ApplicationDependencies, 'registry' | 'guest'>,
  params: FinishCreateParams,
): Promise<CommandResult> {
  const { workstation, context, interaction } = params;
  checkOperation();
  const connection = dependencies.guest.session.connect({
    provider: context.provider,
    workstation,
  });
  try {
    return await configureAndFinalize(dependencies, {
      workstation,
      context,
      connection,
      interaction,
    });
  } finally {
    await connection.close();
  }
}

/** the named inputs of configure and finalize */
interface ConfigureAndFinalizeParams {
  /** exact newly created provider workstation */
  workstation: WorkstationRecord;
  /** inputs confirmed before creation */
  context: CreateContext;
  /** the workstation's root setup session */
  connection: SetupSession;
  /** optional progress boundary */
  interaction?: Interaction;
}

/**
 * installs and configures the workstation over its setup session, waits for
 * the agent to serve, then verifies and exposes it
 * @param dependencies the registered drivers, the guest mechanics
 * @param params the call's inputs: workstation, context, connection, interaction
 * @returns ready machine and current non-secret guest evidence
 */
async function configureAndFinalize(
  dependencies: Pick<ApplicationDependencies, 'registry' | 'guest'>,
  params: ConfigureAndFinalizeParams,
): Promise<CommandResult> {
  const { workstation, context } = params;
  const { interaction } = params;
  const guest = await configureNewWorkstation(dependencies, {
    connection: params.connection,
    interaction,
    configuration: {
      hostname: workstation.name,
      profile: context.input.profile,
    },
  });
  const observed = await inspectUntilServing(
    async () =>
      dependencies.guest.native.inspectAgentEnvironment(
        guest,
        context.input.profile.agent,
      ),
    async () => dependencies.guest.inspection.inspect(guest),
  );

  return finalizeCreate(dependencies, {
    workstation,
    observed,
    context,
    interaction,
  });
}

/**
 * verifies and exposes a configured workstation
 * @param dependencies the registered drivers
 * @param finalization real workstation, fresh guest inspection, and create inputs
 * @returns ready machine or a retained ready failure
 */
export async function finalizeCreate(
  dependencies: Pick<ApplicationDependencies, 'registry'>,
  finalization: CreateFinalizationContext,
): Promise<CommandResult> {
  const { workstation, observed, context } = finalization;
  assertCreateReadiness(dependencies, observed);
  requireWorkstationUrl(workstation);
  await context.provider.expose(
    workstation,
    agentPort(dependencies.registry, context.input.profile.agent),
    'public',
  );
  const ready = await context.provider.setMetadata(workstation, {
    setup: 'ready',
    version: OPEN_AGENT_VERSION,
  });

  return finishReadyCreate(dependencies, {
    ...finalization,
    workstation: ready,
  });
}

/**
 * keeps cancellation after the confirmed READY boundary
 * @param dependencies the registered drivers
 * @param ready workstation returned by the fulfilled READY metadata update and inputs
 * @returns ready result or a retained ready cancellation/failure
 */
async function finishReadyCreate(
  dependencies: Pick<ApplicationDependencies, 'registry'>,
  ready: CreateFinalizationContext,
): Promise<CommandResult> {
  const { workstation, observed, context, interaction } = ready;
  try {
    checkOperation();
    interaction?.progress({
      stage: 'complete',
      message: `Workstation ${context.name} is ready`,
    });
    const result = createResult(dependencies, {
      workstation,
      observed,
      preflight: context.preflight,
    });
    checkOperation();

    return result;
  } catch (error) {
    return readyCreateFailure(dependencies, ready, error);
  }
}

/**
 * records an error after READY without demoting the retained machine
 * @param dependencies the registered drivers
 * @param ready confirmed READY workstation and inputs
 * @param error cancellation or result failure
 * @returns typed retained ready failure with machine identity
 */
function readyCreateFailure(
  dependencies: Pick<ApplicationDependencies, 'registry'>,
  ready: CreateFinalizationContext,
  error: unknown,
): CommandResult {
  const { workstation, observed, context } = ready;
  const failure = commandError(readyError(error));

  return {
    command: 'create',
    ok: false,
    data: {
      preflight: context.preflight,
      readiness: assessReadiness(dependencies, observed),
      setup: 'ready',
    },
    error: {
      ...failure,
      outcome: 'retained',
      machine: workstation.name,
      machineId: workstation.id,
      details: [
        ...(failure.details ?? []),
        'The workstation is ready; setup was not demoted.',
      ],
    },
  };
}

/**
 * uses the invocation signal when a concurrent abort raced a result failure
 * @param error result failure
 * @returns cancellation when the invocation has aborted, otherwise the failure
 */
function readyError(error: unknown): unknown {
  return currentOperation()?.signal.aborted ? cancellationReason() : error;
}

/**
 * withholds public exposure unless every current gate passes and the agent
 * serves the version installed
 * @param dependencies the registered drivers
 * @param observed fresh guest inspection
 * @throws {ReadinessFault} when a gate fails or the agent serves another version than the one installed
 */
function assertCreateReadiness(
  dependencies: Pick<ApplicationDependencies, 'registry'>,
  observed: GuestInspection,
): void {
  const readiness = assessReadiness(dependencies, observed);
  const { failures } = readiness;
  const mismatch = servedVersionMismatch(dependencies, observed);
  if (mismatch) {
    failures.push(mismatch);
  }
  if (failures.length) {
    throw new ReadinessFault({ ...readiness, ready: false });
  }
}
