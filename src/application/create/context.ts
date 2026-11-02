import type { CommandOptions } from '#application/contracts';
import type { ResolvedInputs } from '#application/input/types';
import type { ProviderDriver } from '#application/ports/drivers';
import type { CommandResult } from '#application/result';

/** verified caller-side checks and actionable guest-readiness reminders */
export interface CreatePreflight {
  checks: string[];
  reminders: string[];
}

/** values confirmed before any workstation creation attempt */
export interface CreateContext {
  options: CommandOptions;
  input: ResolvedInputs;
  name: string;
  token: string;
  preflight: CreatePreflight;
  provider: ProviderDriver;
}

/** result of preflight before a provider resource exists */
export type CreatePreparation =
  | { kind: 'ready'; context: CreateContext }
  | { kind: 'result'; result: CommandResult };
