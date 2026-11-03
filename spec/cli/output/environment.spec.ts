import { describe, expect, it } from 'vitest';

import { projectEnvironment } from '#cli/output/environment';

import { environmentOf } from '../../fixtures/environment';
import { DISABLED_NETWORK_PROFILE } from '../../fixtures/profile';

import type { GuestEnvironment } from '#domain/observations/environment';

describe('fn:projectEnvironment', () => {
  it('should retain a selected harness adapter and scheduled job', () => {
    const base = environmentOf(DISABLED_NETWORK_PROFILE);
    const launchFacts: Pick<GuestEnvironment, 'agent' | 'jobs'> = {
      agent: {
        ...base.agent,
        harnesses: [
          {
            id: 'claude',
            environment: { CLAUDE_CONFIG_DIR: '/home/agent/.claude' },
            adapter: {
              tool: 'claude-acp',
              launch: {
                program: 'claude-acp',
                arguments: ['serve'],
                account: 'agent',
                environment: { CLAUDE_CONFIG_DIR: '/home/agent/.claude' },
              },
            },
          },
          { id: 'codex', environment: { CODEX_HOME: '/home/agent/.codex' } },
        ],
      },
      jobs: [
        {
          name: 'update-gate',
          everyMinutes: 60,
          run: {
            command: '/opt/open-agent/maintenance/update-gate.sh',
            arguments: [],
            account: 'root',
          },
        },
      ],
    };
    const environment = environmentOf(DISABLED_NETWORK_PROFILE, launchFacts);

    expect(projectEnvironment(environment)).toEqual({
      ...base,
      ...launchFacts,
    });
  });
});
