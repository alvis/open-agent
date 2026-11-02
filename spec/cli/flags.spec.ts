import { buildApplication, buildCommand, run } from '@stricli/core';
import { describe, expect, it } from 'vitest';

import {
  consentFlags,
  outputFlags,
  providerCredentialFlags,
  selectionFlags,
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
  ...providerCredentialFlags,
  ...outputFlags,
  ...consentFlags,
  ...selectionFlags,
};

describe('selection flags', () => {
  it('should preserve an explicit network choice', async () => {
    const parsed = await parseFlags(['--network', 'none']);

    expect(parsed).toEqual(
      expect.objectContaining({
        options: [expect.objectContaining({ network: 'none' })],
        diagnostics: [],
        exitCode: 0,
      }),
    );
  });

  it('should reject unknown network values before a command handler runs', async () => {
    const parsed = await parseFlags(['--network', 'unsupported']);

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
