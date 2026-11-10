import { describe, expect, it, vi } from 'vitest';

import { inspectUntilServing } from '#application/serving';

import { environmentOf } from '../fixtures/environment';
import { DISABLED_NETWORK_PROFILE } from '../fixtures/profile';

import type { GuestInspection } from '#domain/observations/inspection';

const MINUTE = 60_000;
const FULL_INSPECTION = {
  services: [],
  network: {
    online: false,
    dnsReady: false,
    skipped: true,
    reason: 'No private network is selected',
  },
  native: {
    claude: {
      gatewayConfigured: false,
      modelDiscoveryEnabled: false,
      pluginListAvailable: false,
      awakeHooksInstalled: false,
      authentication: 'not-configured',
    },
    codex: {
      gatewayConfigured: false,
      modelDiscoveryEnabled: false,
      pluginListAvailable: false,
      awakeHooksInstalled: false,
      authentication: 'not-configured',
    },
    harnesses: {
      claude: {
        selectedPlugins: [],
        evidence: { sdkPluginLoading: 'not-verified' },
      },
      codex: {
        selectedPlugins: [],
        evidence: undefined,
      },
    },
  },
  hub: { skipped: true, reachable: false },
  environment: environmentOf(DISABLED_NETWORK_PROFILE),
  probeFailures: [],
  governor: { recorded: false, reason: 'no awake event has been recorded yet' },
} satisfies GuestInspection;

/**
 * runs one polling assertion with its own timer boundary
 * @param action assertion using fake timers
 */
async function withFakeTimers(action: () => Promise<void>): Promise<void> {
  vi.useFakeTimers();
  try {
    await action();
  } finally {
    vi.useRealTimers();
  }
}

describe('fn:inspectUntilServing', () => {
  it('should poll only the environment check until the agent answers, then inspect fully once', async () =>
    withFakeTimers(async () => {
      const answers = [{ ok: false }, undefined, { ok: true }];
      const probe = vi.fn<() => Promise<{ ok: boolean } | undefined>>(
        async () => answers.shift(),
      );
      const inspect = vi.fn<() => Promise<GuestInspection>>(
        async () => FULL_INSPECTION,
      );

      const pending = inspectUntilServing(probe, inspect);
      await vi.advanceTimersByTimeAsync(MINUTE);
      const result = await pending;

      expect({
        probes: probe.mock.calls.length,
        inspections: inspect.mock.calls.length,
        result,
      }).toEqual({ probes: 3, inspections: 1, result: FULL_INSPECTION });
    }));

  it('should give up polling once the wait is over and still inspect fully once', async () =>
    withFakeTimers(async () => {
      const probe = vi.fn<() => Promise<{ ok: boolean } | undefined>>(
        async () => ({ ok: false }),
      );
      const inspect = vi.fn<() => Promise<GuestInspection>>(
        async () => FULL_INSPECTION,
      );

      const pending = inspectUntilServing(probe, inspect);
      await vi.advanceTimersByTimeAsync(10 * MINUTE);
      const result = await pending;

      expect({
        stopped: probe.mock.calls.length < 30,
        inspections: inspect.mock.calls.length,
        result,
      }).toEqual({ stopped: true, inspections: 1, result: FULL_INSPECTION });
    }));

  it('should probe once when the agent already answers', async () => {
    const probe = vi.fn<() => Promise<{ ok: boolean } | undefined>>(
      async () => ({ ok: true }),
    );
    const inspect = vi.fn<() => Promise<GuestInspection>>(
      async () => FULL_INSPECTION,
    );

    await inspectUntilServing(probe, inspect);

    expect({
      probes: probe.mock.calls.length,
      inspections: inspect.mock.calls.length,
    }).toEqual({ probes: 1, inspections: 1 });
  });

  it('should inspect again while the inspection is not ready and return the first ready one', async () =>
    withFakeTimers(async () => {
      const lapsed = {
        ...FULL_INSPECTION,
        network: { online: false, dnsReady: false, skipped: false },
      } satisfies GuestInspection;
      const inspections = [lapsed, lapsed, FULL_INSPECTION];
      const inspect = vi.fn<() => Promise<GuestInspection>>(
        async () => inspections.shift() ?? lapsed,
      );

      const pending = inspectUntilServing(
        async () => ({ ok: true }),
        inspect,
        (inspection) => inspection.network.skipped,
      );
      await vi.advanceTimersByTimeAsync(MINUTE);
      const result = await pending;

      expect({ inspections: inspect.mock.calls.length, result }).toEqual({
        inspections: 3,
        result: FULL_INSPECTION,
      });
    }));

  it('should return the last inspection once a guest stays not ready', async () =>
    withFakeTimers(async () => {
      const inspect = vi.fn<() => Promise<GuestInspection>>(
        async () => FULL_INSPECTION,
      );

      const pending = inspectUntilServing(
        async () => ({ ok: true }),
        inspect,
        () => false,
      );
      await vi.advanceTimersByTimeAsync(10 * MINUTE);
      const result = await pending;

      expect({ inspections: inspect.mock.calls.length, result }).toEqual({
        inspections: 4,
        result: FULL_INSPECTION,
      });
    }));
});
