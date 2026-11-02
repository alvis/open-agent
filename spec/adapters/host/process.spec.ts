import { describe, expect, it, vi } from 'vitest';

import { runLocal } from '#adapters/host/process';
import { OperationContext, withOperation } from '#kernel/operation';

import type { Options, Result, ResultPromise } from 'execa';

const { execa } = vi.hoisted(() => ({
  execa: vi.fn<
    (
      program: string,
      args: readonly string[],
      options?: Options,
    ) => ResultPromise
  >(
    (): ResultPromise =>
      Promise.resolve({
        exitCode: 0,
        stdout: '  generated output\n',
      } satisfies Partial<Result> as Result) as ResultPromise,
  ),
}));

vi.mock('execa', () => {
  return {
    execa: execa as typeof execa & typeof import('execa').execa,
  } satisfies Partial<typeof import('execa')>;
});

describe('fn:runLocal', () => {
  it('should trim output for unscoped execution', async () => {
    const output = await runLocal({
      program: 'generated-program',
      arguments: ['status'],
    });

    expect(output).toBe('generated output');
    expect(execa.mock.calls).toEqual([
      [
        'generated-program',
        ['status'],
        {
          timeout: 15_000,
          cancelSignal: undefined,
          stdin: 'ignore',
          stderr: 'pipe',
          stdout: 'pipe',
          reject: false,
        },
      ],
    ]);
  });

  it('should keep the caller timeout inside an operation', async () => {
    const context = new OperationContext({
      signal: new AbortController().signal,
    });

    const output = await withOperation(context, async () =>
      runLocal({
        program: 'generated-program',
        arguments: [],
        timeoutMs: 100,
      }),
    );

    expect(output).toBe('generated output');
    expect(execa.mock.calls).toEqual([
      [
        'generated-program',
        [],
        expect.objectContaining({ timeout: 100, cancelSignal: context.signal }),
      ],
    ]);
  });

  it.each([
    { name: 'exit', result: { exitCode: 2 }, reason: '(2)' },
    { name: 'timeout', result: {}, reason: '(timeout)' },
  ])(
    'should reject a process $name without returning its output',
    async ({ result, reason }) => {
      execa.mockReturnValueOnce(
        Promise.resolve(
          result satisfies Partial<Result> as Result,
        ) as ResultPromise,
      );

      await expect(
        runLocal({ program: 'generated-program', arguments: [] }),
      ).rejects.toEqual(
        expect.objectContaining({ message: expect.stringContaining(reason) }),
      );
    },
  );
});
