import type { ProviderDriver } from '#application/ports/drivers';
import type { Interaction } from '#application/ports/interaction';
import type { AgentId, HarnessId, NetworkId, ProviderId } from '#domain/ids';
import type { CommandName } from '#kernel/commands';

/** targetable setup areas */
export type SetupSection = 'all' | 'agent' | 'network';

/** values parsed from CLI flags; secret-bearing fields contain references, never raw credentials */
export interface CommandOptions {
  /** workstation name, from --name */
  name?: string;
  /** explicit credential dotenv file read before the ambient environment, from --credential-file */
  credentialFile?: string;
  /** setup section to configure */
  section?: SetupSection;
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
  /** prints one JSON result instead of human output */
  json?: boolean;
  /** confirms prompts that would otherwise ask for consent */
  yes?: boolean;
  /** enables or disables color regardless of the terminal */
  color?: boolean;
  /** shows detailed status */
  verbose?: boolean;
  /** hides routine status and progress */
  quiet?: boolean;
  /** reads and saves credentials on this computer when enabled */
  localCredentials?: boolean;
  /** requests a pairing code from an agent that supports pairing */
  withPairCode?: boolean;
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
