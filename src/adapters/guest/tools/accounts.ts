import { AGENT_HOME, LINUXBREW_HOME } from '#adapters/guest/platform/layout';

import type { ToolOwner } from '#domain/tools';

/** where every tool owner's commands start, its home */
export const OWNER_HOMES: Readonly<Record<ToolOwner, string>> = {
  root: '/root',
  linuxbrew: LINUXBREW_HOME,
  agent: AGENT_HOME,
};
