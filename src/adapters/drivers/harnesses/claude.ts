import { configureClaude } from './claude/configure';
import { claudeHooks } from './claude/hooks';
import { claudeReadiness, inspectClaude } from './claude/inspection';
import { CLAUDE_SPAWN_ENVIRONMENT } from './claude/paths';
import { claudePlugins } from './claude/plugins';
import { claudeTool } from './claude/tools';

import type { HarnessDriver } from '#application/ports/drivers';

import type { ClaudeInitialization } from './claude/initialization';

/** Claude Code as a harness driver */
export const claude: HarnessDriver<'claude', ClaudeInitialization | undefined> =
  {
    id: 'claude',
    kind: 'harnesses',
    displayName: 'Claude Code',
    tools: [claudeTool],
    spawnEnvironment: CLAUDE_SPAWN_ENVIRONMENT,
    plugins: claudePlugins,
    hooks: claudeHooks,
    configure: configureClaude,
    inspect: inspectClaude,
    readiness: claudeReadiness,
  };
