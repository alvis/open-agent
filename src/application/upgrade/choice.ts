import { InteractionExit } from '#kernel/navigation';

import type { CommandOptions } from '#application/contracts';
import type { Interaction } from '#application/ports/interaction';

/** the tools and the restart an interactive upgrade was asked for */
export type UpgradeChoice = Pick<CommandOptions, 'tools' | 'restart' | 'force'>;

/** what the upgrade questions offer */
export interface UpgradeQuestions {
  /** the tools the workstation records, every one chosen at first */
  recorded: readonly string[];
  /** how long the agent waits for an idle turn, such as `30 min` */
  wait: string;
}

/** how the services still running an older tool restart */
type RestartMode = 'none' | 'idle' | 'force';

/**
 * asks which recorded tools to upgrade and whether to restart the services
 * still running an older tool
 * @param interaction the prompts, whose back navigation leaves the upgrade
 * @param questions the recorded tools and the agent's idle wait
 * @returns the chosen tools, absent while every tool stays chosen, and the restart
 * @throws {InteractionExit} back when no tool is chosen, since nothing would be upgraded
 */
export async function chooseUpgrade(
  interaction: Interaction,
  questions: UpgradeQuestions,
): Promise<UpgradeChoice> {
  const { recorded, wait } = questions;
  const tools = await interaction.multiselect(
    {
      message: 'Tools to upgrade',
      description:
        'Every managed tool starts chosen; an upgraded tool takes effect once its service restarts',
    },
    recorded.map((name) => ({ label: name, value: name, isPreselected: true })),
  );
  if (tools.length === 0) {
    throw new InteractionExit('back');
  }
  const mode = await interaction.select<RestartMode>(
    { message: 'Restart the services still running an older tool?' },
    [
      {
        value: 'none',
        label: 'Leave services running',
        description: 'Each service keeps its older tool until it next restarts',
      },
      {
        value: 'idle',
        label: 'Restart once no agent turn is in flight',
        description: `The network daemon restarts at once; the agent waits for its turns to finish, up to ${wait}`,
      },
      {
        value: 'force',
        label: 'Restart now',
        description:
          'Restarts the agent at once, cutting short any turn in flight',
      },
    ],
  );

  return {
    ...(tools.length < recorded.length ? { tools } : {}),
    restart: mode !== 'none',
    force: mode === 'force',
  };
}
