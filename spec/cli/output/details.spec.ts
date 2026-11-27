import { describe, expect, it } from 'vitest';

import { humanResultDetails } from '#cli/output/details';

// The inspection payload can contain incomplete observations from the guest.
describe('fn:humanResultDetails', () => {
  it('should preserve an incomplete machine size instead of inventing dimensions', () => {
    const machine = { machine: { label: 'observed', cpus: 2 } };

    expect(humanResultDetails({ machine })).toEqual({ machine });
  });

  it('should omit absent inspection sections and present the agent environment separately', () => {
    const result = humanResultDetails({
      inspection: {
        native: {
          claude: { available: false },
          agentEnvironment: { ok: false },
        },
        environment: { profile: { options: { minCpus: 2 } } },
        boot: { unsuccessfulSteps: { bootstrap: 'failed' } },
        updates: {},
      },
    });

    expect(result.inspection).toMatchObject({
      'Claude Code': { available: false },
      'Agent environment': { verified: false },
      'Machine requirement': undefined,
      'Installed tools': undefined,
      'services': undefined,
      'Maintenance': { failedTools: undefined },
      'Last boot': {
        status: 'not recorded',
        unsuccessfulSteps: { bootstrap: 'failed' },
      },
    });
  });

  it('should skip unnamed tool records and use only string versions from update observations', () => {
    const result = humanResultDetails({
      inspection: {
        environment: {
          tools: [
            { source: { kind: 'npm' } },
            { name: 'codex', source: { kind: 'npm' } },
          ],
          setup: {
            skipped: [
              { reason: 'unidentified' },
              { name: 'optional', reason: 'no bottle' },
            ],
          },
        },
        updates: {
          tools: [
            { to: 'unidentified' },
            { name: 'codex', to: 1 },
            { name: 'codex', to: '1.2.3\nextra output' },
          ],
        },
      },
    });

    expect(result.inspection).toMatchObject({
      'Installed tools': { codex: '1.2.3' },
      'Skipped tools': { optional: 'no bottle' },
    });
  });

  it("should show each upgraded tool's version, or its change, in one column", () => {
    const result = humanResultDetails({
      tools: [
        {
          name: 't3',
          manager: 'npm',
          required: true,
          outcome: 'installed',
          from: '0.1.12',
          to: '0.1.13\nextra output',
        },
        {
          name: 'curl',
          manager: 'system',
          required: true,
          outcome: 'skipped',
          from: '8.18.0',
          to: '8.18.0',
          reason: 'it is current',
        },
        { name: 'wget', outcome: 'installed', to: '1.25.0' },
        { name: 'jq', outcome: 'failed', reason: 'no bottle' },
        { name: 'gh', outcome: 'failed', from: '2.106.0', to: null },
        null,
      ],
    });

    expect(result.tools).toEqual([
      {
        name: 't3',
        manager: 'npm',
        required: true,
        outcome: 'installed',
        version: '0.1.12 → 0.1.13',
      },
      {
        name: 'curl',
        manager: 'system',
        required: true,
        outcome: 'skipped',
        version: '8.18.0',
        reason: 'it is current',
      },
      { name: 'wget', outcome: 'installed', version: '1.25.0' },
      { name: 'jq', outcome: 'failed', reason: 'no bottle' },
      { name: 'gh', outcome: 'failed', version: '2.106.0 → ?' },
      null,
    ]);
  });

  it("should leave a setup's tools outcome, which is no list, as it is", () => {
    const tools = { status: 'installed', tools: [{ name: 'gh' }] };

    expect(humanResultDetails({ tools })).toEqual({ tools });
  });

  it.each([
    { governor: { recorded: false }, expected: /not recorded.*unavailable/u },
    {
      governor: { recorded: true, state: {} },
      expected: /no heartbeat.*0 open holds/u,
    },
  ])(
    'should describe incomplete governor observations ($expected)',
    ({ governor, expected }) => {
      expect(
        humanResultDetails({ inspection: { governor } }).inspection,
      ).toMatchObject({
        'Idle governor': expect.stringMatching(expected),
      });
    },
  );

  it('should word a storage growth attempt that recorded no detail', () => {
    const result = humanResultDetails({
      inspection: {
        storage: {
          sizeGb: 10,
          usedGb: 9,
          usedPercent: 90,
          policy: { state: 'off' },
          lastGrowth: {
            at: '2026-11-08T10:00:00.000Z',
            targetGb: 20,
            outcome: 'failed',
          },
        },
      },
    });

    expect(result.inspection).toMatchObject({
      Storage:
        '9 of 10 GB used (90%); automatic growth off; last growth to 20 GB failed at 2026-11-08T10:00:00.000Z',
    });
  });

  it('should word a failed storage growth attempt that has no target', () => {
    const result = humanResultDetails({
      inspection: {
        storage: {
          sizeGb: 10,
          usedGb: 9,
          usedPercent: 90,
          policy: { state: 'not-recorded' },
          lastGrowth: {
            at: '2026-11-08T10:00:00.000Z',
            outcome: 'failed',
            detail: 'the size query failed',
          },
        },
      },
    });

    expect(result.inspection).toMatchObject({
      Storage:
        '9 of 10 GB used (90%); policy not recorded; last growth failed at 2026-11-08T10:00:00.000Z: the size query failed',
    });
  });

  it('should word malformed storage figures as unknown and strip control characters from an instant', () => {
    const result = humanResultDetails({
      inspection: {
        storage: {
          sizeGb: '10',
          usedGb: null,
          usedPercent: 90,
          policy: { state: 'on', stepGb: 10, thresholdPercent: 80 },
          lastGrowth: { at: 'now\u001b[2J', targetGb: 20, outcome: 'grown' },
        },
      },
    });

    expect(result.inspection).toMatchObject({
      Storage:
        '? of 10 GB used (90%); grows by 10 GB at 80% up to ? GB; last growth to 20 GB succeeded at now[2J',
    });
  });
});
