import { PassThrough } from 'node:stream';

import { describe, expect, it } from 'vitest';

import { commandError } from '#application/failures';
import { resolveSecret } from '#application/input/sources';
import { prepareResult, writePreparedResult } from '#cli/output';

import { rememberSecret } from '#kernel/redaction';

import { environmentOf } from '../fixtures/environment';
import { DISABLED_NETWORK_PROFILE } from '../fixtures/profile';

import { dependencies } from '../mocks/dependencies';

import type { CommandOptions } from '#application/contracts';
import type { CurrentReadiness } from '#application/data';
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
 * captures writes to the real output stream seam
 * @param result completed command result
 * @param options output controls
 * @returns text written to each channel
 */
function captureResult(
  result: CommandResult,
  options: CommandOptions,
): { stdout: string; stderr: string } {
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
    writePreparedResult(prepareResult({ result, options, streams }), streams);
  } finally {
    stdout.destroy();
    stderr.destroy();
  }

  return { stdout: out, stderr: errorOutput };
}

describe('fn:prepareResult', () => {
  it('should omit command data from a parser failure JSON envelope', () => {
    const result: CommandResult = {
      command: null,
      ok: false,
      error: { code: 'USAGE', message: 'unknown-command-observation' },
    };

    const prepared = prepareResult({ result, options: { json: true } });

    expect(JSON.parse(prepared.text)).toEqual({
      schemaVersion: 1,
      command: null,
      ok: false,
      error: result.error,
    });
  });

  it('should retain a null workstation observation as a TSV row and leave nullable optional cells blank', () => {
    const observed = { ...machine, name: 'observed' };
    Reflect.set(observed, 'createdAt', null);
    const machines = [observed, { ...machine }];
    Reflect.set(machines, 1, null);

    const output = captureResult(
      { command: 'list', ok: true, data: { machines, unavailable: [] } },
      {},
    );

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
    const result: CommandResult = {
      command: 'show',
      ok: true,
      data: { machine: { ...machine, name: 'missing-width-workstation' } },
    };
    const streams = {
      stdout: Object.assign(new PassThrough(), { isTTY: true }),
      stderr: new PassThrough(),
    };
    try {
      const prepared = prepareResult({ result, options: {}, streams });

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
    const prepared = prepareResult({ result, options: {}, streams });
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
    const output = captureResult(
      {
        command: 'list',
        ok: true,
        data: {
          machines: [{ ...machine, name: 'alpha', id: 'sprite-alpha' }],
          unavailable: [{ provider: 'sprite', code: 'AUTH', reason }],
        },
      },
      {},
    );

    expect(output).toEqual({
      stdout: 'alpha\tsprite-alpha\trunning\t\t\tready\texample\tsprite\n',
      stderr: `Unavailable provider sprite: ${reason}\n`,
    });
  });

  it('should emit no TSV row for an empty list', () => {
    const output = captureResult(
      { command: 'list', ok: true, data: { machines: [], unavailable: [] } },
      {},
    );

    expect(output).toEqual({ stdout: '', stderr: '' });
  });

  it('should preserve null, undefined, and sparse service positions as JSON nulls', () => {
    const services: GuestInspection['services'] = [
      { name: 'first', needs: [] },
      { name: 'undefined', needs: [] },
      { name: 'null', needs: [] },
      { name: 'hole', needs: [] },
    ];
    Reflect.set(services, 1, undefined);
    Reflect.set(services, 2, null);
    Reflect.deleteProperty(services, '3');

    const output = captureResult(
      {
        command: 'show',
        ok: true,
        data: { machine, inspection: { ...inspection, services } },
      },
      { json: true },
    );

    expect(output.stderr).toBe('');
    expect(JSON.parse(output.stdout).data.inspection.services).toEqual([
      { name: 'first', needs: [] },
      null,
      null,
      null,
    ]);
  });

  it('should escape delimiters and terminal controls after redacting pipe TSV fields', () => {
    const secret = 'generated-list-secret';
    rememberSecret(secret);
    const output = captureResult(
      {
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
      },
      {},
    );
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

  it('should keep JSON ahead of pipe TSV and human failures on stderr', () => {
    const json = captureResult(
      {
        command: 'list',
        ok: true,
        data: { machines: [machine], unavailable: [] },
      },
      { json: true },
    );
    const failure = captureResult(
      {
        command: 'list',
        ok: false,
        error: { code: 'PROVIDER', message: 'List unavailable' },
      },
      {},
    );

    expect(json.stderr).toBe('');
    expect(json.stdout.trim().split('\n')).toHaveLength(1);
    expect(JSON.parse(json.stdout)).toMatchObject({
      schemaVersion: 1,
      command: 'list',
      ok: true,
      data: { machines: [{ name: 'primary', id: 'sprite-primary' }] },
    });
    expect(failure).toEqual({ stdout: '', stderr: 'List unavailable\n' });
  });

  it('should render successful current readiness on stdout with a versioned JSON alternative', () => {
    const result: CommandResult = {
      command: 'doctor',
      ok: true,
      data: {
        machine,
        currentReadiness: {
          ready: true,
          failures: [],
          skipped: ['private network'],
          probeFailures: [],
          network: inspection.network,
          native: inspection.native,
          services: [{ name: 't3-code', state: 'running' }],
          environment: inspection.environment,
        },
      },
    };
    const human = captureResult(result, {});
    const json = captureResult(result, { json: true });

    expect(human.stdout).toContain('Ready: Yes');
    expect(human.stdout).toContain('private network');
    expect(human.stderr).toBe('');
    expect(json.stderr).toBe('');
    expect(JSON.parse(json.stdout)).toMatchObject({
      schemaVersion: 1,
      command: 'doctor',
      ok: true,
      data: { currentReadiness: { ready: true, failures: [] } },
    });
  });

  it('should show disabled checks from a typed inspection on stdout', () => {
    const output = captureResult(
      { command: 'show', ok: true, data: { machine, inspection } },
      {},
    );

    expect(output.stdout).toContain('No private network is selected');
    expect(output.stderr).toBe('');
  });

  it('should render failed readiness facts without executable service internals', () => {
    const currentReadiness: CurrentReadiness = {
      ready: false,
      failures: ['T3 environment endpoint'],
      skipped: [],
      probeFailures: [],
      services: [{ name: 't3-code', state: 'running' }],
      network: inspection.network,
      native: inspection.native,
      environment: inspection.environment,
    };
    const output = captureResult(
      {
        command: 'doctor',
        ok: false,
        error: { code: 'PREFLIGHT', message: 'Readiness check failed' },
        data: { machine: { ...machine, state: 'cold' }, currentReadiness },
      },
      {},
    );

    expect(output.stdout).toBe('');
    expect(output.stderr).toContain('Readiness check failed');
    expect(output.stderr).toContain('T3 environment endpoint');
  });

  it('should write a human cancellation only to stderr', () => {
    const output = captureResult(
      {
        command: 'terminate',
        ok: false,
        error: { code: 'CANCELLED', message: 'Typed name did not match' },
      },
      {},
    );

    expect(output).toEqual({
      stdout: '',
      stderr: 'Typed name did not match\n',
    });
  });

  it('should redact a resolved value in nested results and non-Error failures in both output modes', async () => {
    const secret = await resolveSecret(
      dependencies,
      undefined,
      'saf08-nested-output-secret',
    );
    const success: CommandResult = {
      command: 'show',
      ok: true,
      data: {
        machine,
        inspection: {
          ...inspection,
          network: {
            ...inspection.network,
            reason: `the network rejected ${secret} twice: ${secret}`,
          },
        },
      },
    };
    const failure: CommandResult = {
      command: 'show',
      ok: false,
      error: {
        ...commandError(`provider rejected ${secret}`),
        details: [`retry without ${secret}`],
      },
    };

    for (const options of [{}, { json: true }]) {
      const nested = captureResult(success, options);
      const rejected = captureResult(failure, options);
      const successText = `${nested.stdout}${nested.stderr}`;
      const failureText = `${rejected.stdout}${rejected.stderr}`;

      expect(successText).toContain('[REDACTED]');
      expect(successText).not.toContain(secret);
      expect(failureText).toContain('[REDACTED]');
      expect(failureText).not.toContain(secret);
      expect(options.json ? rejected.stdout : rejected.stderr).toContain(
        'retry without [REDACTED]',
      );
    }
  });

  it('should write one versioned JSON failure with typed readiness to stdout', () => {
    const output = captureResult(
      {
        command: 'doctor',
        ok: false,
        error: {
          code: 'PREFLIGHT',
          message: 'Readiness check failed',
          machine: 'primary',
          details: ['Inspect the T3 service'],
        },
        data: {
          machine,
          currentReadiness: {
            ready: false,
            failures: ['t3-service'],
            skipped: [],
            probeFailures: [],
            network: inspection.network,
            native: inspection.native,
            services: [],
            environment: inspection.environment,
          },
        },
      },
      { json: true },
    );

    expect(output.stderr).toBe('');
    expect(output.stdout.trim().split('\n')).toHaveLength(1);
    expect(JSON.parse(output.stdout)).toMatchObject({
      schemaVersion: 1,
      command: 'doctor',
      ok: false,
      error: { code: 'PREFLIGHT', machine: 'primary' },
      data: { currentReadiness: { ready: false, failures: ['t3-service'] } },
    });
  });
});
