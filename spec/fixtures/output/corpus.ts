import { environmentOf } from '../environment';
import { DISABLED_NETWORK_PROFILE } from '../profile';

import type { CreatePreflight } from '#application/create/context';
import type { MachineSummary } from '#application/machine';
import type { ReadinessAssessment } from '#application/readiness';
import type { CommandResult } from '#application/result';
import type { GuestInspection } from '#domain/observations/inspection';
import type { CommandErrorCode } from '#kernel/faults';

/** one characterized result */
export interface CorpusCase {
  /** unique kebab-case identity used in runtime contract test names */
  name: string;
  /** the completed result handed to the output layer */
  result: CommandResult;
}

/** a workstation of any provider as the list command reports it */
type ListedMachine = MachineSummary & {
  provider: 'sprite';
  newerRelease?: string;
};

/** credentials registered with the process before any result is rendered */
export const CORPUS_SECRETS = ['v1-golden-nested-secret'] as const;

const [NESTED_SECRET] = CORPUS_SECRETS;

const MACHINE: MachineSummary = {
  id: 'sprite-primary',
  name: 'primary',
  organization: 'example',
  state: 'running',
  setup: 'ready',
  readiness: 'not inspected',
};

const SPRITE_LISTED: ListedMachine = { ...MACHINE, provider: 'sprite' };

const PREFLIGHT: CreatePreflight = {
  checks: ['Provider token verified', 'Workstation name is available'],
  reminders: [
    'Claude Code uses native sign-in; configure their credentials on the guest before model work.',
  ],
};

const PASSING_READINESS: ReadinessAssessment = {
  ready: true,
  failures: [],
  skipped: ['private network'],
  probeFailures: [],
};

const FAILING_READINESS: ReadinessAssessment = {
  ready: false,
  failures: ['T3 environment endpoint', 'network inspection unavailable'],
  skipped: [],
  probeFailures: [{ probe: 'network', reason: 'network status timed out' }],
};

const INSPECTION: GuestInspection = {
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

const ERROR_CODES: readonly CommandErrorCode[] = [
  'USAGE',
  'INPUT',
  'AUTH',
  'PREFLIGHT',
  'CONFLICT',
  'PROVIDER',
  'CANCELLED',
  'UNEXPECTED',
];

export const CORPUS: readonly CorpusCase[] = [
  // create: success
  corpusCase('create-success-default', {
    command: 'create',
    ok: true,
    data: {
      machine: {
        ...MACHINE,
        agentUrl: 'https://primary.sprites.app/',
      },
      preflight: PREFLIGHT,
      profile: DISABLED_NETWORK_PROFILE,
      readiness: PASSING_READINESS,
      network: INSPECTION.network,
      services: [{ name: 't3-code', state: 'running' }],
      native: INSPECTION.native,
    },
  }),

  // create: failure
  corpusCase('create-failure-bare', {
    command: 'create',
    ok: false,
    error: {
      code: 'INPUT',
      message: 'Missing required input',
      details: ['--name is required with --non-interactive'],
    },
  }),
  corpusCase('create-failure-preflight-only', {
    command: 'create',
    ok: false,
    error: { code: 'PREFLIGHT', message: 'Provider token was rejected' },
    data: { preflight: PREFLIGHT },
  }),
  corpusCase('create-failure-readiness-withheld', {
    command: 'create',
    ok: false,
    error: {
      code: 'PREFLIGHT',
      message:
        'Current readiness failed (T3 environment endpoint); public exposure was withheld',
      machine: 'primary',
      machineId: 'sprite-primary',
    },
    data: { preflight: PREFLIGHT, readiness: FAILING_READINESS },
  }),
  corpusCase('create-failure-setup-recovery-confirmed', {
    command: 'create',
    ok: false,
    error: {
      code: 'PROVIDER',
      message: 'Setup stopped before it finished',
      machine: 'primary',
      machineId: 'sprite-primary',
      setupIncomplete: true,
      details: ['Workstation primary was retained.', 'Nothing was exposed'],
    },
    data: {
      preflight: PREFLIGHT,
      readiness: FAILING_READINESS,
      setup: 'ready',
      recovery: { privacy: 'confirmed', incompleteLabel: 'confirmed' },
    },
  }),
  corpusCase('create-failure-setup-recovery-unconfirmed', {
    command: 'create',
    ok: false,
    error: {
      code: 'PROVIDER',
      message: 'Could not confirm the workstation is private',
      machine: 'primary',
      setupIncomplete: true,
    },
    data: {
      preflight: { checks: PREFLIGHT.checks, reminders: [] },
      recovery: { privacy: 'unconfirmed', incompleteLabel: 'unconfirmed' },
    },
  }),

  // list
  corpusCase('list-populated', {
    command: 'list',
    ok: true,
    data: {
      unavailable: [],
      machines: [
        {
          ...SPRITE_LISTED,
          name: 'alpha',
          id: 'sprite-alpha',
          createdAt: '2026-10-09T12:00:00.000Z',
          agentUrl: 'https://alpha.sprites.app/',
          organization: 'org-one',
        },
        {
          ...SPRITE_LISTED,
          name: 'beta',
          id: 'sprite-beta',
          state: 'cold',
          createdAt: undefined,
          agentUrl: undefined,
          setup: 'not recorded',
          organization: 'org-two',
        },
      ],
    },
  }),
  corpusCase('list-unavailable-providers', {
    command: 'list',
    ok: true,
    data: {
      machines: [{ ...SPRITE_LISTED, name: 'alpha', id: 'sprite-alpha' }],
      unavailable: [
        { provider: 'sprite', code: 'AUTH', reason: 'the token was revoked' },
      ],
    },
  }),
  corpusCase('list-newer-release', {
    command: 'list',
    ok: true,
    data: {
      unavailable: [],
      machines: [
        {
          ...SPRITE_LISTED,
          name: 'future',
          id: 'sprite-future',
          newerRelease: '9.9.9',
        },
        { ...SPRITE_LISTED, name: 'current', id: 'sprite-current' },
      ],
    },
  }),
  corpusCase('list-empty', {
    command: 'list',
    ok: true,
    data: { machines: [], unavailable: [] },
  }),
  corpusCase('list-empty-unavailable', {
    command: 'list',
    ok: true,
    data: {
      machines: [],
      unavailable: [
        { provider: 'sprite', code: 'PROVIDER', reason: 'timed out' },
      ],
    },
  }),
  corpusCase('list-control-characters-and-secret', {
    command: 'list',
    ok: true,
    data: {
      unavailable: [],
      machines: [
        {
          ...SPRITE_LISTED,
          name: 'tab\tline\nslash\\tail',
          id: 'sprite-\u001b[31m',
          state: 'run\rring',
          createdAt: sdkObservation<string>(
            new Date('2026-10-09T12:00:00.000Z'),
          ),
          agentUrl: `https://primary.sprites.app/#token=${NESTED_SECRET}`,
          organization: 'org\u009b[0m',
        },
      ],
    },
  }),
  corpusCase('list-failure', {
    command: 'list',
    ok: false,
    error: { code: 'PROVIDER', message: 'List unavailable' },
  }),

  corpusCase('create-failure-secret-error', {
    command: 'create',
    ok: false,
    error: {
      code: 'PROVIDER',
      message: `provider rejected ${NESTED_SECRET}`,
      machine: `machine-${NESTED_SECRET}`,
      machineId: `id-${NESTED_SECRET}`,
      details: [`retry without ${NESTED_SECRET}`],
    },
  }),

  // parser failures and every error code
  corpusCase('parser-failure-usage', {
    command: null,
    ok: false,
    error: {
      code: 'USAGE',
      message: 'Unknown command "frobnicate"',
      details: ['Run open-agent --help for the commands'],
    },
  }),
  corpusCase('parser-failure-input', {
    command: null,
    ok: false,
    error: { code: 'INPUT', message: 'Invalid value for --network' },
  }),
  ...ERROR_CODES.map((code) =>
    corpusCase(`error-code-${code.toLowerCase()}`, {
      command: 'create',
      ok: false,
      error: {
        code,
        message: `The ${code} failure message`,
        machine: 'primary',
        machineId: 'sprite-primary',
        setupIncomplete: code === 'UNEXPECTED',
        details: [`${code} detail one`, `${code} detail two`],
      },
    }),
  ),

  // structural serialization
  corpusCase('serialization-date-and-undefined', {
    command: 'list',
    ok: true,
    data: {
      unavailable: [],
      machines: [
        {
          ...SPRITE_LISTED,
          name: 'dated',
          createdAt: sdkObservation<string>(
            new Date('2026-10-09T12:00:00.000Z'),
          ),
          agentUrl: undefined,
          profile: sdkObservation<MachineSummary['profile']>({
            provider: 'sprite',
            agent: 't3',
            harnesses: ['claude', undefined],
            network: 'none',
          }),
        },
      ],
    },
  }),
];

/**
 * names one characterized result
 * @param name unique kebab-case identity
 * @param result completed result
 * @returns the corpus entry
 */
function corpusCase(name: string, result: CommandResult): CorpusCase {
  return { name, result };
}

/**
 * passes a runtime value the types forbid, as an SDK observation can
 * @param value the observed value
 * @returns the value typed as the contract claims it is
 */
function sdkObservation<T>(value: unknown): T {
  return value as T;
}
