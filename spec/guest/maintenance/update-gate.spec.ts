import { execFile } from 'node:child_process';
import { resolve } from 'node:path';
import { promisify } from 'node:util';

import { describe, expect, it } from 'vitest';

/** the gate as the guest installs it */
const GATE = resolve(
  import.meta.dirname,
  '../../../guest/maintenance/update-gate.sh',
);

const execFileAsync = promisify(execFile);

/**
 * starts the gate with the given arguments, as an unprivileged user does
 * @param args the gate's arguments
 * @returns the gate's exit status and standard error
 */
async function startGate(args: readonly string[]) {
  return execFileAsync('sh', [GATE, ...args], {
    env: { OA_SYSTEM_PATH: '/usr/bin:/bin', OA_GUEST_ROOT: '/nonexistent' },
  }).then(
    ({ stderr }) => ({ exitCode: 0, stderr }),
    (error: { code: number; stderr: string }) => ({
      exitCode: error.code,
      stderr: error.stderr,
    }),
  );
}

describe('cmd:update-gate', () => {
  it.each([
    { args: ['--only', 'codex'] },
    { args: ['--force', '--only'] },
    { args: ['--force', '--only', ''] },
    { args: ['--force', '--only', ',codex'] },
    { args: ['--force', '--only', 'codex,'] },
    { args: ['--force', '--only', 'codex,,t3'] },
    { args: ['--force', '--only', 'Codex'] },
    { args: ['--force', '--only', 'codex t3'] },
    { args: ['--force', '--select', 'codex'] },
  ])('should refuse $args with its usage', async ({ args }) => {
    const result = await startGate(args);

    expect(result).toEqual({
      exitCode: 2,
      stderr: 'usage: update-gate.sh [--force [--only <tool>[,<tool>...]]]\n',
    });
  });

  it.each([
    { args: [] },
    { args: ['--force'] },
    { args: ['--force', '--only', 'codex'] },
    { args: ['--force', '--only', 'codex,t3,node_22.x-y'] },
  ])('should accept $args', async ({ args }) => {
    const result = await startGate(args);

    expect(result.stderr).not.toContain('usage:');
    expect(result.exitCode).not.toBe(2);
  });
});
