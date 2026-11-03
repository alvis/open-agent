import { buildCommand } from '@stricli/core';

import {
  createDocumentation,
  doctorDocumentation,
  listDocumentation,
  showDocumentation,
} from './documentation';
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
type InspectFlags = ProviderCommonFlags &
  Required<Pick<CommandOptions, 'inspect'>>;

const machinePositional = {
  kind: 'tuple',
  parameters: [
    {
      parse: String,
      brief: 'exact workstation name',
      placeholder: 'workstation',
      optional: true,
    },
  ],
} as const;

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
const showCommand = buildCommand({
  /**
   * executes the selected workstation command
   * @param flags parsed command options
   * @param machine optional exact workstation name
   * @returns completion after final output
   */
  async func(
    this: InvocationContext,
    flags: InspectFlags,
    machine?: string,
  ): Promise<void> {
    return execute({
      dependencies: this.dependencies,
      request: { command: 'show', machine, options: flags },
      state: this.state,
    });
  },
  parameters: {
    flags: {
      inspect: {
        kind: 'boolean',
        default: false,
        brief: 'check live guest services and configuration (may wake it)',
      },
      ...providerFlags,
      ...providerCredentialFlags,
      ...outputFlags,
    },
    positional: machinePositional,
  },
  docs: showDocumentation,
});
const doctorCommand = buildCommand({
  /**
   * executes the selected workstation command
   * @param flags parsed command options
   * @param machine optional exact workstation name
   * @returns completion after final output
   */
  async func(
    this: InvocationContext,
    flags: ProviderCommonFlags,
    machine?: string,
  ): Promise<void> {
    return execute({
      dependencies: this.dependencies,
      request: { command: 'doctor', machine, options: flags },
      state: this.state,
    });
  },
  parameters: {
    flags: { ...providerFlags, ...commonFlags },
    positional: machinePositional,
  },
  docs: doctorDocumentation,
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
  show: withRootUsage(showCommand, '[<workstation>]'),
  doctor: withRootUsage(doctorCommand, '[<workstation>]'),
};
