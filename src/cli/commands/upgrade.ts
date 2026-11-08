import { buildCommand } from '@stricli/core';

import { upgradeDocumentation } from '#cli/documentation';
import { execute } from '#cli/execution';
import { commonFlags, providerFlags } from '#cli/flags';
import { upgradeFlags } from '#cli/flags/upgrade';

import type { FlagsFor, ProviderCommonFlags } from '#cli/commands';
import type { InvocationContext } from '#cli/parser';

/** the options upgrade parses from its flags */
type UpgradeFlags = ProviderCommonFlags & FlagsFor<typeof upgradeFlags>;

/** the workstation, then the tools to upgrade */
type UpgradePositionals = [machine?: string, tools?: string[]];

/** upgrades managed tools and, on request, restarts the services behind them */
export const upgradeCommand = buildCommand({
  /**
   * executes the selected workstation command
   * @param flags parsed command options
   * @param positionals optional exact workstation name, then optional tools to upgrade
   * @returns completion after final output
   */
  async func(
    this: InvocationContext,
    flags: UpgradeFlags,
    ...positionals: UpgradePositionals
  ): Promise<void> {
    const [machine, tools] = positionals;

    return execute({
      dependencies: this.dependencies,
      request: {
        command: 'upgrade',
        machine,
        options: tools ? { ...flags, tools } : flags,
      },
      state: this.state,
    });
  },
  parameters: {
    flags: { ...upgradeFlags, ...providerFlags, ...commonFlags },
    positional: {
      kind: 'tuple',
      parameters: [
        {
          parse: String,
          brief: 'exact workstation name',
          placeholder: 'workstation',
          optional: true,
        },
        {
          parse: parseToolList,
          brief:
            'comma-separated tools to upgrade; every managed tool when omitted',
          placeholder: 'tools',
          optional: true,
        },
      ],
    },
  },
  docs: upgradeDocumentation,
});

/**
 * parses a comma-separated list of tool names, leaving whether the
 * workstation records each to the upgrade
 * @param value positional text, such as `node,bun`
 * @returns the names, each once, in the order given
 * @throws {Error} when a name is empty
 */
function parseToolList(value: string): string[] {
  const names = value.split(',').map((name) => name.trim());
  if (names.some((name) => name === '')) {
    throw new Error(
      `expected comma-separated tool names such as node,bun, got ${JSON.stringify(value)}`,
    );
  }

  return [...new Set(names)];
}
