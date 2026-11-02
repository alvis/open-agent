import { describe, expect, it } from 'vitest';

import { humanResultDetails } from '#cli/output/details';

describe('fn:humanResultDetails', () => {
  it('should omit the agent URL from the result and its workstation', () => {
    const result = humanResultDetails({
      agentUrl: 'https://primary.sprites.app/',
      machine: { name: 'primary', agentUrl: 'https://primary.sprites.app/' },
      network: { online: false },
    });

    expect(result).toEqual({
      machine: { name: 'primary' },
      network: { online: false },
    });
  });
});
