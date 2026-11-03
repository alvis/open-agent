import { describe, expect, it } from 'vitest';

import { createGuestMechanics } from '#adapters/guest/mechanics';
import { ENVIRONMENT_PATH } from '#adapters/guest/platform/layout';
import { defaults } from '#composition/defaults';
import { registry } from '#composition/registry';

import { environmentOf } from '../../fixtures/environment';
import { DISABLED_NETWORK_PROFILE } from '../../fixtures/profile';

import type { ProbeEvent } from '#application/ports/guest';
import type { GuestChannel } from '#application/ports/guest-channel';

const PROFILE = DISABLED_NETWORK_PROFILE;

/** guest boundary with the recorded setup */
function inspectionGuest(): GuestChannel {
  return {
    services: {
      list: async () => [],
      ensure: async () => undefined,
      stop: async () => true,
      remove: async () => undefined,
    },
    exec: async () => ({ exitCode: 0, stdout: '[]', stderr: '' }),
    spawn: () => {
      throw new Error('Inspection does not open a streaming process');
    },
    exists: async (path) => path === ENVIRONMENT_PATH,
    read: async (path) => {
      if (path === ENVIRONMENT_PATH) {
        return JSON.stringify(environmentOf(PROFILE));
      }
      throw new Error(`Guest path unavailable: ${path}`);
    },
  } satisfies GuestChannel;
}

describe('fn:createInspection', () => {
  it('should report the services with completed probe events', async () => {
    const guest = inspectionGuest();
    const events: ProbeEvent[] = [];
    const inspection = createGuestMechanics({ registry, defaults }).inspection;

    const result = await inspection.inspect(guest, {
      onProbe: (event) => {
        events.push(event);
      },
    });

    expect(result).toMatchObject({ services: [] });
    expect(events.filter(({ probe }) => probe === 'services')).toEqual([
      { probe: 'services', phase: 'started' },
      { probe: 'services', phase: 'completed', durationMs: expect.any(Number) },
    ]);
  });
});
