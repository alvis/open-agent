import { finding } from '#domain/findings';

import type { NetworkStatus } from '#domain/observations/network';
import type { ReadinessFinding } from '#domain/readiness';

/**
 * builds Tailscale checks
 * @param status current native Tailscale status
 * @returns connectivity findings in reporting order
 */
export function tailscaleReadiness(status: NetworkStatus): ReadinessFinding[] {
  return [finding(status.online, 'Tailscale connectivity')];
}
