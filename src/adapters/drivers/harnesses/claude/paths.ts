import { AGENT_HOME } from '#adapters/guest/platform/layout';

/** Claude Code user settings, including environment */
export const CLAUDE_SETTINGS = `${AGENT_HOME}/.claude/settings.json`;

/** Claude Code configuration directory */
export const CLAUDE_CONFIG_DIR = `${AGENT_HOME}/.claude`;

/** environment the ACP agent passes when spawning Claude Code */
export const CLAUDE_SPAWN_ENVIRONMENT: Readonly<Record<string, string>> = {
  CLAUDE_CONFIG_DIR,
};
