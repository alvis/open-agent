import { execa } from 'execa';

import { currentOperation, runOperation } from '#kernel/operation';

import type { LocalProcessParams } from '#application/ports/host';

const DEFAULT_PROCESS_TIMEOUT_MS = 15_000;

/**
 * runs a local noninteractive program with bounded execution time
 * @param params executable, argument array and maximum execution time
 * @returns trimmed standard output from a successful process
 * @throws {Error} when the process exits unsuccessfully
 */
export async function runLocal(params: LocalProcessParams): Promise<string> {
  const {
    program,
    arguments: arguments_,
    timeoutMs = DEFAULT_PROCESS_TIMEOUT_MS,
  } = params;
  const result = await runOperation(async () =>
    execa(program, arguments_, {
      timeout: timeoutMs,
      cancelSignal: currentOperation()?.signal,
      stdin: 'ignore',
      stderr: 'pipe',
      stdout: 'pipe',
      reject: false,
    }),
  );
  if (result.exitCode !== 0) {
    throw new Error(`${program} failed (${result.exitCode ?? 'timeout'})`);
  }

  return result.stdout.trim();
}
