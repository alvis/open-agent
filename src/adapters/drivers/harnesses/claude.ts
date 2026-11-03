import { configureClaude } from './claude/configure';
import { inspectClaude } from './claude/inspection';
import { CLAUDE_SPAWN_ENVIRONMENT } from './claude/paths';
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
    configure: configureClaude,
    inspect: inspectClaude,
  };
