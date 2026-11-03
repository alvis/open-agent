import type { ProviderDriver } from '#application/ports/drivers';
import type { Interaction } from '#application/ports/interaction';
import type { AgentId, HarnessId, NetworkId, ProviderId } from '#domain/ids';
import type { CommandName } from '#kernel/commands';

/** values parsed from CLI flags; secret-bearing fields contain references, never raw credentials */
export interface CommandOptions {
  /** workstation name, from --name */
  name?: string;
  /** explicit credential dotenv file read before the ambient environment, from --credential-file */
  credentialFile?: string;
  /** selected provider */
  provider?: ProviderId;
  /** selected ACP agent */
  agent?: AgentId;
  /** selected harnesses, from the repeatable --harness */
  harness?: HarnessId[];
  /** selected network */
  network?: NetworkId;
  /** disables every prompt */
  nonInteractive?: boolean;
  /** confirms prompts that would otherwise ask for consent */
  yes?: boolean;
  /** adds a live guest inspection to show */
  inspect?: boolean;
  /** source reference of the provider management credential */
  providerTokenSource?: string;
}

/** parsed command and its optional machine selection */
export interface CommandRequest {
  command: CommandName;
  machine?: string;
  options: CommandOptions;
}

/** the request, the provider it targets and the optional interaction one workstation command acts with */
export interface WorkstationCommandParams<Provider = ProviderDriver> {
  /** parsed command, options and optional machine selection */
  request: CommandRequest;
  /** the provider the command targets, authenticated unless a credential is still being resolved */
  provider: Provider;
  /** optional prompts, status and progress boundary */
  interaction?: Interaction;
}
