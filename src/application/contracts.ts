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
  /** source reference of the provider management credential */
  providerTokenSource?: string;
}

/** parsed command and its options */
export interface CommandRequest {
  command: CommandName;
  options: CommandOptions;
}
