import process, { stdin, stdout, stderr } from 'node:process';

import { describe, expect, it, vi } from 'vitest';

import { runCommand } from '#application/workstation';
import { createCommandCancellation } from '#cli/cancellation';
import { execute } from '#cli/execution';

import {
  dependenciesWith,
  dependencies as baseDependencies,
} from '../mocks/dependencies';

import type { CommandRequest } from '#application/contracts';
import type { HostPorts } from '#application/ports/host';
import type { CommandResult } from '#application/result';
import type { CommandCancellation } from '#cli/cancellation';
import type { ExecutionState } from '#cli/parser';

const exitCode = vi.hoisted(() => {
  const read = vi.fn<() => typeof process.exitCode>(() => undefined);
  const write = vi.fn<(value: typeof process.exitCode) => void>((value) => {
    read.mockReturnValue(value);
  });

  return { read, write };
});
const stdoutWrite = vi.hoisted(() =>
  vi.fn<(chunk: string) => void>(() => undefined),
);
const stderrWrite = vi.hoisted(() =>
  vi.fn<(chunk: string) => void>(() => undefined),
);
const disposeCancellation = vi.hoisted(() =>
  vi.fn<CommandCancellation['dispose']>(() => undefined),
);

vi.mock('node:process', async (importOriginal) => {
  vi.stubEnv('FORCE_COLOR', '1');
  const actual = await importOriginal<
    typeof import('node:process') & { default: NodeJS.Process }
  >();
  const { PassThrough } = await import('node:stream');
  const inputBuffer = new PassThrough();
  const outputBuffer = new PassThrough();
  const errorBuffer = new PassThrough();
  let rawInput = false;
  const input = new Proxy(actual.stdin, {
    has(target, property) {
      return property === 'isTTY' ||
        property === 'setRawMode' ||
        property === 'isRaw'
        ? true
        : Reflect.has(target, property);
    },
    get(target, property, receiver) {
      if (property === 'isTTY') {
        return true;
      }
      if (property === 'isRaw') {
        return rawInput;
      }
      if (property === 'setRawMode') {
        return (mode: boolean) => {
          rawInput = mode;

          return input;
        };
      }
      if (property in inputBuffer) {
        const value: unknown = Reflect.get(inputBuffer, property, inputBuffer);

        return typeof value === 'function'
          ? (...args: unknown[]) => Reflect.apply(value, inputBuffer, args)
          : value;
      }

      return Reflect.get(target, property, receiver);
    },
  });
  /**
   * redirects one typed process output port through an in-memory terminal
   * @param params real stream, capture stream and optional write observer
   * @param params.target original typed process output port
   * @param params.buffer in-memory terminal stream
   * @param params.onWrite optional observation of each write
   * @returns process-compatible output port
   */
  const outputPort = <T extends NodeJS.WriteStream>({
    target,
    buffer,
    onWrite,
  }: {
    target: T;
    buffer: InstanceType<typeof PassThrough>;
    onWrite?: (chunk: string) => void;
  }): T =>
    new Proxy(target, {
      get(real, property, receiver) {
        if (property === 'isTTY') {
          return true;
        }
        if (property === 'columns') {
          return 80;
        }
        if (property === 'rows') {
          return 24;
        }
        if (property === 'getColorDepth') {
          return () => 8;
        }
        if (property === 'hasColors') {
          return () => true;
        }
        if (property === 'write') {
          return (...args: unknown[]) => {
            const chunk = String(args[0]);
            buffer.write(chunk);
            onWrite?.(chunk);
            const done = args.find(
              (argument): argument is () => void =>
                typeof argument === 'function',
            );
            done?.();

            return true;
          };
        }
        if (property in buffer) {
          const value: unknown = Reflect.get(buffer, property, buffer);

          return typeof value === 'function'
            ? (...args: unknown[]) => Reflect.apply(value, buffer, args)
            : value;
        }

        return Reflect.get(real, property, receiver);
      },
    });
  const output = outputPort({
    target: actual.stdout,
    buffer: outputBuffer,
    onWrite: stdoutWrite,
  });
  const errors = outputPort({
    target: actual.stderr,
    buffer: errorBuffer,
    onWrite: stderrWrite,
  });
  const isolated = new Proxy(actual.default, {
    get(target, property, receiver) {
      if (property === 'stdin') {
        return input;
      }
      if (property === 'stdout') {
        return output;
      }
      if (property === 'stderr') {
        return errors;
      }
      if (property === 'exitCode') {
        return exitCode.read();
      }

      return Reflect.get(target, property, receiver);
    },
    set(
      ...[target, property, value, receiver]: [
        NodeJS.Process,
        PropertyKey,
        unknown,
        unknown,
      ]
    ) {
      if (property === 'exitCode') {
        if (
          value !== undefined &&
          typeof value !== 'number' &&
          typeof value !== 'string'
        ) {
          throw new TypeError('Invalid process exit code');
        }
        exitCode.write(value);

        return true;
      }

      return Reflect.set(target, property, value, receiver);
    },
  });

  return {
    ...actual,
    default: isolated,
    stdin: input,
    stdout: output,
    stderr: errors,
  } satisfies typeof import('node:process') & { default: NodeJS.Process };
});

vi.mock(
  '#application/workstation',
  () =>
    ({
      runCommand: vi.fn<typeof runCommand>(async () => ({
        command: 'list',
        ok: true,
        data: { machines: [], unavailable: [] },
      })),
    }) satisfies Partial<typeof import('#application/workstation')>,
);
vi.mock(
  '#cli/cancellation',
  () =>
    ({
      createCommandCancellation: vi.fn<typeof createCommandCancellation>(() => {
        const controller = new AbortController();

        return {
          signal: controller.signal,
          cancel: () => controller.abort(),
          interrupt: () => controller.abort(),
          dispose: disposeCancellation,
        };
      }),
    }) satisfies Partial<typeof import('#cli/cancellation')>,
);

const run = vi.mocked(runCommand);
const cancellation = vi.mocked(createCommandCancellation);
const readInputFile = vi.fn<HostPorts['readInputFile']>(async (path) => {
  switch (path) {
    case 'credentials.env':
      return 'CI=true\n';
    default:
      return '';
  }
});
const dependencies = dependenciesWith({
  host: { ...baseDependencies.host, readInputFile },
});
const success: CommandResult = {
  command: 'list',
  ok: true,
  data: { machines: [], unavailable: [] },
};
const request: CommandRequest = {
  command: 'list',
  options: { nonInteractive: true },
};

/** the human list output when no workstation exists: one empty table line */
const EMPTY_LIST_OUTPUT = '\n';

/** stderr that carries only the stage progress lines non-interactive output writes */
const STAGE_LINES_ONLY = expect.stringMatching(
  /^(?:[\w.]+: (?:started|completed|failed)(?: \(\d+ ms\))?\n)*$/u,
);

/** @returns fresh invocation-local command state */
function state(): ExecutionState {
  return { command: null, emitted: false, errors: [] };
}

/**
 * captures real emission and stream flushing for one command invocation
 * @param params request and optional caller-owned state
 * @param params.request selected command request
 * @param params.state optional caller-owned invocation state
 * @returns captured output, status and final invocation state
 */
async function captureExecution({
  request: selected,
  state: invocation = state(),
}: {
  request: CommandRequest;
  state?: ExecutionState;
}): Promise<{
  stdout: string;
  stderr: string;
  exitCode: typeof process.exitCode;
  state: ExecutionState;
}> {
  const originalExitCode = process.exitCode;
  let outputText = '';
  let errorText = '';
  const appendOutput = (chunk: Buffer): void => {
    outputText += chunk.toString();
  };
  const appendError = (chunk: Buffer): void => {
    errorText += chunk.toString();
  };
  stdout.on('data', appendOutput);
  stderr.on('data', appendError);
  try {
    await execute({ dependencies, request: selected, state: invocation });

    return {
      stdout: outputText,
      stderr: errorText,
      exitCode: process.exitCode,
      state: invocation,
    };
  } finally {
    process.exitCode = originalExitCode;
    stdout.off('data', appendOutput);
    stderr.off('data', appendError);
  }
}

describe('fn:execute', () => {
  it('should validate, run and emit one non-interactive result', async () => {
    const captured = await captureExecution({ request });

    expect({
      stdout: captured.stdout,
      stderr: captured.stderr,
      exitCode: captured.exitCode,
      state: captured.state,
    }).toEqual({
      stdout: EMPTY_LIST_OUTPUT,
      stderr: STAGE_LINES_ONLY,
      exitCode: 0,
      state: { command: 'list', emitted: true, errors: [] },
    });
    expect(run.mock.calls).toEqual([
      [
        dependencies,
        { ...request, options: { ...request.options, nonInteractive: true } },
        { interaction: undefined },
      ],
    ]);
    expect(disposeCancellation).toHaveBeenCalledOnce();
  });

  it('should read a selected credential file before emitting a successful result', async () => {
    const selected: CommandRequest = {
      ...request,
      options: { ...request.options, credentialFile: 'credentials.env' },
    };

    const captured = await captureExecution({ request: selected });

    expect({
      stdout: captured.stdout,
      stderr: captured.stderr,
      exitCode: captured.exitCode,
    }).toEqual({
      stdout: EMPTY_LIST_OUTPUT,
      stderr: STAGE_LINES_ONLY,
      exitCode: 0,
    });
    expect(readInputFile.mock.calls).toEqual([
      ['credentials.env', expect.anything()],
    ]);
  });

  it('should hide a private file-read cause and emit an input failure', async () => {
    readInputFile.mockRejectedValueOnce(new Error('private file path'));
    const selected: CommandRequest = {
      ...request,
      options: { ...request.options, credentialFile: 'missing.env' },
    };

    const captured = await captureExecution({ request: selected });

    expect({
      stdout: captured.stdout,
      stderr: captured.stderr,
      exitCode: captured.exitCode,
    }).toEqual({
      stdout: '',
      stderr: expect.stringContaining('readable regular file'),
      exitCode: 1,
    });
    expect(captured.stderr).not.toContain('private file path');
    expect(run.mock.calls).toEqual([]);
  });

  it('should reject an invalid workstation name before reading a credential file', async () => {
    const selected: CommandRequest = {
      ...request,
      command: 'show',
      machine: 'Not A Name',
      options: {
        ...request.options,
        credentialFile: 'credentials.env',
      },
    };

    const captured = await captureExecution({ request: selected });

    expect({
      stdout: captured.stdout,
      stderr: captured.stderr,
      exitCode: captured.exitCode,
    }).toEqual({
      stdout: '',
      stderr: expect.stringContaining('Workstation name must be'),
      exitCode: 1,
    });
    expect(readInputFile.mock.calls).toEqual([]);
    expect(run.mock.calls).toEqual([]);
  });

  it('should emit a workflow failure through the real renderer', async () => {
    run.mockRejectedValueOnce(new Error('workflow failed'));

    const captured = await captureExecution({ request });

    expect({
      stdout: captured.stdout,
      stderr: captured.stderr,
      exitCode: captured.exitCode,
    }).toEqual({
      stdout: '',
      stderr: expect.stringContaining('workflow failed\n'),
      exitCode: 1,
    });
  });

  it('should dispose a real interactive session after a failed workflow', async () => {
    vi.stubEnv('CI', 'false');
    vi.stubEnv('NON_INTERACTIVE', 'false');
    vi.stubEnv('TERM', 'xterm');
    const inputListeners = stdin.listenerCount('readable');
    run.mockRejectedValueOnce(new Error('workflow failed'));
    const selected: CommandRequest = {
      ...request,
      options: { nonInteractive: false },
    };

    const captured = await captureExecution({ request: selected });

    expect({
      stdout: captured.stdout,
      failed: captured.stderr.includes('workflow failed'),
      exitCode: captured.exitCode,
      inputListeners: stdin.listenerCount('readable'),
    }).toEqual({
      stdout: '',
      failed: true,
      exitCode: 1,
      inputListeners,
    });
  });

  it('should replace a late success with a truthful cancellation', async () => {
    const controller = new AbortController();
    cancellation.mockImplementationOnce((): CommandCancellation => ({
      signal: controller.signal,
      cancel: () => controller.abort(),
      interrupt: () => controller.abort(),
      dispose: disposeCancellation,
    }));
    run.mockImplementationOnce(async () => {
      controller.abort();

      return success;
    });

    const captured = await captureExecution({ request });

    expect({
      stdout: captured.stdout,
      stderr: captured.stderr,
      exitCode: captured.exitCode,
    }).toEqual({
      stdout: '',
      stderr: expect.stringContaining('Cancelled by user'),
      exitCode: 130,
    });
  });

  it('should emit one forced cancellation while a command is active', async () => {
    let force = (): void => {
      throw new Error('Force callback was not installed');
    };
    cancellation.mockImplementationOnce(({ onForce }): CommandCancellation => {
      force = onForce;
      const controller = new AbortController();

      return {
        signal: controller.signal,
        cancel: () => controller.abort(),
        interrupt: () => controller.abort(),
        dispose: disposeCancellation,
      };
    });
    run.mockImplementationOnce(async () => {
      force();
      force();

      return success;
    });

    const captured = await captureExecution({ request });

    expect({
      stdout: captured.stdout,
      cancellations: captured.stderr.split('Forced interruption').length - 1,
      exitCode: captured.exitCode,
      state: captured.state,
    }).toEqual({
      stdout: '',
      cancellations: 1,
      exitCode: 130,
      state: { command: 'list', emitted: true, errors: [] },
    });
  });

  it('should retain the selected workstation in cancellation recovery', async () => {
    const controller = new AbortController();
    cancellation.mockImplementationOnce((): CommandCancellation => ({
      signal: controller.signal,
      cancel: () => controller.abort(),
      interrupt: () => controller.abort(),
      dispose: disposeCancellation,
    }));
    run.mockImplementationOnce(async () => {
      controller.abort();

      return {
        command: 'show',
        ok: true,
        data: {
          machine: {
            id: 'machine-1',
            name: 'dev-box',
            organization: 'example',
            state: 'running',
            setup: 'ready',
            readiness: 'not inspected',
          },
        },
      } satisfies CommandResult;
    });
    const selected: CommandRequest = {
      command: 'show',
      machine: 'dev-box',
      options: request.options,
    };

    const captured = await captureExecution({ request: selected });

    expect({
      stdout: captured.stdout,
      stderr: captured.stderr,
      exitCode: captured.exitCode,
    }).toEqual({
      stdout: '',
      stderr: expect.stringContaining(
        'Workstation: dev-box\n  Inspect provider state before retrying any mutation.\n  Inspect: open-agent show "dev-box" --inspect\n',
      ),
      exitCode: 130,
    });
  });

  it('should observe a real session disposal failure after a forced interrupt', async () => {
    vi.stubEnv('CI', 'false');
    vi.stubEnv('NON_INTERACTIVE', 'false');
    vi.stubEnv('TERM', 'xterm');
    const failure = new Error('terminal output failed');
    let force = (): void => {
      throw new Error('Force callback was not installed');
    };
    cancellation.mockImplementationOnce(({ onForce }): CommandCancellation => {
      force = onForce;
      const controller = new AbortController();

      return {
        signal: controller.signal,
        cancel: () => controller.abort(),
        interrupt: () => controller.abort(),
        dispose: disposeCancellation,
      };
    });
    let flushes = 0;
    stderrWrite.mockImplementation((chunk) => {
      if (chunk === '' && ++flushes === 2) {
        throw failure;
      }
    });
    run.mockImplementationOnce(async () => {
      force();
      force();

      return success;
    });
    const selected: CommandRequest = {
      ...request,
      options: { nonInteractive: false },
    };

    await expect(captureExecution({ request: selected })).rejects.toEqual(
      failure,
    );
  });

  it('should leave final output unchanged if force arrives during its write', async () => {
    let force = (): void => {
      throw new Error('Force callback was not installed');
    };
    const observedForce = vi.fn<() => void>(() => undefined);
    cancellation.mockImplementationOnce(({ onForce }): CommandCancellation => {
      force = () => {
        observedForce();
        onForce();
      };
      const controller = new AbortController();

      return {
        signal: controller.signal,
        cancel: () => controller.abort(),
        interrupt: () => controller.abort(),
        dispose: disposeCancellation,
      };
    });

    stdoutWrite.mockImplementation((chunk) => {
      if (chunk !== '') {
        force();
      }
    });
    const captured = await captureExecution({ request });

    expect({
      stdout: captured.stdout,
      stderr: captured.stderr,
      exitCode: captured.exitCode,
      state: captured.state,
    }).toEqual({
      stdout: EMPTY_LIST_OUTPUT,
      stderr: STAGE_LINES_ONLY,
      exitCode: 0,
      state: { command: 'list', emitted: true, errors: [] },
    });
    expect(observedForce.mock.calls).toEqual([[]]);
  });
});
