import { describe, expect, it } from 'vitest';

import { assessReadiness, readinessWarnings } from '#application/readiness';

import { environmentOf } from '../fixtures/environment';
import { profileWith } from '../fixtures/profile';

import { dependencies } from '../mocks/dependencies';

import type { ProviderId } from '#domain/ids';
import type { GuestInspection } from '#domain/observations/inspection';
import type { StorageReport } from '#domain/observations/storage';
import type { GuestServiceState } from '#domain/services';

/** the services a ready workstation runs */
const RUNNING: GuestServiceState[] = [
  { name: 't3-code', status: 'running', needs: [] },
  { name: 'open-agent-cron', status: 'running', needs: [] },
];

/** storage nearly full, past its threshold at its limit, whose last growth failed */
const TROUBLED_STORAGE: StorageReport = {
  sizeGb: 98,
  usedGb: 95,
  usedPercent: 97,
  policy: {
    state: 'on',
    thresholdPercent: 80,
    stepGb: 10,
    limitGb: 100,
    mechanisms: ['provider-auto'],
  },
  lastGrowth: {
    at: '2026-11-08T10:00:00.000Z',
    targetGb: 100,
    outcome: 'failed',
  },
};

/**
 * builds an inspection of a workstation on a provider with the given services
 * @param provider the selected provider
 * @param services the services the provider reported
 * @returns a complete inspection without a network or gateway
 */
function inspectionOf(
  provider: ProviderId,
  services: GuestServiceState[],
): GuestInspection {
  return {
    services,
    network: { online: false, skipped: true },
    hub: { reachable: false, skipped: true },
    environment: environmentOf({
      ...profileWith({ network: false, exitNode: false, cliproxyapi: false }),
      provider,
    }),
    probeFailures: [],
    governor: { recorded: false, reason: 'not recorded' },
  };
}

describe('fn:assessReadiness maintenance schedule', () => {
  it.each(['sprite', 'fly-machine'] as const)(
    'should check the cron service on %s',
    (provider) => {
      const missing = assessReadiness(dependencies, inspectionOf(provider, []));
      const running = assessReadiness(
        dependencies,
        inspectionOf(provider, [
          { name: 'open-agent-cron', status: 'running', needs: [] },
        ]),
      );

      expect({
        missing: missing.failures.filter((name) =>
          name.startsWith('maintenance'),
        ),
        running: running.failures.filter((name) =>
          name.startsWith('maintenance'),
        ),
      }).toEqual({ missing: ['maintenance cron service'], running: [] });
    },
  );
});

describe('storage findings', () => {
  it('should keep readiness unchanged by storage warnings and a failed storage probe', () => {
    const healthy = inspectionOf('sprite', RUNNING);
    const troubled = {
      ...healthy,
      storage: TROUBLED_STORAGE,
      probeFailures: [{ probe: 'storage' as const, reason: 'df timed out' }],
    };

    expect(assessReadiness(dependencies, troubled)).toEqual({
      ...assessReadiness(dependencies, healthy),
      probeFailures: troubled.probeFailures,
    });
  });

  it('should still fail readiness for any other failed probe', () => {
    const inspection = {
      ...inspectionOf('sprite', RUNNING),
      probeFailures: [{ probe: 'native' as const, reason: 'no answer' }],
    };

    expect(assessReadiness(dependencies, inspection)).toMatchObject({
      ready: false,
      failures: expect.arrayContaining(['native inspection unavailable']),
    });
  });
});

describe('fn:readinessWarnings', () => {
  it('should warn of nothing without storage findings', () => {
    expect(readinessWarnings(inspectionOf('sprite', RUNNING))).toEqual([]);
  });

  it('should warn of every storage finding', () => {
    expect(
      readinessWarnings({
        ...inspectionOf('fly-machine', RUNNING),
        storage: TROUBLED_STORAGE,
      }),
    ).toEqual([
      expect.stringContaining('97% full'),
      expect.stringContaining('growth limit'),
      expect.stringContaining('failed'),
    ]);
  });

  it('should warn of a failed storage probe with its reason, but of no other probe', () => {
    expect(
      readinessWarnings({
        ...inspectionOf('sprite', RUNNING),
        probeFailures: [
          { probe: 'native', reason: 'no answer' },
          { probe: 'storage', reason: 'df timed out' },
        ],
      }),
    ).toEqual(['storage inspection unavailable: df timed out']);
  });
});
