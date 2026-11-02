import { PassThrough } from 'node:stream';

import { describe, expect, it, vi } from 'vitest';

import '../../fixtures/output/styling';

import { prepareResult, writePreparedResult } from '#cli/output';
import { rememberSecret } from '#kernel/redaction';

import { CORPUS, CORPUS_SECRETS } from '../../fixtures/output/corpus';

import type { CommandResult } from '#application/result';
import type { PreparedResult } from '#cli/output';

import type { CorpusCase } from '../../fixtures/output/corpus';

type Variant = 'human-pipe' | 'tty-80' | 'tty-120';

/** one corpus entry rendered one way */
interface OutputCase {
  name: string;
  variant: Variant;
  entry: CorpusCase;
}

/** every case renders piped and at both terminal widths */
const VARIANTS: Variant[] = ['human-pipe', 'tty-80', 'tty-120'];

/** the instant every relative-time rendering is measured from */
const FIXED_NOW = Date.parse('2026-10-09T00:12:00.000Z');

const CASES: OutputCase[] = CORPUS.flatMap((entry) =>
  VARIANTS.map((variant) => ({
    name: `${entry.name}.${variant}`,
    variant,
    entry,
  })),
);

for (const secret of CORPUS_SECRETS) {
  rememberSecret(secret);
}

describe('fn:prepareResult', () => {
  it.each(CASES)(
    'should render and emit $name through its supported output channel',
    ({ variant, entry }) => {
      const prepared = prepare(entry, variant);
      const output = captureWrites(prepared);

      expect(output).toEqual({
        stdout: prepared.channel === 'stdout' ? prepared.text : '',
        stderr: prepared.channel === 'stderr' ? prepared.text : '',
      });
      for (const secret of CORPUS_SECRETS) {
        expect(`${output.stdout}${output.stderr}`).not.toContain(secret);
      }

      expectHumanOutput(entry, prepared);
    },
  );
});

/**
 * renders one case through the real output preparation
 * @param entry corpus case
 * @param variant stream shape
 * @returns what would be written, and where
 */
function prepare(entry: CorpusCase, variant: Variant): PreparedResult {
  const columns = variant === 'tty-80' ? 80 : 120;
  const isTTY = variant.startsWith('tty');
  const streams = {
    stdout: Object.assign(new PassThrough(), isTTY ? { isTTY, columns } : {}),
    stderr: Object.assign(new PassThrough(), isTTY ? { isTTY, columns } : {}),
  };
  vi.useFakeTimers({ toFake: ['Date'], now: FIXED_NOW });
  try {
    return prepareResult({ result: entry.result, streams });
  } finally {
    vi.useRealTimers();
    streams.stdout.destroy();
    streams.stderr.destroy();
  }
}

/**
 * records both streams after writing a prepared result
 * @param prepared output to emit
 * @returns text written to each channel
 */
function captureWrites(prepared: PreparedResult): {
  stdout: string;
  stderr: string;
} {
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  const streams = { stdout, stderr };
  let output = '';
  let errorOutput = '';
  stdout.on('data', (chunk: Buffer) => {
    output += chunk.toString();
  });
  stderr.on('data', (chunk: Buffer) => {
    errorOutput += chunk.toString();
  });
  try {
    writePreparedResult(prepared, streams);
  } finally {
    stdout.destroy();
    stderr.destroy();
  }

  return { stdout: output, stderr: errorOutput };
}

/**
 * checks the human channel and whether there is visible content
 * @param entry input result
 * @param prepared rendered result
 */
function expectHumanOutput(entry: CorpusCase, prepared: PreparedResult): void {
  expect(prepared).toEqual({
    channel: entry.result.ok ? 'stdout' : 'stderr',
    text: expect.any(String),
  });
  expect(prepared.text.trim().length).toBeGreaterThan(0);
  if (!entry.result.ok) {
    expectHumanFailure(entry.result.error, prepared.text);
  }
}

/**
 * checks recoverable identity and setup status on the failure stream
 * @param error failed command error
 * @param text rendered failure stream
 */
function expectHumanFailure(
  error: Extract<CommandResult, { ok: false }>['error'],
  text: string,
): void {
  if (error.machine) {
    expect(text).toContain(
      containsSecret(error.machine) ? '[REDACTED]' : error.machine,
    );
  }
  if (error.machineId) {
    expect(text).toContain(
      containsSecret(error.machineId) ? '[REDACTED]' : error.machineId,
    );
  }
  if (error.setupIncomplete) {
    expect(text).toMatch(/setup.*incomplete/iu);
  }
}

/**
 * whether an input field contains a registered secret
 * @param value input field
 */
function containsSecret(value: string): boolean {
  return CORPUS_SECRETS.some((secret) => value.includes(secret));
}
