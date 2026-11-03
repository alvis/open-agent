import { buildCommand } from '@stricli/core';

import { createDocumentation, listDocumentation } from './documentation';
import { execute } from './execution';
import {
  commonFlags,
  consentFlags,
  outputFlags,
  providerCredentialFlags,
  providerFlags,
  selectionFlags,
} from './flags';

import type { Command } from '@stricli/core';

import type { CommandOptions } from '#application/contracts';

import type { InvocationContext } from './parser';

type BooleanKeys<T> = {
  [K in keyof T]-?: NonNullable<T[K]> extends boolean ? K : never;
}[keyof T];
type RequiredBooleanFields<T> = Omit<T, BooleanKeys<T>> &
  Required<Pick<T, BooleanKeys<T>>>;
type FlagsFor<T> = RequiredBooleanFields<
  Pick<CommandOptions, Extract<keyof T, keyof CommandOptions>>
>;
type CommonFlags = FlagsFor<typeof commonFlags>;
type ProviderCommonFlags = CommonFlags & FlagsFor<typeof providerFlags>;
type ConfigurationFlags = FlagsFor<
  typeof consentFlags &
    typeof selectionFlags &
    typeof providerCredentialFlags &
    typeof outputFlags
>;
type CreateFlags = ConfigurationFlags & Pick<CommandOptions, 'name'>;

const createCommand = buildCommand({
  /**
   * executes parsed flags with invocation-local output ownership
   * @param flags parsed command options
   * @returns completion after final output
   */
  async func(this: InvocationContext, flags: CreateFlags): Promise<void> {
    return execute({
      dependencies: this.dependencies,
      request: {
        command: 'create',
        options: flags,
      },
      state: this.state,
    });
  },
  parameters: {
    flags: {
      name: {
        kind: 'parsed',
        parse: String,
        optional: true,
        placeholder: 'NAME',
        brief: 'NAME · new workstation name',
      },
      ...consentFlags,
      ...selectionFlags,
      ...providerCredentialFlags,
      ...outputFlags,
    },
  },
  docs: createDocumentation,
});
const listCommand = buildCommand({
  /**
   * executes parsed flags with invocation-local output ownership
   * @param flags parsed command options
   * @returns completion after final output
   */
  async func(
    this: InvocationContext,
    flags: ProviderCommonFlags,
  ): Promise<void> {
    return execute({
      dependencies: this.dependencies,
      request: { command: 'list', options: flags },
      state: this.state,
    });
  },
  parameters: { flags: { ...providerFlags, ...commonFlags } },
  docs: listDocumentation,
});
/**
 * keeps root route usage concise while naming optional workstation selection
 * @param command built command and its supported usage formatter
 * @param optional one optional usage fragment for the root route table
 * @returns equivalent command with concise root usage
 */
function withRootUsage(
  command: Command<InvocationContext>,
  optional: string,
): Command<InvocationContext> {
  return {
    ...command,
    formatUsageLine: (args) => `${command.formatUsageLine(args)} ${optional}`,
  };
}

export const commandRoutes = {
  create: withRootUsage(createCommand, '[--name NAME]'),
  list: listCommand,
};
