import process from 'node:process';

import { describe, expect, it, vi } from 'vitest';

import { cli } from '#cli/application';
import { parseApplication } from '#cli/parser';

vi.mock('#cli/parser', async (importOriginal) => {
  const original = await importOriginal<typeof import('#cli/parser')>();

  return {
    ...original,
    parseApplication: vi.fn(original.parseApplication),
  } satisfies Partial<typeof import('#cli/parser')>;
});

const parse = vi.mocked(parseApplication);

describe('fn:cli', () => {
  it('should emit a rejected create without contacting a provider service', async () => {
    const originalExitCode = process.exitCode;
    const signalListeners = {
      sigint: process.listenerCount('SIGINT'),
      sigterm: process.listenerCount('SIGTERM'),
    };
    let outputText = '';
    let errorText = '';
    let exitCode: typeof process.exitCode;
    using outbound = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async (): Promise<Response> => {
        throw new Error('Unexpected network request');
      });
    vi.spyOn(process.stdout, 'write').mockImplementation((...args): boolean => {
      outputText += String(args[0]);
      const done = args.find((argument) => typeof argument === 'function');
      done?.();

      return true;
    });
    vi.spyOn(process.stderr, 'write').mockImplementation((...args): boolean => {
      errorText += String(args[0]);
      const done = args.find((argument) => typeof argument === 'function');
      done?.();

      return true;
    });

    try {
      await cli(['create', '--name', 'Not A Name!', '--non-interactive']);
      exitCode = process.exitCode;
    } finally {
      process.exitCode = originalExitCode;
    }

    expect({
      outputText,
      errorText,
      exitCode,
      signalListeners: {
        sigint: process.listenerCount('SIGINT'),
        sigterm: process.listenerCount('SIGTERM'),
      },
    }).toMatchObject({
      outputText: '',
      errorText:
        'Workstation name must be a lowercase DNS label of at most 63 characters\n',
      exitCode: 1,
      signalListeners,
    });
    expect(outbound.mock.calls).toEqual([]);
  });

  it('should emit one usage failure for an unsupported command', async () => {
    const { stdout, stderr, exitCode } = await captureCli(['unsupported']);

    expect(stdout).toBe('');
    expect(stderr).toContain('unsupported');
    expect(exitCode).toBe(2);
  });

  it('should show provider environment guidance in root help', async () => {
    const { stdout, stderr, exitCode } = await captureCli(['--help']);

    expect(stdout).toContain('ENVIRONMENT');
    expect(stdout).toContain('LEARN MORE');
    expect(stdout).toContain('SPRITES_TOKEN');
    expect(stderr).toBe('');
    expect(exitCode).toBe(0);
  });

  it('should report a missing command if parsing returns without output', async () => {
    parse.mockResolvedValueOnce(undefined);

    const { stdout, stderr, exitCode } = await captureCli(['create']);

    expect(stdout).toBe('');
    expect(stderr).toBe('A command is required.\n');
    expect(exitCode).toBe(2);
  });

  it('should hide unexpected parser failures behind a generic result', async () => {
    parse.mockRejectedValueOnce(new Error('private parser detail'));

    const { stdout, stderr, exitCode } = await captureCli(['create']);

    expect(stdout).toBe('');
    expect(stderr).toBe('The command could not complete safely.\n');
    expect(exitCode).toBe(1);
  });

  it('should leave an already emitted result untouched after a parser throw', async () => {
    parse.mockImplementationOnce(async ({ context }) => {
      context.state.emitted = true;
      throw new Error('late parser failure');
    });

    const { stdout, stderr, exitCode } = await captureCli(['create']);

    expect(stdout).toBe('');
    expect(stderr).toBe('');
    expect(exitCode).toBeUndefined();
  });
});

/**
 * captures one real CLI invocation without leaking process streams or exit status
 * @param argv command arguments
 * @returns process output and status
 */
async function captureCli(argv: string[]): Promise<{
  stdout: string;
  stderr: string;
  exitCode: typeof process.exitCode;
}> {
  let stdout = '';
  let stderr = '';
  const originalExitCode = process.exitCode;
  using output = vi
    .spyOn(process.stdout, 'write')
    .mockImplementation((...args) => {
      stdout += String(args[0]);
      const done = args.find((argument) => typeof argument === 'function');
      done?.();

      return true;
    });
  using errors = vi
    .spyOn(process.stderr, 'write')
    .mockImplementation((...args) => {
      stderr += String(args[0]);
      const done = args.find((argument) => typeof argument === 'function');
      done?.();

      return true;
    });
  void output;
  void errors;
  try {
    await cli(argv);

    return { stdout, stderr, exitCode: process.exitCode };
  } finally {
    process.exitCode = originalExitCode;
  }
}
