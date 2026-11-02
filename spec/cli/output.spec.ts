import { PassThrough } from 'node:stream';

import { describe, expect, it } from 'vitest';

import { commandError } from '#application/failures';
import { resolveSecret } from '#application/input/sources';
import { prepareResult, writePreparedResult } from '#cli/output';

import { rememberSecret } from '#kernel/redaction';

import { environmentOf } from '../fixtures/environment';
import { DISABLED_NETWORK_PROFILE } from '../fixtures/profile';

import { dependencies } from '../mocks/dependencies';

import type { CreateData } from '#application/data';
import type { MachineSummary } from '#application/machine';
import type { CommandResult } from '#application/result';
import type { GuestInspection } from '#domain/observations/inspection';

const machine: MachineSummary & { provider: 'sprite' } = {
  provider: 'sprite',
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
  it('should retain a null workstation observation as a TSV row and leave nullable optional cells blank', () => {
    const observed = { ...machine, name: 'observed' };
    Reflect.set(observed, 'createdAt', null);
    const machines = [observed, { ...machine }];
    Reflect.set(machines, 1, null);

    const output = captureResult({
      command: 'list',
      ok: true,
      data: { machines, unavailable: [] },
    });

    expect(output).toEqual({
      stdout: `${[
        [
          'observed',
          'sprite-primary',
          'running',
          '',
          '',
          'ready',
          'example',
          'sprite',
        ],
        ['null', '', '', '', '', '', '', ''],
      ]
        .map((row) => row.join('\t'))
        .join('\n')}\n`,
      stderr: '',
    });
  });

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

  it('should prepare and writes headerless pipe TSV in workstation column order with blank optional fields', () => {
    const stdout = new PassThrough();
    const stderr = new PassThrough();
    const streams = { stdout, stderr };
    let out = '';
    let errorOutput = '';
    stdout.on('data', (chunk: Buffer) => {
      out += chunk.toString();
    });
    stderr.on('data', (chunk: Buffer) => {
      errorOutput += chunk.toString();
    });
    const result: CommandResult = {
      command: 'list',
      ok: true,
      data: {
        unavailable: [],
        machines: [
          {
            ...machine,
            name: 'alpha',
            id: 'sprite-alpha',
            createdAt: '2026-10-09T12:00:00.000Z',
            agentUrl: 'https://alpha.sprites.app/',
            organization: 'org-one',
          },
          {
            ...machine,
            name: 'beta',
            id: 'sprite-beta',
            state: 'cold',
            setup: 'not recorded',
            organization: 'org-two',
          },
        ],
      },
    };
    const prepared = prepareResult({ result, streams });
    const expected =
      'alpha\tsprite-alpha\trunning\t2026-10-09T12:00:00.000Z\thttps://alpha.sprites.app/\tready\torg-one\tsprite\n' +
      'beta\tsprite-beta\tcold\t\t\tnot recorded\torg-two\tsprite\n';

    expect(prepared).toMatchObject({ channel: 'stdout', text: expected });
    writePreparedResult(prepared, streams);
    expect({ stdout: out, stderr: errorOutput }).toEqual({
      stdout: expected,
      stderr: '',
    });
    stdout.destroy();
    stderr.destroy();
  });

  it('should name each unavailable provider on stderr beside piped TSV rows', () => {
    const reason = 'the token was revoked';
    const output = captureResult({
      command: 'list',
      ok: true,
      data: {
        machines: [{ ...machine, name: 'alpha', id: 'sprite-alpha' }],
        unavailable: [{ provider: 'sprite', code: 'AUTH', reason }],
      },
    });

    expect(output).toEqual({
      stdout: 'alpha\tsprite-alpha\trunning\t\t\tready\texample\tsprite\n',
      stderr: `Unavailable provider sprite: ${reason}\n`,
    });
  });

  it('should emit no TSV row for an empty list', () => {
    const output = captureResult({
      command: 'list',
      ok: true,
      data: { machines: [], unavailable: [] },
    });

    expect(output).toEqual({ stdout: '', stderr: '' });
  });

  it('should escape delimiters and terminal controls after redacting pipe TSV fields', () => {
    const secret = 'generated-list-secret';
    rememberSecret(secret);
    const output = captureResult({
      command: 'list',
      ok: true,
      data: {
        unavailable: [],
        machines: [
          {
            ...machine,
            name: 'tab\tline\nslash\\tail',
            id: 'sprite-\u001b[31m',
            state: 'run\rring',
            agentUrl: `https://primary.sprites.app/#token=${secret}`,
            organization: 'org\u009b[0m',
          },
        ],
      },
    });
    const rows = output.stdout.split('\n');
    const columns = rows[0]!.split('\t');

    expect(output.stderr).toBe('');
    expect(rows).toHaveLength(2);
    expect(columns).toEqual([
      'tab\\tline\\nslash\\\\tail',
      'sprite-\\u001b[31m',
      'run\\rring',
      '',
      'https://primary.sprites.app/#token=[REDACTED]',
      'ready',
      'org\\u009b[0m',
      'sprite',
    ]);
    expect(output.stdout).not.toContain(secret);
    expect(output.stdout).not.toContain('\u001b');
    expect(output.stdout).not.toContain('\u009b');
  });

  it('should write a human list failure only to stderr', () => {
    const failure = captureResult({
      command: 'list',
      ok: false,
      error: { code: 'PROVIDER', message: 'List unavailable' },
    });

    expect(failure).toEqual({ stdout: '', stderr: 'List unavailable\n' });
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
