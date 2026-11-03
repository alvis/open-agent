import type { CommandOptions } from '#application/contracts';
import type {
  Interaction,
  InteractionChoice,
} from '#application/ports/interaction';

import type { InputSources } from '../sources';

/** what a selection is resolved from */
export interface SelectionContext {
  /** parsed flags */
  options: CommandOptions;
  /** process, dotenv and profile values */
  sources: InputSources;
  /** inline prompts; absent in non-interactive runs */
  interaction?: Interaction;
}

/** how one step reads its sources before prompting or defaulting */
interface StepSources {
  /** explicit flag value */
  flag?: string;
  /** environment variable read from the process, then the selected credential file; none when only the flag applies */
  environment?: string;
}

/** precedence-aware reader of flag, credential file and process environment values */
interface EnvironmentReader {
  /**
   * reads one driver id
   * @param step flag and environment variable
   * @returns the raw id, validated later against the catalog
   */
  choice(step: StepSources): string | undefined;
  /**
   * reads a comma-separated list
   * @param environment environment variable
   * @returns the trimmed entries
   */
  list(environment: string): string[] | undefined;
}

/**
 * reads flag, credential file, then process environment values in that order
 * @param sources process and credential file values
 * @param scope whether environment values apply to this run
 * @param scope.isEnabled false when only flags apply
 * @returns accessors for ids and lists
 */
export function environmentReader(
  sources: InputSources,
  scope: { isEnabled: boolean } = { isEnabled: true },
): EnvironmentReader {
  const raw = (environment: string | undefined): string | undefined =>
    scope.isEnabled && environment !== undefined
      ? [sources.fileEnv[environment], sources.processEnv[environment]]
          .map((value) => value?.trim())
          .find((value) => Boolean(value))
      : undefined;

  return {
    choice: ({ flag, environment }) => flag ?? raw(environment),
    list: (environment) =>
      raw(environment)
        ?.split(',')
        .map((entry) => entry.trim())
        .filter(Boolean),
  };
}

/** prompts that skip a step with only one choice */
export interface Prompts {
  /**
   * asks for one of several choices
   * @param message prompt label
   * @param choices catalog entries in display order, default first
   * @returns the chosen id, or undefined when only one choice exists
   */
  choose<V extends string>(
    message: string,
    choices: ReadonlyArray<InteractionChoice<V>>,
  ): Promise<V | undefined>;
  /**
   * asks for one or more of several choices
   * @param message prompt label
   * @param choices catalog entries, preselected where they are the default
   * @returns the chosen ids, or undefined when only one choice exists
   */
  chooseMany<V extends string>(
    message: string,
    choices: ReadonlyArray<InteractionChoice<V>>,
  ): Promise<V[] | undefined>;
}

/**
 * binds the selection prompts when the run may prompt
 * @param context flags and optional interaction
 * @returns the prompts, or undefined in non-interactive runs
 */
export function activePrompts(context: SelectionContext): Prompts | undefined {
  const { interaction, options } = context;
  if (!interaction || options.nonInteractive || options.yes) {
    return undefined;
  }

  return {
    choose: async (message, choices) =>
      choices.length > 1 ? interaction.select({ message }, choices) : undefined,
    chooseMany: async (message, choices) =>
      choices.length > 1
        ? interaction.multiselect({ message }, choices)
        : undefined,
  };
}
