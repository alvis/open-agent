import type { CommandName } from '#kernel/commands';

import type { CreateDataOutput, CreateFailureDataOutput } from './create';
import type { ErrorOutput } from './failure';

/** success payload each command reports */
export interface CommandDataOutput {
  create: CreateDataOutput;
}

/** observations each command keeps after failure */
export interface CommandFailureDataOutput {
  create: CreateFailureDataOutput;
}

/** a successful command */
export type SuccessOutput = {
  [Command in CommandName]: {
    command: Command;
    ok: true;
    data: CommandDataOutput[Command];
    error?: never;
  };
}[CommandName];

/** a failed command, including a parser failure with no command */
export type FailureOutput =
  | {
      [Command in CommandName]: {
        command: Command;
        ok: false;
        error: ErrorOutput;
        data?: CommandFailureDataOutput[Command];
      };
    }[CommandName]
  | {
      command: null;
      ok: false;
      error: ErrorOutput;
      data?: never;
    };

/** the contract every command result is projected to before serialization */
export type ResultOutput = SuccessOutput | FailureOutput;
