import { HARNESS_IDS } from '#domain/ids';

import type { HarnessId } from '#domain/ids';

/**
 * names a harness the way prompts and readiness checks address it
 * @param id harness identifier
 * @returns the identifier with its first letter capitalized
 */
export function harnessLabel(id: HarnessId): string {
  return `${id.slice(0, 1).toUpperCase()}${id.slice(1)}`;
}

/**
 * lists the identifiers of every registered harness driver
 * @returns harness identifiers in registration order
 */
export function harnessIds(): HarnessId[] {
  return [...HARNESS_IDS];
}
