import { describe, expect, it } from 'vitest';

import { humanResultDetails } from '#cli/output/details';

// The inspection payload can contain incomplete observations from the guest.
describe('fn:humanResultDetails', () => {
  it('should omit absent inspection sections and present the agent environment separately', () => {
    const result = humanResultDetails({
      inspection: {
        native: {
          claude: { available: false },
          agentEnvironment: { ok: false },
        },
        environment: { profile: { options: {} } },
      },
    });

    expect(result.inspection).toMatchObject({
      'Claude Code': { available: false },
      'Agent environment': { verified: false },
      'Installed tools': undefined,
      'services': undefined,
    });
  });

  it('should skip unnamed tool records and list each tool by its source', () => {
    const result = humanResultDetails({
      inspection: {
        environment: {
          tools: [
            { source: { kind: 'npm' } },
            { name: 'claude', source: { kind: 'npm' } },
          ],
          setup: {
            skipped: [
              { reason: 'unidentified' },
              { name: 'optional', reason: 'no bottle' },
            ],
          },
        },
      },
    });

    expect(result.inspection).toMatchObject({
      'Installed tools': { claude: 'npm' },
      'Skipped tools': { optional: 'no bottle' },
    });
  });
});
