import type { FlyMachineTarget } from './api';

/**
 * builds the API path of one machine
 * @param target app and machine
 * @returns absolute API path below the base URL
 */
export function machinePath(target: FlyMachineTarget): string {
  return `/apps/${encode(target.app)}/machines/${encode(target.machine)}`;
}

/**
 * builds the API path of one volume
 * @param app name of the workstation app
 * @param volume volume identity
 * @returns absolute API path below the base URL
 */
export function volumePath(app: string, volume: string): string {
  return `/apps/${encode(app)}/volumes/${encode(volume)}`;
}

/**
 * escapes one path segment
 * @param segment app name, machine identity or address
 * @returns the encoded segment
 */
export function encode(segment: string): string {
  return encodeURIComponent(segment);
}
