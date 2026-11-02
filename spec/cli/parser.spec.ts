import { stdout } from 'node:process';

import {
  buildApplication,
  buildCommand,
  buildRouteMap,
  FlagNotFoundError,
} from '@stricli/core';
import { describe, expect, it, vi } from 'vitest';

import {
  applicationText,
  parseApplication,
  requestedCommand,
} from '#cli/parser';

import { dependencies } from '../mocks/dependencies';

import type { Application } from '@stricli/core';

import type { ExecutionState, InvocationContext } from '#cli/parser';

interface ParsedCreate {
  name?: string;
}

vi.mock('@stricli/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@stricli/core')>();

  const run: typeof actual.run = async (application, inputs, context) => {
    await runnerControl();

    return actual.run(application, inputs, context);
  };

  return {
    ...actual,
    run,
  } satisfies Partial<typeof import('@stricli/core')>;
});

const runnerControl = vi.hoisted(() =>
  vi.fn<() => ReturnType<(typeof import('@stricli/core'))['run']>>(
    async () => undefined,
  ),
);

/**
 * builds a create route through the production parser hooks
 * @param state invocation-local parser diagnostics
 * @param parsed receives the flags the command handler observed
 * @returns application with one value-taking flag
 */
function createApplication(
  state: ExecutionState,
  parsed: ParsedCreate[],
): Application<InvocationContext> {
  return buildApplication(
    buildRouteMap({
      routes: {
        create: buildCommand({
          parameters: {
            flags: {
              name: {
                kind: 'parsed',
                parse: String,
                optional: true,
                brief: 'NAME · workstation name',
              },
            },
          },
          docs: { brief: 'create a workstation' },
          /**
           * records the flags the scanner delivered
           * @param flags parsed create flags
           */
          func(this: InvocationContext, flags: ParsedCreate): void {
            parsed.push(flags);
          },
        }),
      },
      docs: { brief: 'parser fixture' },
    }),
    {
      name: 'open-agent',
      localization: { text: applicationText(state) },
      scanner: { caseStyle: 'allow-kebab-for-camel' },
    },
  );
}

/**
 * parses one invocation through the production parser
 * @param argv command-line arguments after the executable name
 * @returns observed flags and parser diagnostics
 */
async function parse(
  argv: string[],
): Promise<{ parsed: ParsedCreate[]; state: ExecutionState }> {
  const parsed: ParsedCreate[] = [];
  const state: ExecutionState = { emitted: false, command: null, errors: [] };
  await parseApplication({
    application: createApplication(state, parsed),
    argv,
    context: { state, dependencies },
  });

  return { parsed, state };
}

describe('fn:parseApplication', () => {
  it('should reject double negation before scanning', async () => {
    const { parsed, state } = await parse(['create', '--no-no-yes']);

    expect(parsed).toEqual([]);
    expect(state.errors).toEqual([
      {
        code: 'USAGE',
        message: expect.stringContaining('--no-no-yes is invalid'),
      },
    ]);
  });

  it('should report an unknown flag as a usage error', async () => {
    const { parsed, state } = await parse(['create', '--nme']);

    expect(parsed).toEqual([]);
    expect(state.errors).toEqual([expect.objectContaining({ code: 'USAGE' })]);
    expect(state.errors[0]?.message).toContain('--nme');
  });

  it('should show root help for an empty invocation', async () => {
    let output = '';
    vi.spyOn(stdout, 'write').mockImplementation((chunk) => {
      output += String(chunk);

      return true;
    });
    const { state } = await parse([]);

    expect(state.errors).toEqual([]);
    expect(output).toContain('create');
  });

  it('should stop flag validation at the argument separator', async () => {
    const { state } = await parse(['create', '--', '--no-no-yes']);

    expect(state.errors).toEqual([expect.objectContaining({ code: 'USAGE' })]);
    expect(state.errors[0]?.message).not.toContain('is invalid');
  });

  it('should suppress incidental command writes to the parser stdout stream', async () => {
    const state: ExecutionState = { emitted: false, command: null, errors: [] };
    using writing = vi.spyOn(stdout, 'write').mockImplementation(() => true);
    const application = buildApplication(
      buildRouteMap({
        routes: {
          create: buildCommand({
            parameters: {},
            docs: { brief: 'stdout fixture' },
            func(this: InvocationContext): void {
              this.process.stdout.write('incidental command output');
            },
          }),
        },
        docs: { brief: 'stdout fixture' },
      }),
      { name: 'open-agent' },
    );

    await parseApplication({
      application,
      argv: ['create'],
      context: { state, dependencies },
    });

    expect(state.errors).toEqual([]);
    expect(writing).not.toHaveBeenCalled();
  });

  it('should record an external runner rejection without printing a stack', async () => {
    let output = '';
    vi.spyOn(stdout, 'write').mockImplementation((chunk) => {
      output += String(chunk);

      return true;
    });
    runnerControl.mockRejectedValueOnce(new Error('external runner failed'));

    const { parsed, state } = await parse(['create']);

    expect({ parsed, errors: state.errors, output }).toEqual({
      parsed: [],
      errors: [{ code: 'UNEXPECTED', message: 'external runner failed' }],
      output: '',
    });
  });
});

describe('fn:requestedCommand', () => {
  it.each(['create'] as const)(
    'should recognize %s as a command',
    (command) => {
      expect(requestedCommand([command])).toBe(command);
    },
  );

  it('should leave unrecognized input without an invented command', () => {
    expect(requestedCommand(['unsupported'])).toBeNull();
    expect(requestedCommand([])).toBeNull();
  });
});

describe('fn:applicationText', () => {
  it('should convert parser suggestions into accepted kebab-case flags', () => {
    const state: ExecutionState = { emitted: false, command: null, errors: [] };
    const text = applicationText(state);

    expect(
      text.exceptionWhileParsingArguments(
        new FlagNotFoundError('nonInteractiv', [
          'nonInteractive',
          'credentialFile',
        ]),
        false,
      ),
    ).toBe('');
    expect(state.errors).toEqual([
      {
        code: 'USAGE',
        message: expect.stringContaining(
          '--non-interactive or --credential-file',
        ),
      },
    ]);
  });

  it('should preserve an alias configuration error without suggesting user flags', () => {
    const state: ExecutionState = { emitted: false, command: null, errors: [] };
    const error = new FlagNotFoundError('x', ['nonInteractive'], 'x');

    expect(
      applicationText(state).exceptionWhileParsingArguments(error, false),
    ).toBe('');
    expect(state.errors).toEqual([{ code: 'USAGE', message: error.message }]);
  });

  it('should classify non-scanner parsing exceptions as unexpected', () => {
    const state: ExecutionState = { emitted: false, command: null, errors: [] };

    expect(
      applicationText(state).exceptionWhileParsingArguments(
        new Error('parser broke'),
        false,
      ),
    ).toBe('');
    expect(state.errors).toMatchObject([
      { code: 'UNEXPECTED', message: 'parser broke' },
    ]);
  });

  it('should record failures from integration hooks and flags', () => {
    const state: ExecutionState = { emitted: false, command: null, errors: [] };
    const text = applicationText(state);

    expect(
      text.exceptionWhileRunningIntegrationHook({
        exception: new Error('hook failed'),
        hook: 'beforeCommand',
        integration: 'fixture',
        ansiColor: false,
      }),
    ).toBe('');
    expect(
      text.exceptionWhileRunningIntegrationFlag({
        exception: new Error('flag failed'),
        integration: 'fixture',
        ansiColor: false,
      }),
    ).toBe('');
    expect(state.errors).toMatchObject([
      { code: 'UNEXPECTED', message: 'hook failed' },
      { code: 'UNEXPECTED', message: 'flag failed' },
    ]);
  });

  it('should format a caught exception without exposing a stack', () => {
    const state: ExecutionState = { emitted: false, command: null, errors: [] };

    expect(
      applicationText(state).formatException?.(new Error('parser failed')),
    ).toBe('parser failed');
    expect(state.errors).toEqual([]);
  });
});
