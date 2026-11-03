import { checkOperation, traceStage } from '#kernel/operation';

import { settleInspectionResults } from './inspection/results';

import type { NativeInspection } from '#adapters/guest/native/inspection';
import type { DriverRegistry } from '#application/ports/drivers';
import type {
  GuestEnvironmentAccess,
  GuestMechanics,
  InspectionProbe,
  ProbeEvent,
} from '#application/ports/guest';

/**
 * builds the guest inspection over the registered drivers
 * @param context what the probes read
 * @param context.registry every registered driver
 * @param context.environment the recorded environment's reads
 * @param context.native the native configuration's reads
 * @returns the probes an inspection runs, settled into one report
 */
export function createInspection(context: {
  registry: DriverRegistry;
  environment: GuestEnvironmentAccess;
  native: NativeInspection;
}): GuestMechanics['inspection'] {
  const { registry, environment: access, native } = context;

  return {
    /**
     * fetches current service, route, and installation state on explicit inspection
     * @param guest target guest
     * @param options probe observer
     * @returns current service, network, native and environment status
     */
    inspect: async (guest, options = {}) => {
      const { onProbe } = options;
      const environment = await inspectStage(
        'inspection',
        async () => access.read(guest),
        onProbe,
      );
      const { profile } = environment;
      const network = registry.networks[profile.network];
      const [serviceProbe, networkProbe, nativeProbe] =
        await Promise.allSettled([
          inspectStage('services', async () => guest.services.list(), onProbe),
          inspectStage('network', async () => network.status(guest), onProbe),
          inspectStage(
            'native',
            async () => native.inspect(guest, profile),
            onProbe,
          ),
        ] as const);

      return settleInspectionResults({ environment }, [
        serviceProbe,
        networkProbe,
        nativeProbe,
      ]);
    },
  };
}

/**
 * reports a real probe's lifecycle without exposing commands or credentials
 * @param probe probe identity
 * @param check original probe operation
 * @param onProbe optional lifecycle observer
 * @returns the original probe result
 */
async function inspectStage<T>(
  probe: InspectionProbe,
  check: () => Promise<T>,
  onProbe?: (event: ProbeEvent) => void,
): Promise<T> {
  const startedAt = performance.now();
  const elapsed = (): number => performance.now() - startedAt;
  onProbe?.({ probe, phase: 'started' });
  try {
    const result = await traceStage({
      stage: `inspect.${probe}`,
      action: check,
    });
    onProbe?.({ probe, phase: 'completed', durationMs: elapsed() });

    return result;
  } catch (error) {
    checkOperation();
    onProbe?.({ probe, phase: 'failed', durationMs: elapsed() });
    throw error;
  }
}
