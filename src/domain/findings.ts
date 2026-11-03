import type { ReadinessFinding } from './readiness';

/**
 * converts a boolean observation into a finding
 * @param passed whether the observation held
 * @param name check name
 * @returns the passed or failed finding
 */
export function finding(passed: boolean, name: string): ReadinessFinding {
  return { name, status: passed ? 'passed' : 'failed' };
}
