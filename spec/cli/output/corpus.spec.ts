import { PassThrough } from 'node:stream';

import { describe, expect, it, vi } from 'vitest';

import '../../fixtures/output/styling';

import { prepareResult, writePreparedResult } from '#cli/output';
import { rememberSecret } from '#kernel/redaction';

import { CORPUS, CORPUS_SECRETS } from '../../fixtures/output/corpus';

import type { CommandResult } from '#application/result';
import type { PreparedResult } from '#cli/output';

import type { CorpusCase } from '../../fixtures/output/corpus';

type Variant = 'human-pipe' | 'tsv' | 'tty-80' | 'tty-120';

/** one corpus entry rendered one way */
interface OutputCase {
  name: string;
  variant: Variant;
  entry: CorpusCase;
}

/** the instant every relative-time rendering is measured from */
const FIXED_NOW = Date.parse('2026-10-09T00:12:00.000Z');

const CASES: OutputCase[] = CORPUS.flatMap((entry) =>
  variantsOf(entry).map((variant) => ({
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
        stderr:
          (prepared.channel === 'stderr' ? prepared.text : '') +
          (prepared.notes ?? ''),
      });
      for (const secret of CORPUS_SECRETS) {
        expect(`${output.stdout}${output.stderr}`).not.toContain(secret);
      }

      if (variant === 'tsv') {
        expectTsvOutput(entry, prepared);
      } else {
        expectHumanOutput(entry, prepared);
      }
    },
  );
});

/**
 * chooses how a case is rendered
 * @param entry corpus case
 * @returns the piped form and both terminal widths
 */
function variantsOf(entry: CorpusCase): Variant[] {
  const { result } = entry;
  const piped = result.ok && result.command === 'list' ? 'tsv' : 'human-pipe';

  return [piped, 'tty-80', 'tty-120'];
}

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
 * checks exact ordinary TSV cells in column order, redacted secret cells, and notes
 * @param entry input result
 * @param prepared rendered result
 */
function expectTsvOutput(entry: CorpusCase, prepared: PreparedResult): void {
  if (!entry.result.ok || entry.result.command !== 'list') {
    throw new Error('TSV cases require a successful list result');
  }
  const { machines, unavailable } = entry.result.data;
  const rows = prepared.text === '' ? [] : prepared.text.trimEnd().split('\n');

  expect(prepared.channel).toBe('stdout');
  const expectedRows = machines.map((machine) =>
    [
      machine.name,
      machine.id,
      machine.state,
      machine.createdAt ?? '',
      machine.agentUrl ?? '',
      machine.setup,
      machine.organization,
      machine.provider,
    ].map((value) => {
      if (typeof value === 'string' && containsSecret(value)) {
        return expect.stringContaining('[REDACTED]');
      }

      return typeof value === 'string' && !containsControlCharacter(value)
        ? value
        : expect.any(String);
    }),
  );

  expect(rows.map((row) => row.split('\t'))).toEqual(expectedRows);
  expect(Boolean(prepared.notes)).toBe(
    unavailable.length > 0 ||
      machines.some(
        (machine) =>
          'newerRelease' in machine && typeof machine.newerRelease === 'string',
      ),
  );
  for (const provider of unavailable) {
    expect(prepared.notes).toContain(provider.provider);
  }
  expect(prepared.text).not.toContain('\r');
  expect(prepared.text).not.toContain('\u001b');
  expect(prepared.text).not.toContain('\u009b');
}

/**
 * checks the human channel and whether there is visible content
 * @param entry input result
 * @param prepared rendered result
 */
function expectHumanOutput(entry: CorpusCase, prepared: PreparedResult): void {
  expect(prepared).toEqual({
    channel: entry.result.ok ? 'stdout' : 'stderr',
    notes: undefined,
    text: expect.any(String),
  });
  const isEmptyList =
    entry.result.ok &&
    entry.result.command === 'list' &&
    entry.result.data.machines.length === 0 &&
    entry.result.data.unavailable.length === 0;

  if (isEmptyList) {
    expect(prepared.text.trim()).toBe('');
  } else {
    expect(prepared.text.trim().length).toBeGreaterThan(0);
  }
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
 * whether a field has delimiters or terminal controls requiring TSV escaping
 * @param value input field
 */
function containsControlCharacter(value: string): boolean {
  return ['\t', '\n', '\r', '\\', '\u001b', '\u009b'].some((character) =>
    value.includes(character),
  );
}

/**
 * whether an input field contains a registered secret
 * @param value input field
 */
function containsSecret(value: string): boolean {
  return CORPUS_SECRETS.some((secret) => value.includes(secret));
}
