import { runGuestResult } from '#adapters/guest/platform/run';
import { sanitizeGuestDiagnostic } from '#kernel/diagnostics';
import { ensureError } from '#kernel/faults';
import { isRecord } from '#kernel/guards';
import { InteractionExit } from '#kernel/navigation';
import { checkOperation } from '#kernel/operation';

import { tailscaleCommand } from './service';

import type { GuestChannel } from '#application/ports/guest-channel';

import type { NetworkStatus } from '#domain/observations/network';

const DIAGNOSTIC_LIMIT = 512;

/**
 * inspects the current Tailscale client without using cached status
 * @param guest target guest
 * @returns current tailnet identity and connectivity
 */
export async function inspectTailscale(
  guest: GuestChannel,
): Promise<NetworkStatus> {
  let result: Awaited<ReturnType<typeof runGuestResult>>;
  try {
    result = await runGuestResult(guest, tailscaleCommand('status', '--json'));
  } catch (error) {
    checkOperation();
    if (
      error instanceof InteractionExit ||
      error instanceof SyntaxError ||
      error instanceof TypeError ||
      error instanceof ReferenceError ||
      error instanceof RangeError
    ) {
      throw error;
    }

    const failure = ensureError(error);

    return offlineTailnetStatus(
      failure === error ? failure.message : 'Tailscale status unavailable',
    );
  }
  if (result.exitCode !== 0) {
    return offlineTailnetStatus(
      `Tailscale status exited with status ${result.exitCode}: ${result.stderr}`,
    );
  }
  const status: unknown = JSON.parse(result.stdout);
  if (!isRecord(status)) {
    throw new Error('Tailscale returned a malformed status result');
  }

  return parseTailnetStatus(status);
}

/**
 * interprets native status as one tailnet view
 * @param status parsed native Tailscale status object
 * @returns bounded current tailnet status
 */
export function parseTailnetStatus(
  status: Record<string, unknown>,
): NetworkStatus {
  const self = isRecord(status.Self) ? status.Self : {};

  return {
    deviceId: typeof self.ID === 'string' && self.ID ? self.ID : undefined,
    ip: firstIpv4(self.TailscaleIPs),
    online: self.Online === true,
    skipped: false,
  };
}

/**
 * records a failed live status probe without implying a disabled integration
 * @param reason bounded guest or transport diagnostic
 * @returns offline, unskipped tailnet status
 */
function offlineTailnetStatus(reason: string): NetworkStatus {
  return {
    online: false,
    skipped: false,
    reason:
      sanitizeGuestDiagnostic(reason).slice(-DIAGNOSTIC_LIMIT) ||
      'Tailscale status unavailable',
  };
}

/**
 * extracts the first IPv4 address or prefix in a native address list
 * @param addresses candidate native address list
 * @returns IPv4 address or prefix when present
 */
function firstIpv4(addresses: unknown): string | undefined {
  return Array.isArray(addresses)
    ? addresses.find(
        (item): item is string =>
          typeof item === 'string' && item.includes('.'),
      )
    : undefined;
}
