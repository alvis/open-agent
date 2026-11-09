import { describe, expect, it, vi } from 'vitest';

import { createGuestMechanics } from '#adapters/guest/mechanics';
import { ENVIRONMENT_PATH } from '#adapters/guest/platform/layout';
import { defaults } from '#composition/defaults';
import { registry } from '#composition/registry';

import { environmentOf } from '../../fixtures/environment';
import { profileWith } from '../../fixtures/profile';

import type { ProbeEvent } from '#application/ports/guest';
import type { GuestChannel } from '#application/ports/guest-channel';
import type { BootReport } from '#domain/observations/boot';
import type { GuestEnvironment } from '#domain/observations/environment';

const PROFILE = profileWith({
  network: false,
  exitNode: false,
  cliproxyapi: true,
});

/** what df prints for a 20 GB filesystem two thirds full */
const MEASURE = [
  'Filesystem     1024-blocks     Used Available Capacity Mounted on',
  '/dev/vdb          20971520 13736345   7235175      66% /',
].join('\n');

/**
 * builds a guest boundary with the recorded setup, a reachable model
 * catalogue and a measurable storage
 * @param environment the environment setup recorded
 * @param storageExit status the storage probe exits with, 0 when df measures the storage
 * @returns a guest channel answering every probe the inspection runs
 */
function inspectionGuest(
  environment: GuestEnvironment = environmentOf(PROFILE),
  storageExit = 0,
): GuestChannel {
  return {
    services: {
      list: async () => [],
      ensure: async () => undefined,
      stop: async () => true,
      restart: async () => true,
      remove: async () => undefined,
    },
    exec: async ({ arguments: args }) =>
      args.includes('oa-storage')
        ? { exitCode: storageExit, stdout: MEASURE, stderr: '' }
        : {
            exitCode: 0,
            stdout: args.includes('oa-hub') ? '204' : '[]',
            stderr: '',
          },
    spawn: () => {
      throw new Error('Inspection does not open a streaming process');
    },
    exists: async (path) => path === ENVIRONMENT_PATH,
    read: async (path) => {
      if (path === ENVIRONMENT_PATH) {
        return JSON.stringify(environment);
      }
      throw new Error(`Guest path unavailable: ${path}`);
    },
    assertUnrestrictedNetwork: async () => undefined,
  } satisfies GuestChannel;
}

describe('fn:createInspection', () => {
  it('should report an enabled gateway and provider boot evidence with completed probe events', async () => {
    const guest = inspectionGuest();
    const boot: BootReport = {
      status: 'ok',
      startedAt: '2026-10-26T00:00:00Z',
      durationMs: 70,
      unsuccessfulSteps: {},
      log: [],
    };
    const events: ProbeEvent[] = [];
    const inspectBoot = vi.fn(async () => boot);
    const inspection = createGuestMechanics({ registry, defaults }).inspection;

    const result = await inspection.inspect(guest, {
      provider: { inspectBoot },
      onProbe: (event) => {
        events.push(event);
      },
    });

    expect(result).toMatchObject({
      hub: { reachable: true, skipped: false, status: 204 },
      boot,
    });
    expect(events.filter(({ probe }) => probe === 'proxy')).toEqual([
      { probe: 'proxy', phase: 'started' },
      { probe: 'proxy', phase: 'completed', durationMs: expect.any(Number) },
    ]);
    expect(events.filter(({ probe }) => probe === 'boot')).toEqual([
      { probe: 'boot', phase: 'started' },
      { probe: 'boot', phase: 'completed', durationMs: expect.any(Number) },
    ]);
    expect(inspectBoot).toHaveBeenCalledExactlyOnceWith(guest);
  });

  it('should keep sibling inspection evidence when the provider boot record cannot be read', async () => {
    const guest = inspectionGuest();
    const events: ProbeEvent[] = [];
    const inspection = createGuestMechanics({ registry, defaults }).inspection;

    const result = await inspection.inspect(guest, {
      provider: {
        inspectBoot: async () => {
          throw new Error('Boot record unavailable');
        },
      },
      onProbe: (event) => {
        events.push(event);
      },
    });

    expect(result).toMatchObject({
      hub: { reachable: true, skipped: false, status: 204 },
    });
    expect(result).not.toHaveProperty('boot');
    expect(events.filter(({ probe }) => probe === 'boot')).toEqual([
      { probe: 'boot', phase: 'started' },
      { probe: 'boot', phase: 'failed', durationMs: expect.any(Number) },
    ]);
  });

  it.each([
    {
      provider: 'sprite',
      path: '/',
      recorded: undefined,
      policy: { state: 'not-recorded' },
    },
    {
      provider: 'fly-machine',
      path: '/data',
      recorded: {
        state: 'on',
        thresholdPercent: 80,
        stepGb: 10,
        limitGb: 100,
        mechanisms: ['provider-auto'],
      },
      policy: {
        state: 'on',
        thresholdPercent: 80,
        stepGb: 10,
        limitGb: 100,
        mechanisms: ['provider-auto'],
      },
    },
  ] as const)(
    'should measure a $provider workstation at its declared storage path with the recorded policy',
    async ({ provider, path, recorded, policy }) => {
      const environment = environmentOf(
        { ...PROFILE, provider },
        recorded ? { storage: recorded } : {},
      );
      const guest = inspectionGuest(environment);
      const exec = vi.spyOn(guest, 'exec');
      const inspection = createGuestMechanics({
        registry,
        defaults,
      }).inspection;

      const result = await inspection.inspect(guest);

      expect(result.storage).toEqual({
        sizeGb: 20,
        usedGb: 13.1,
        usedPercent: 66,
        policy,
      });
      expect(exec).toHaveBeenCalledWith(
        expect.objectContaining({
          arguments: expect.arrayContaining(['oa-storage', path]),
        }),
      );
    },
  );

  it('should keep sibling evidence and report a storage probe failure when storage cannot be measured', async () => {
    const guest = inspectionGuest(environmentOf(PROFILE), 1);
    const events: ProbeEvent[] = [];
    const inspection = createGuestMechanics({ registry, defaults }).inspection;

    const result = await inspection.inspect(guest, {
      onProbe: (event) => {
        events.push(event);
      },
    });

    expect(result).toMatchObject({
      hub: { reachable: true, skipped: false, status: 204 },
      probeFailures: expect.arrayContaining([
        { probe: 'storage', reason: 'The storage at / could not be measured' },
      ]),
    });
    expect(result).not.toHaveProperty('storage');
    expect(events.filter(({ probe }) => probe === 'storage')).toEqual([
      { probe: 'storage', phase: 'started' },
      { probe: 'storage', phase: 'failed', durationMs: expect.any(Number) },
    ]);
  });
});
