import type { NetworkDriver } from '#application/ports/drivers';
import type { NetworkStatus } from '#domain/observations/network';
import type { ReadinessFinding } from '#domain/readiness';

/** why the workstation reports no network */
const NOT_SELECTED = 'No private network is selected';

/**
 * reports the status of a workstation that joins no private network
 * @returns a neutral status that is offline and skipped
 */
function notConnected(): NetworkStatus {
  return { online: false, skipped: true, reason: NOT_SELECTED };
}

/**
 * keeps the workstation off any private network: it installs nothing, runs no
 * daemon, takes no inputs, and every action leaves the guest and the caller's
 * network accounts untouched
 */
export const none: NetworkDriver<'none'> = {
  id: 'none',
  kind: 'networks',
  displayName: 'None',

  tools: [],
  preflight: async () => Promise.resolve({ problems: [] }),

  enroll: async () => Promise.resolve(),
  status: async () => Promise.resolve(notConnected()),

  readiness: (): ReadinessFinding[] => [
    { name: 'private network', status: 'skipped' },
  ],
};
