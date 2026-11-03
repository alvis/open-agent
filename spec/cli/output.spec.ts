import { PassThrough } from 'node:stream';

import { describe, expect, it } from 'vitest';

import { commandError } from '#application/failures';
import { resolveSecret } from '#application/input/sources';
import { prepareResult, writePreparedResult } from '#cli/output';

import { environmentOf } from '../fixtures/environment';
import { DISABLED_NETWORK_PROFILE } from '../fixtures/profile';

import { dependencies } from '../mocks/dependencies';

import type { CreateData } from '#application/data';
import type { MachineSummary } from '#application/machine';
import type { CommandResult } from '#application/result';
import type { GuestInspection } from '#domain/observations/inspection';

const machine: MachineSummary = {
  id: 'sprite-primary',
  name: 'primary',
  organization: 'example',
  state: 'running',
  setup: 'ready',
  readiness: 'not inspected',
};

const inspection: GuestInspection = {
  services: [],
  network: {
    online: false,
    skipped: true,
    reason: 'No private network is selected',
  },
  native: {
    claude: {
      authentication: 'not-configured',
    },
    harnesses: {
      claude: {
        evidence: undefined,
      },
    },
  },
  environment: environmentOf(DISABLED_NETWORK_PROFILE),
  probeFailures: [],
};

/**
 * a successful create result over the shared machine and inspection
 * @param overrides fields that differ from the default creation
 * @returns the create result
 */
function created(overrides: Partial<CreateData> = {}): CommandResult {
  return {
    command: 'create',
    ok: true,
    data: {
      machine,
      preflight: { checks: [], reminders: [] },
      profile: DISABLED_NETWORK_PROFILE,
      readiness: { ready: true, failures: [], skipped: [], probeFailures: [] },
      network: inspection.network,
      services: [],
      native: inspection.native,
      ...overrides,
    },
  };
}

/**
 * captures writes to the real output stream seam
 * @param result completed command result
 * @returns text written to each channel
 */
function captureResult(result: CommandResult): {
  stdout: string;
  stderr: string;
} {
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  let out = '';
  let errorOutput = '';
  stdout.on('data', (chunk: Buffer) => {
    out += chunk.toString();
  });
  stderr.on('data', (chunk: Buffer) => {
    errorOutput += chunk.toString();
  });
  try {
    const streams = { stdout, stderr };
    writePreparedResult(prepareResult({ result, streams }), streams);
  } finally {
    stdout.destroy();
    stderr.destroy();
  }

  return { stdout: out, stderr: errorOutput };
}

describe('fn:prepareResult', () => {
  it('should render workstation details when the terminal does not report its width', () => {
    const result = created({
      machine: { ...machine, name: 'missing-width-workstation' },
    });
    const streams = {
      stdout: Object.assign(new PassThrough(), { isTTY: true }),
      stderr: new PassThrough(),
    };
    try {
      const prepared = prepareResult({ result, streams });

      expect(prepared).toEqual({
        channel: 'stdout',
        text: expect.stringContaining('missing-width-workstation'),
      });
    } finally {
      streams.stdout.destroy();
      streams.stderr.destroy();
    }
  });

  it('should show disabled checks from a typed inspection on stdout', () => {
    const output = captureResult(created());

    expect(output.stdout).toContain('No private network is selected');
    expect(output.stderr).toBe('');
  });

  it('should write a human cancellation only to stderr', () => {
    const output = captureResult({
      command: 'create',
      ok: false,
      error: { code: 'CANCELLED', message: 'Creation was cancelled' },
    });

    expect(output).toEqual({
      stdout: '',
      stderr: 'Creation was cancelled\n',
    });
  });

  it('should redact a resolved value in nested results and non-Error failures', async () => {
    const secret = await resolveSecret(
      dependencies,
      undefined,
      'saf08-nested-output-secret',
    );
    const success = created({
      network: {
        ...inspection.network,
        reason: `the network rejected ${secret} twice: ${secret}`,
      },
    });
    const failure: CommandResult = {
      command: 'create',
      ok: false,
      error: {
        ...commandError(`provider rejected ${secret}`),
        details: [`retry without ${secret}`],
      },
    };

    const nested = captureResult(success);
    const rejected = captureResult(failure);
    const successText = `${nested.stdout}${nested.stderr}`;
    const failureText = `${rejected.stdout}${rejected.stderr}`;

    expect(successText).toContain('[REDACTED]');
    expect(successText).not.toContain(secret);
    expect(failureText).toContain('[REDACTED]');
    expect(failureText).not.toContain(secret);
    expect(rejected.stderr).toContain('retry without [REDACTED]');
  });
});
