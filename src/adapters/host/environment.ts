import process from 'node:process';

/**
 * reads the variables this computer's process was started with
 * @returns the process environment
 */
export function environmentVariables(): NodeJS.ProcessEnv {
  return process.env;
}
