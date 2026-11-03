import { describe, expect, it } from 'vitest';

import { recordFrom, recordOf } from '#kernel/records';

describe('fn:recordOf', () => {
  it('should hold one built entry per key', () => {
    expect(recordOf(['claude', 'agent'], (key) => key.length)).toEqual({
      claude: 6,
      agent: 5,
    });
  });
});

describe('fn:recordFrom', () => {
  it('should key and value each item by its own derivation', () => {
    expect(
      recordFrom({
        items: ['claude', 'agent'],
        keyOf: (id) => `${id}Plugins` as const,
        valueOf: (id) => id.toUpperCase(),
      }),
    ).toEqual({ claudePlugins: 'CLAUDE', agentPlugins: 'AGENT' });
  });
});
