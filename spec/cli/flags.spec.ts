import { buildApplication, buildCommand, run } from '@stricli/core';
import { describe, expect, it } from 'vitest';

import {
  commonFlags,
  consentFlags,
  pairingFlags,
  selectionFlags,
  setupFlags,
} from '#cli/flags';

import type { StricliProcess } from '@stricli/core';

import type { CommandOptions } from '#application/contracts';

type ParserOptions = {
  [
    Key in keyof typeof parserFlags & keyof CommandOptions
  ]: (typeof parserFlags)[Key] extends {
    optional: true;
  }
    ? CommandOptions[Key]
    : NonNullable<CommandOptions[Key]>;
};

const parserFlags = {
  ...commonFlags,
  ...consentFlags,
  ...pairingFlags,
  ...selectionFlags,
  ...setupFlags,
};

describe('cmd:setup', () => {
  it.each([
    ['color', 'color'],
    ['local-credentials', 'localCredentials'],
  ] as const)(
    'should preserve omitted, positive and negative values for --%s',
    async (flag, property) => {
      const omitted = await parseFlags([]);
      const enabled = await parseFlags([`--${flag}`]);
      const disabled = await parseFlags([`--no-${flag}`]);

      expect(omitted.options[0]).toHaveProperty(property, undefined);
      expect(enabled.options[0]).toHaveProperty(property, true);
      expect(disabled.options[0]).toHaveProperty(property, false);
      expect([omitted.exitCode, enabled.exitCode, disabled.exitCode]).toEqual([
        0, 0, 0,
      ]);
      expect([
        omitted.diagnostics,
        enabled.diagnostics,
        disabled.diagnostics,
      ]).toEqual([[], [], []]);
    },
  );

  it('should accept only the positive explicit pairing request', async () => {
    const omitted = await parseFlags([]);
    const requested = await parseFlags(['--with-pair-code']);

    expect(omitted.options[0]).toHaveProperty('withPairCode', undefined);
    expect(requested.options[0]).toHaveProperty('withPairCode', true);
    expect(requested.exitCode).toBe(0);
  });

  it('should parse a network choice with a setup section', async () => {
    const parsed = await parseFlags(['--network', 'none', '--section', 'all']);

    expect(parsed).toEqual(
      expect.objectContaining({
        options: [
          expect.objectContaining({
            network: 'none',
            section: 'all',
          }),
        ],
        diagnostics: [],
        exitCode: 0,
      }),
    );
  });

  it('should parse a signed whole-number flag and reject fractional flag text', async () => {
    const accepted = await parseFlags(['--idle-minutes', ' -2 ']);
    const rejected = await parseFlags(['--idle-minutes', '1.5']);

    expect(accepted).toMatchObject({
      options: [expect.objectContaining({ idleMinutes: -2 })],
      diagnostics: [],
      exitCode: 0,
    });
    expect(rejected).toMatchObject({
      options: [],
      diagnostics: expect.arrayContaining([
        expect.stringContaining('whole number'),
      ]),
    });
    expect(rejected.exitCode).not.toBe(0);
  });

  it('should reject unknown section values before a command handler runs', async () => {
    const parsed = await parseFlags(['--section', 'unsupported']);

    expect(parsed.options).toEqual([]);
    expect(parsed.exitCode).not.toBe(0);
    expect(parsed.diagnostics.length).toBeGreaterThan(0);
  });
});

/**
 * consumes production flags through the real Stricli scanner
 * @param argv command-line flags to parse
 * @returns parsed behavior and scanner diagnostics
 */
async function parseFlags(argv: string[]): Promise<{
  options: CommandOptions[];
  diagnostics: string[];
  exitCode: StricliProcess['exitCode'];
}> {
  const options: CommandOptions[] = [];
  const diagnostics: string[] = [];
  const parserProcess: StricliProcess = {
    stdout: {
      write: (text: string): void => {
        diagnostics.push(text);
      },
    },
    stderr: {
      write: (text: string): void => {
        diagnostics.push(text);
      },
    },
  };
  const context = { process: parserProcess };
  const application = buildApplication(
    buildCommand({
      parameters: {
        flags: parserFlags,
      },
      docs: { brief: 'parse workstation setup inputs' },
      func: (flags: ParserOptions): void => {
        options.push(flags);
      },
    }),
    { name: 'open-agent', scanner: { caseStyle: 'allow-kebab-for-camel' } },
  );

  await run(application, argv, context);

  return { options, diagnostics, exitCode: parserProcess.exitCode };
}
