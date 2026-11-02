import { projectRetainedCredentials } from './credentials';
import { projectFields, same } from './fields';
import { projectMachine } from './machine';
import { projectReadiness } from './readiness';

import type {
  AllSetupData,
  AppliedSetupSection,
  CommandFailureData,
  NetworkSetupData,
  SetupData,
} from '#application/data';

import type { MachineSummary } from '#application/machine';
import type { CredentialSaveResult } from '#domain/credentials';

import type { RetainedCredentialsOutput } from './credentials';
import type { MachineOutput } from './machine';
import type { ReadinessOutput } from './readiness';

/** the outcome of a setup section, or of replacing the local credential */
export interface SetupDataOutput {
  section?: string;
  machine?: MachineOutput;
  retainedCredentials?: RetainedCredentialsOutput;
  service?: 'configured';
  network?: { status: 'disabled'; readiness: 'skipped' };
}

/** what a failed setup still observed */
export interface SetupFailureDataOutput {
  readiness?: ReadinessOutput;
  recovery?: { incompleteLabel: 'confirmed' | 'unconfirmed' };
}

type SetupFields = Partial<
  AllSetupData & {
    section: AppliedSetupSection['section'];
    machine: MachineSummary;
    retainedCredentials: Partial<Record<string, CredentialSaveResult>>;
  }
>;

/**
 * projects the network setup outcome
 * @param network internal outcome
 * @returns output outcome
 */
function projectNetworkOutcome(
  network: NetworkSetupData['network'],
): NonNullable<SetupDataOutput['network']> {
  return projectFields<typeof network, NonNullable<SetupDataOutput['network']>>(
    network,
    { status: same, readiness: same },
  );
}

/**
 * projects a setup outcome
 * @param data internal outcome, for one section or for the local credential
 * @returns output outcome
 */
export function projectSetup(data: SetupData): SetupDataOutput {
  return projectFields<SetupFields, SetupDataOutput>(data, {
    section: same,
    machine: projectMachine,
    retainedCredentials: projectRetainedCredentials,
    service: same,
    network: projectNetworkOutcome,
  });
}

/**
 * projects what a failed setup still observed
 * @param data internal failure observations
 * @returns output failure observations
 */
export function projectSetupFailure(
  data: CommandFailureData['setup'],
): SetupFailureDataOutput {
  return projectFields<CommandFailureData['setup'], SetupFailureDataOutput>(
    data,
    {
      readiness: projectReadiness,
      recovery: (recovery) =>
        projectFields<
          typeof recovery,
          NonNullable<SetupFailureDataOutput['recovery']>
        >(recovery, { incompleteLabel: same }),
    },
  );
}
