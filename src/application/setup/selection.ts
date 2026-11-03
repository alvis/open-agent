import {
  hasExplicitPluginActions,
  normalizePluginOptions,
} from '#application/plugins';

import type { CommandOptions, SetupSection } from '#application/contracts';
import type {
  Interaction,
  InteractionChoice,
} from '#application/ports/interaction';

const SETUP_SECTIONS: Array<InteractionChoice<SetupSection>> = [
  {
    value: 'agent',
    label: 'ACP agent',
    description:
      'Configure the agent service; pair via the workstation action menu',
  },
  {
    value: 'network',
    label: 'Network',
    description: 'Workstation networking',
  },
  {
    value: 'github',
    label: 'GitHub authentication',
    description: 'Configure the native GitHub CLI credential',
  },
  {
    value: 'git',
    label: 'Git / Jujutsu identity',
    description: 'Configure author and committer names and emails',
  },
  {
    value: 'env',
    label: 'Environment variables',
    description: 'Configure variables for the agent and every shell',
  },
  {
    value: 'system',
    label: 'Setup file',
    description: 'Run an executable once as root for system-wide settings',
  },
  {
    value: 'plugins',
    label: 'Native plugins',
    description: 'Manage harness marketplaces and plugins',
  },
  {
    value: 'tools',
    label: 'Managed tools',
    description: 'View recorded versions or explicitly update tools in place',
  },
  {
    value: 'all',
    label: 'Full setup / recovery',
    description: 'Update tools and configure every section',
  },
];

/**
 * selects a setup section from flags or an inline prompt
 * @param options parsed setup options
 * @param interaction optional inline prompts
 * @returns the requested section
 */
export async function selectSetupSection(
  options: CommandOptions,
  interaction?: Interaction,
): Promise<SetupSection> {
  const explicitPlugins = hasExplicitPluginActions(
    normalizePluginOptions(options),
  );
  if (explicitPlugins && options.section && options.section !== 'plugins') {
    throw new Error(
      'Explicit plugin actions conflict with the selected setup section',
    );
  }
  if (options.section) {
    return options.section;
  }
  if (options.withPairCode) {
    return 'agent';
  }
  if (explicitPlugins) {
    return 'plugins';
  }
  if (options.setupFile) {
    return 'system';
  }
  if (options.envFile) {
    return 'env';
  }
  if (!interaction || options.nonInteractive) {
    throw new Error(
      'Non-interactive setup requires --section or explicit plugin actions',
    );
  }

  return interaction.select(
    { message: 'Choose setup section' },
    SETUP_SECTIONS,
  );
}
