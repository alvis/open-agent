import { NETWORK_IDS } from '#domain/ids';

import type { NetworkId } from '#domain/ids';

/**
 * lists every registered network id in catalog order
 * @returns the ids of all networks
 */
export function networkIds(): NetworkId[] {
  return [...NETWORK_IDS];
}
