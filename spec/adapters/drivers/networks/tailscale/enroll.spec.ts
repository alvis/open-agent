import { describe, expect, it, vi } from 'vitest';

import { enrollTailscale } from '#adapters/drivers/networks/tailscale/enroll';
import { Secret } from '#kernel/secret';

import type { NetworkEnrollParams } from '#application/ports/drivers';
import type { GuestChannel } from '#application/ports/guest-channel';
import type { NetworkStatus } from '#domain/observations/network';

const statuses = vi.hoisted(() => new WeakMap<GuestChannel, NetworkStatus>());
const boundary = vi.hoisted(
  () =>
    ({
      ensureTailnetDaemon: vi.fn<
        typeof import('#adapters/drivers/networks/tailscale/daemon').ensureTailnetDaemon
      >(async () => undefined),
      enrollTailnet: vi.fn<
        typeof import('#adapters/drivers/networks/tailscale/daemon').enrollTailnet
      >(async () => undefined),
      inspectTailscale: vi.fn<
        typeof import('#adapters/drivers/networks/tailscale/status').inspectTailscale
      >(
        async (guest) =>
          statuses.get(guest) ?? {
            deviceId: 'workstation',
            ip: '100.64.0.2',
            online: true,
            skipped: false,
          },
      ),
    }) satisfies Partial<
      typeof import('#adapters/drivers/networks/tailscale/daemon') &
        typeof import('#adapters/drivers/networks/tailscale/status')
    >,
);
vi.mock(
  '#adapters/drivers/networks/tailscale/daemon',
  () =>
    ({
      ensureTailnetDaemon: boundary.ensureTailnetDaemon,
      enrollTailnet: boundary.enrollTailnet,
    }) satisfies Partial<
      typeof import('#adapters/drivers/networks/tailscale/daemon')
    >,
);
vi.mock(
  '#adapters/drivers/networks/tailscale/status',
  () =>
    ({ inspectTailscale: boundary.inspectTailscale }) satisfies Partial<
      typeof import('#adapters/drivers/networks/tailscale/status')
    >,
);
const guest = {
  exec: vi.fn<GuestChannel['exec']>(async () => ({
    stdout: JSON.stringify({ Self: { ID: 'existing' } }),
    stderr: '',
    exitCode: 0,
  })),
} satisfies Partial<GuestChannel>;
const recordIdentity = vi.fn<NetworkEnrollParams['recordIdentity']>(
  async () => undefined,
);
const enrollment = { hostname: 'workstation', recordIdentity };

describe('fn:enrollTailscale', () => {
  it('should leave an enrolled device as is and persist live identity', async () => {
    await enrollTailscale(
      guest as Partial<GuestChannel> as GuestChannel,
      enrollment,
    );

    expect(recordIdentity.mock.calls).toEqual([
      [{ deviceId: 'workstation', ip: '100.64.0.2' }],
    ]);
    expect(guest.exec).toHaveBeenCalledOnce();
    expect(boundary.enrollTailnet).not.toHaveBeenCalled();
  });
});

describe('Tailscale registration', () => {
  it.each([null, { Self: null }, { Self: {} }])(
    'should enroll an unregistered native status %j with the private key',
    async (native) => {
      const channel = {
        exec: vi.fn<GuestChannel['exec']>(async () => ({
          stdout: JSON.stringify(native),
          stderr: '',
          exitCode: 0,
        })),
      } satisfies Partial<GuestChannel> as Partial<GuestChannel> as GuestChannel;
      const credential = Secret.fromHost('provider-api', 'enrollment-key');

      await enrollTailscale(channel, { ...enrollment, credential });

      expect(recordIdentity.mock.calls).toEqual([
        [{ deviceId: 'workstation', ip: '100.64.0.2' }],
      ]);
      expect(boundary.enrollTailnet.mock.calls).toEqual([
        [
          channel,
          {
            authKey: credential,
            hostname: 'workstation',
          },
        ],
      ]);
    },
  );

  it('should require an enrollment credential after the native status command fails', async () => {
    guest.exec.mockImplementationOnce(async () => ({
      stdout: '',
      stderr: 'not registered',
      exitCode: 1,
    }));

    await expect(
      enrollTailscale(
        guest as Partial<GuestChannel> as GuestChannel,
        enrollment,
      ),
    ).rejects.toMatchObject({ message: expect.stringContaining('key') });
    expect(recordIdentity).not.toHaveBeenCalled();
  });
});

describe('Tailscale readiness', () => {
  it('should not persist an identity when live connectivity fails', async () => {
    const channel = { ...guest } as Partial<GuestChannel> as GuestChannel;
    statuses.set(channel, {
      deviceId: 'workstation',
      ip: '100.64.0.2',
      online: false,
      skipped: false,
    });

    await expect(enrollTailscale(channel, enrollment)).rejects.toThrow(
      /connectivity/iu,
    );
    expect(recordIdentity).not.toHaveBeenCalled();
  });
});
