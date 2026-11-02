import { harnessPluginOptions } from '#cli/flags/harness';

import type { CommandOptions } from '#application/contracts';
import type { HarnessPluginFlagValues } from '#cli/flags/harness';

/**
 * builds command options from per-harness plugin flags as the CLI parses them
 * @param values ordinary options and per-harness plugin flag values
 * @returns options carrying the per-harness selections
 */
export function pluginFlags(
  values: Omit<CommandOptions, 'harnessPlugins'> & HarnessPluginFlagValues,
): CommandOptions {
  const {
    claudePlugins,
    claudeMarketplace,
    claudePlugin,
    removeClaudeMarketplace,
    disableClaudePlugin,
    uninstallClaudePlugin,
    ...options
  } = values;
  const harnessPlugins = harnessPluginOptions({
    claudePlugins,
    claudeMarketplace,
    claudePlugin,
    removeClaudeMarketplace,
    disableClaudePlugin,
    uninstallClaudePlugin,
  });

  return { ...options, harnessPlugins };
}
