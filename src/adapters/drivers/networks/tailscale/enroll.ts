import { runGuestResult } from '#adapters/guest/platform/run';
import { isRecord } from '#kernel/guards';

import { ensureTailnetDaemon, enrollTailnet } from './daemon';
import { tailscaleCommand } from './service';
import { inspectTailscale } from './status';

import type { NetworkEnrollParams } from '#application/ports/drivers';
import type { GuestChannel } from '#application/ports/guest-channel';

import type { NetworkStatus } from '#domain/observations/network';

/**
 * starts the persistent Tailscale daemon and enrols through a session key file
 * @param guest target guest
 * @param enrollment device hostname and enrolment credential
 */
export async function enrollTailscale(
  guest: GuestChannel,
  enrollment: NetworkEnrollParams,
): Promise<void> {
  const { recordIdentity } = enrollment;
  await ensureTailnetDaemon(guest);
  await joinTailnet(guest, enrollment);
  const status = await inspectTailscale(guest);
  assertTailnetReady(status);
  await recordIdentity({
    deviceId: status.deviceId,
    ip: status.ip,
  });
}

/**
 * enrols a guest that is not yet registered, leaving a registered one as is
 * @param guest target guest
 * @param enrollment device hostname and enrolment credential
 */
async function joinTailnet(
  guest: GuestChannel,
  enrollment: NetworkEnrollParams,
): Promise<void> {
  const { hostname, credential } = enrollment;
  const current = await runGuestResult(
    guest,
    tailscaleCommand('status', '--json'),
  );
  const status: unknown =
    current.exitCode === 0 ? JSON.parse(current.stdout) : undefined;
  const enrolled =
    isRecord(status) && isRecord(status.Self) && Boolean(status.Self.ID);
  if (enrolled) {
    return;
  }
  if (!credential) {
    throw new Error(
      'A Tailscale enrolment key is required for this unregistered device',
    );
  }
  await enrollTailnet(guest, { authKey: credential, hostname });
}

/**
 * requires live connectivity evidence
 * @param status current native Tailscale status
 */
function assertTailnetReady(status: NetworkStatus): void {
  if (!status.online) {
    throw new Error('Tailscale did not confirm current tailnet connectivity');
  }
}
