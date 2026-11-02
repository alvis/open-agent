import { NO_NETWORK } from '#domain/ids';

import type { ProfileDefaults } from '#domain/profile';

/** drivers and options chosen when nothing else chooses them; reproduces today's workstation */
export const defaults = {
  selection: {
    provider: 'sprite',
    agent: 't3',
    harnesses: ['claude'],
    network: NO_NETWORK,
  },
  options: {
    idleTimeoutMinutes: 5,
    holdMaxMinutes: 60,
  },
} as const satisfies ProfileDefaults;
