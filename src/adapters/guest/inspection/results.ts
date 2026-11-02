import { sanitizeGuestDiagnostic } from '#kernel/diagnostics';
import { ensureError } from '#kernel/faults';
import { InteractionExit } from '#kernel/navigation';
import { checkOperation } from '#kernel/operation';

import type {
  GuestInspection,
  InspectionProbeFailure,
} from '#domain/observations/inspection';

type InspectionResults = readonly [
  PromiseSettledResult<GuestInspection['services']>,
  PromiseSettledResult<GuestInspection['network']>,
  PromiseSettledResult<NonNullable<GuestInspection['native']>>,
];

const DIAGNOSTIC_LIMIT = 512;

/**
 * turns operational probe failures into current-state evidence without losing siblings
 * @param recorded the environment setup recorded
 * @param results independently settled probe outcomes
 * @returns current inspection with explicit unavailable-probe evidence
 */
export function settleInspectionResults(
  recorded: Pick<GuestInspection, 'environment'>,
  results: InspectionResults,
): GuestInspection {
  checkOperation();
  const [serviceProbe, networkProbe, nativeProbe] = results;
  const probeFailures: InspectionProbeFailure[] = [];
  const services =
    inspectionValue(serviceProbe, 'services', probeFailures) ?? [];
  const network = inspectionValue(networkProbe, 'network', probeFailures) ?? {
    online: false,
    skipped: false,
    reason: probeFailures.find((failure) => failure.probe === 'network')
      ?.reason,
  };
  const native = inspectionValue(nativeProbe, 'native', probeFailures);

  return {
    services,
    network,
    native,
    ...recorded,
    probeFailures,
  };
}

/**
 * keeps a failed operational probe as bounded evidence and rethrows code defects
 * @param result one settled live probe
 * @param probe probe identity
 * @param failures accumulating failures from this inspection
 * @returns the successful value or undefined for an unavailable probe
 */
function inspectionValue<T>(
  result: PromiseSettledResult<T>,
  probe: InspectionProbeFailure['probe'],
  failures: InspectionProbeFailure[],
): T | undefined {
  if (result.status === 'fulfilled') {
    return result.value;
  }
  const error = ensureError(result.reason);
  if (
    error instanceof InteractionExit ||
    error instanceof SyntaxError ||
    error instanceof TypeError ||
    error instanceof ReferenceError ||
    error instanceof RangeError
  ) {
    throw error;
  }
  failures.push({
    probe,
    reason:
      sanitizeGuestDiagnostic(error.message).slice(-DIAGNOSTIC_LIMIT) ||
      `${probe} probe unavailable`,
  });

  return undefined;
}
