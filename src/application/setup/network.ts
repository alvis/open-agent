import type { NetworkSetupData } from '#application/data';

/**
 * applies the selected network; no registered network runs on the guest, so
 * the guest is left as it is and its network readiness is skipped
 * @returns selected network summary
 */
export function setupNetwork(): NetworkSetupData {
  return { network: { status: 'disabled', readiness: 'skipped' } };
}
