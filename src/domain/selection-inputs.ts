/** a selection step's flag and the environment variable that mirrors it */
interface SelectionInput {
  /** command-line flag */
  flag: string;
  /** environment variable read from the process, then the selected credential file */
  environment: string;
}

/** the flags and environment variables that select drivers and options */
const SELECTION_INPUTS = {
  provider: { flag: '--provider', environment: 'OPEN_AGENT_PROVIDER' },
  agent: { flag: '--agent', environment: 'OPEN_AGENT_AGENT' },
  agentRelease: { flag: '--release', environment: 'OPEN_AGENT_RELEASE' },
  harnesses: { flag: '--harness', environment: 'OPEN_AGENT_HARNESSES' },
  network: { flag: '--network', environment: 'OPEN_AGENT_NETWORK' },

  idleTimeoutMinutes: {
    flag: '--idle-minutes',
    environment: 'OPEN_AGENT_IDLE_MINUTES',
  },
  holdMaxMinutes: {
    flag: '--hold-max-minutes',
    environment: 'OPEN_AGENT_HOLD_MAX_MINUTES',
  },
  updateDueIntervalDays: {
    flag: '--update-due-days',
    environment: 'OPEN_AGENT_UPDATE_DUE_DAYS',
  },
} as const satisfies Record<string, SelectionInput>;

/** a profile field a caller can select */
export type SelectionField = keyof typeof SELECTION_INPUTS;

/**
 * lists every selection step with the flag and environment variable it reads
 * @returns each selectable field's flag and environment variable
 */
export function selectionInputs(): Record<SelectionField, SelectionInput> {
  return SELECTION_INPUTS;
}

/**
 * names a selectable field the way the caller supplies it
 * @param field selectable profile field whose flag and variable the product fixes
 * @returns the flag followed by its environment variable
 */
export function selectionLabel(field: SelectionField): string {
  return labelOf(SELECTION_INPUTS[field]);
}

/**
 * names a selection step the way the caller supplies it
 * @param input the step's flag and environment variable
 * @param input.flag command-line flag
 * @param input.environment environment variable that mirrors the flag
 * @returns the flag followed by its environment variable
 */
function labelOf({ flag, environment }: SelectionInput): string {
  return `${flag} (${environment})`;
}
