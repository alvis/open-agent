import type { NativeHarnessInspection } from '#domain/observations/harness';
import type { ReadinessFinding } from '#domain/readiness';

/**
 * reports whether the harness's hooks carry the idle governor's awake
 * commands: without them the harness never reports activity, so the
 * workstation could sleep mid-turn
 * @param label harness name used in the check name
 * @param inspection native configuration evidence, absent when inspection failed
 * @returns the awake-hooks finding
 */
export function awakeHooksReadiness(
  label: string,
  inspection: NativeHarnessInspection | undefined,
): ReadinessFinding {
  return {
    name: `${label} awake hooks`,
    status: inspection?.awakeHooksInstalled === true ? 'passed' : 'failed',
  };
}
