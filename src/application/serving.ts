import { checkOperation, runOperation } from '#kernel/operation';

import type { GuestInspection } from '#domain/observations/inspection';

const MILLISECONDS_PER_MINUTE = 60_000;

/**
 * a freshly started agent answers its environment endpoint only after it has
 * opened its state, which may take minutes on a shared guest while its event
 * loop stalls during startup
 */
const SERVING_WAIT_MINUTES = 4;
const SERVING_WAIT_MS = SERVING_WAIT_MINUTES * MILLISECONDS_PER_MINUTE;
const SERVING_RETRY_MS = 10_000;
/**
 * a guest that serves may still fail a check it passes moments later, as
 * when one reading of the Tailscale client finds tailnet connectivity lapsed,
 * so an inspection that is not ready is taken this often in all
 */
const READINESS_INSPECTIONS = 4;
const READINESS_RETRY_MS = 15_000;

/**
 * waits for a guest whose agent service has just been started to answer its
 * environment endpoint, polling only that one cheap check so the wait does not
 * compete with the starting agent for CPU, then inspects the guest in full,
 * again a few times, 15 seconds apart, while the inspection is not ready
 * @param probe takes the agent's own environment check, one guest round trip
 * @param inspect takes the full guest inspection, which runs once the agent answered or the wait was over
 * @param isReady tells whether an inspection passes every readiness check; any inspection does when absent
 * @returns the first ready inspection, or the last one taken
 */
export async function inspectUntilServing(
  probe: () => Promise<{ ok: boolean } | undefined>,
  inspect: () => Promise<GuestInspection>,
  isReady: (inspection: GuestInspection) => boolean = () => true,
): Promise<GuestInspection> {
  const deadline = Date.now() + SERVING_WAIT_MS;
  for (;;) {
    const environment = await probe();
    if (environment?.ok === true || Date.now() + SERVING_RETRY_MS > deadline) {
      break;
    }
    await pause(SERVING_RETRY_MS);
  }
  for (let inspection = 1; ; inspection += 1) {
    const observed = await inspect();
    if (isReady(observed) || inspection >= READINESS_INSPECTIONS) {
      return observed;
    }
    await pause(READINESS_RETRY_MS);
  }
}

/**
 * waits, ending early with the command's cancellation
 * @param ms milliseconds to wait
 */
async function pause(ms: number): Promise<void> {
  await runOperation(
    async () =>
      new Promise<void>((resolve) => {
        setTimeout(resolve, ms);
      }),
  );
  checkOperation();
}
