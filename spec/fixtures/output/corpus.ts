import { PairingSecret } from '#kernel/pairing-secret';

import { environmentOf } from '../environment';
import { DISABLED_NETWORK_PROFILE } from '../profile';

import type { CommandOptions } from '#application/contracts';
import type { CreatePreflight } from '#application/create/context';
import type { CurrentReadiness } from '#application/data';
import type { MachineSummary } from '#application/machine';
import type { ReadinessAssessment } from '#application/readiness';
import type { CommandResult } from '#application/result';
import type { GovernorState } from '#domain/observations/governor';
import type { GuestInspection } from '#domain/observations/inspection';
import type { UpdateStatus } from '#domain/observations/updates';
import type { CommandErrorCode } from '#kernel/faults';

/** one characterized result and the output controls it is rendered with */
export interface CorpusCase {
  /** unique kebab-case identity used in runtime contract test names */
  name: string;
  /** the completed result handed to the output layer */
  result: CommandResult;
  /** output controls other than `json`, which each variant decides */
  options: CommandOptions;
}

/** a workstation of any provider as the list command reports it */
type ListedMachine = MachineSummary & {
  provider: 'sprite';
  newerRelease?: string;
};

/** credentials registered with the process before any result is rendered */
export const CORPUS_SECRETS = [
  'v1-golden-nested-secret',
  'v1-golden-hidden-reason-secret',
] as const;

const [NESTED_SECRET, REASON_SECRET] = CORPUS_SECRETS;

const PAIRING = new PairingSecret({ token: 'v1-golden-pairing-token' });

const MACHINE: MachineSummary = {
  id: 'sprite-primary',
  name: 'primary',
  organization: 'example',
  state: 'running',
  setup: 'ready',
  readiness: 'not inspected',
};

const DETAILED_MACHINE: MachineSummary = {
  id: 'sprite-atlas',
  name: 'atlas',
  organization: 'personal',
  createdAt: '2026-10-12T08:30:00.000Z',
  state: 'running',
  machine: { label: 'sprite', cpus: 8, memoryGb: 16 },
  agentUrl: 'https://atlas.sprites.app/',
  setup: 'ready',
  profile: {
    provider: 'sprite',
    agent: 't3',
    harnesses: ['claude'],
    network: 'none',
  },
  readiness: 'not inspected',
};

const SPRITE_LISTED: ListedMachine = { ...MACHINE, provider: 'sprite' };

const PREFLIGHT: CreatePreflight = {
  checks: ['Provider token verified', 'Workstation name is available'],
  reminders: ['Run open-agent show primary --inspect after the first boot'],
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

const RECORDED_GOVERNOR: GovernorState = {
  version: 1,
  updatedAt: '2026-10-09T00:10:00.000Z',
  keepAwakeMode: 'native-deadline',
  idleTimeoutMinutes: 5,
  holdMaxMinutes: 60,
  lastHeartbeat: '2026-10-09T00:10:00.000Z',
  holds: [],
  openHolds: 0,
  deadline: '2026-10-09T00:15:00.000Z',
  diagnostics: [],
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
      awakeHooksInstalled: false,
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
  governor: { recorded: true, state: RECORDED_GOVERNOR },
};

const UPDATES: UpdateStatus = {
  startedAt: '2026-10-09T00:00:00.000Z',
  finishedAt: '2026-10-09T00:01:00.000Z',
  lastSuccess: '2026-10-08T00:01:00.000Z',
  tools: [
    {
      name: 'ripgrep',
      manager: 'brew',
      required: false,
      outcome: 'failed',
      reason: 'no bottle',
    },
    {
      name: 'gh',
      manager: 'brew',
      required: false,
      outcome: 'installed',
      from: '2.60.0',
      to: '2.61.0\nsecond line',
    },
    { name: 'jq', manager: 'brew', required: true, outcome: 'skipped' },
  ],
};

const INSTALLED_TOOLS: GuestInspection['environment']['tools'] = [
  {
    name: 'gh',
    required: false,
    account: 'linuxbrew',
    executables: ['gh'],
    source: { kind: 'brew', formula: 'gh' },
  },
  {
    name: 'ripgrep',
    required: false,
    account: 'linuxbrew',
    executables: ['rg'],
    source: { kind: 'brew', formula: 'ripgrep' },
  },
];

const SKIPPED_TOOLS: GuestInspection['environment']['setup']['skipped'] = [
  { name: 'tmux', reason: 'no source is usable on this system' },
];

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
        agentUrl: PAIRING.forUrl('https://primary.sprites.app/'),
      },
      preflight: PREFLIGHT,
      profile: DISABLED_NETWORK_PROFILE,
      readiness: PASSING_READINESS,
      network: INSPECTION.network,
      services: [{ name: 't3-code', state: 'running' }, { name: 'cron' }],
      native: INSPECTION.native,
      pairing: {
        status: 'created',
        token: PAIRING,
        expiresAt: '2026-10-09T01:00:00.000Z',
      },
    },
    retainedCredential: { storage: 'keychain' },
  }),
  corpusCase(
    'create-success-protected-file',
    {
      command: 'create',
      ok: true,
      data: {
        retainedCredentials: {
          provider: {
            storage: 'protected-file',
            fallbackReason: 'Keychain is unavailable on this platform',
          },
        },
        machine: DETAILED_MACHINE,
        preflight: PREFLIGHT,
        profile: DISABLED_NETWORK_PROFILE,
        readiness: PASSING_READINESS,
        network: INSPECTION.network,
        services: [{ name: 't3-code', state: 'running' }],
        native: INSPECTION.native,
        pairing: { status: 'not requested' },
      },
    },
    { withPairCode: true },
  ),
  corpusCase('create-success-pairing-failed', {
    command: 'create',
    ok: true,
    data: {
      machine: MACHINE,
      preflight: { checks: [], reminders: [] },
      profile: DISABLED_NETWORK_PROFILE,
      readiness: PASSING_READINESS,
      network: INSPECTION.network,
      services: [],
      native: INSPECTION.native,
      pairing: {
        status: 'failed',
        reason: 'the agent did not answer',
        retry: 'open-agent setup agent primary --with-pair-code',
      },
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
      details: [
        'Run open-agent setup primary to resume',
        'Nothing was exposed',
      ],
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

  // setup: every section
  corpusCase('setup-all', {
    command: 'setup',
    ok: true,
    data: {
      section: 'all',
      machine: MACHINE,
      retainedCredentials: { provider: { storage: 'keychain' } },
      service: 'configured',
      pairing: { status: 'not requested' },
      network: { status: 'disabled', readiness: 'skipped' },
      components: { installed: 6, skipped: 1, failed: 1 },
      tools: 'updated',
    },
  }),
  corpusCase('setup-all-disabled', {
    command: 'setup',
    ok: true,
    data: {
      section: 'all',
      machine: MACHINE,
      network: { status: 'disabled', readiness: 'skipped' },
      tools: 'unchanged',
    },
  }),
  corpusCase('setup-agent-pairing', {
    command: 'setup',
    ok: true,
    data: {
      section: 'agent',
      machine: MACHINE,
      service: 'configured',
      pairing: {
        status: 'created',
        token: PAIRING,
        expiresAt: '2026-10-09T01:00:00.000Z',
      },
    },
  }),
  corpusCase(
    'setup-agent-pairing-disclosed',
    {
      command: 'setup',
      ok: true,
      data: {
        section: 'agent',
        machine: {
          ...MACHINE,
          agentUrl: PAIRING.forUrl('https://primary.sprites.app/'),
        },
        pairing: { status: 'created', token: PAIRING },
      },
    },
    { withPairCode: true },
  ),
  corpusCase('setup-network-disabled', {
    command: 'setup',
    ok: true,
    data: {
      section: 'network',
      machine: MACHINE,
      network: { status: 'disabled', readiness: 'skipped' },
    },
  }),
  corpusCase('setup-tools-updated', {
    command: 'setup',
    ok: true,
    data: {
      section: 'tools',
      machine: MACHINE,
      components: { installed: 6, skipped: 1, failed: 1 },
      tools: 'updated',
    },
  }),
  corpusCase('setup-tools-scheduled', {
    command: 'setup',
    ok: true,
    data: { section: 'tools', machine: MACHINE, tools: 'scheduled' },
  }),
  corpusCase('setup-tools-unchanged', {
    command: 'setup',
    ok: true,
    data: { section: 'tools', machine: MACHINE, tools: 'unchanged' },
  }),
  corpusCase('setup-tools-recorded-versions', {
    command: 'setup',
    ok: true,
    data: {
      section: 'tools',
      machine: MACHINE,
      tools: {
        status: 'recorded versions',
        tools: INSTALLED_TOOLS,
        skipped: SKIPPED_TOOLS,
        lastUpdate: UPDATES,
      },
    },
  }),
  corpusCase('setup-failure-bare', {
    command: 'setup',
    ok: false,
    error: { code: 'AUTH', message: 'The provider rejected the token' },
  }),
  corpusCase('setup-failure-readiness-recovery', {
    command: 'setup',
    ok: false,
    error: {
      code: 'PREFLIGHT',
      message: 'Setup finished but the workstation is not ready',
      machine: 'primary',
      machineId: 'sprite-primary',
      setupIncomplete: true,
      details: ['Inspect the T3 service'],
    },
    data: {
      readiness: FAILING_READINESS,
      recovery: { incompleteLabel: 'confirmed' },
    },
  }),
  corpusCase('setup-failure-recovery-unconfirmed', {
    command: 'setup',
    ok: false,
    error: { code: 'PROVIDER', message: 'Could not label the workstation' },
    data: { recovery: { incompleteLabel: 'unconfirmed' } },
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

  // show
  corpusCase('show-plain', {
    command: 'show',
    ok: true,
    data: { machine: DETAILED_MACHINE },
  }),
  corpusCase('show-copy-action', {
    command: 'show',
    ok: true,
    data: { machine: DETAILED_MACHINE, action: 'copy' },
  }),
  corpusCase('show-inspection-disabled', {
    command: 'show',
    ok: true,
    data: { machine: MACHINE, inspection: INSPECTION },
  }),
  corpusCase('show-inspection-detailed', {
    command: 'show',
    ok: true,
    data: {
      machine: DETAILED_MACHINE,
      inspection: {
        ...INSPECTION,
        services: [{ name: 't3-code', status: 'running', needs: [] }],
        environment: environmentOf(DISABLED_NETWORK_PROFILE, {
          tools: INSTALLED_TOOLS,
          setup: { state: 'ready', skipped: SKIPPED_TOOLS },
        }),
        updates: UPDATES,
        readiness: PASSING_READINESS,
      },
    },
  }),
  corpusCase('show-inspection-awake-hooks', {
    command: 'show',
    ok: true,
    data: {
      machine: MACHINE,
      inspection: {
        ...INSPECTION,
        native: {
          ...INSPECTION.native!,
          claude: { ...INSPECTION.native!.claude!, awakeHooksInstalled: true },
        },
      },
    },
  }),
  corpusCase('show-governor-not-recorded', {
    command: 'show',
    ok: true,
    data: {
      machine: MACHINE,
      inspection: {
        ...INSPECTION,
        governor: {
          recorded: false,
          reason: 'no awake event has been recorded yet',
        },
      },
    },
  }),
  corpusCase('show-governor-adapter-failure', {
    command: 'show',
    ok: true,
    data: {
      machine: MACHINE,
      inspection: {
        ...INSPECTION,
        governor: governed({
          lastHeartbeat: undefined,
          deadline: undefined,
          keepAwakeMode: undefined,
          openHolds: 1,
          adapter: {
            at: '2026-10-09T00:10:00.000Z',
            action: 'apply-deadline',
            failure: 'deadline refused',
          },
        }),
      },
    },
  }),
  corpusCase('show-guest-control-characters', {
    command: 'show',
    ok: true,
    data: {
      machine: MACHINE,
      inspection: {
        ...INSPECTION,
        governor: governed({
          adapter: {
            at: '2026-10-09T00:10:00.000Z',
            action: 'apply-deadline',
            failure: 'deadline\u001b[2J refused\u009b31m',
          },
        }),
        network: {
          ...INSPECTION.network,
          reason: 'guest said\u0007 \u001b[1mbold\u001b[0m',
        },
      },
    },
  }),
  corpusCase(
    'show-pairing-and-redaction',
    {
      command: 'show',
      ok: true,
      data: {
        machine: {
          ...MACHINE,
          agentUrl: PAIRING.forUrl('https://primary.sprites.app/'),
        },
        inspection: {
          ...INSPECTION,
          updates: {
            tools: [
              {
                name: 'gh',
                manager: 'brew',
                required: false,
                outcome: 'failed',
                reason: REASON_SECRET,
              },
            ],
          },
        },
        pairing: { status: 'created', token: PAIRING },
      },
    },
    { withPairCode: true },
  ),
  corpusCase('show-nested-secrets', {
    command: 'show',
    ok: true,
    data: {
      machine: MACHINE,
      inspection: {
        ...INSPECTION,
        network: {
          ...INSPECTION.network,
          reason: `the network rejected ${NESTED_SECRET} twice: ${NESTED_SECRET}`,
        },
        updates: {
          tools: [
            {
              name: 'gh',
              manager: 'brew',
              required: false,
              outcome: 'failed',
              reason: `updater rejected ${NESTED_SECRET} twice: ${NESTED_SECRET}`,
            },
          ],
        },
      },
    },
  }),
  corpusCase('show-failure-secret-error', {
    command: 'show',
    ok: false,
    error: {
      code: 'PROVIDER',
      message: `provider rejected ${NESTED_SECRET}`,
      machine: `machine-${NESTED_SECRET}`,
      machineId: `id-${NESTED_SECRET}`,
      details: [`retry without ${NESTED_SECRET}`],
    },
  }),

  // doctor
  corpusCase('doctor-ready-native-deadline', {
    command: 'doctor',
    ok: true,
    data: {
      machine: MACHINE,
      currentReadiness: currentReadiness({
        services: [{ name: 't3-code', state: 'running' }],
      }),
    },
  }),
  corpusCase('doctor-keep-awake-native-deadline-passed', {
    command: 'doctor',
    ok: true,
    data: {
      machine: MACHINE,
      currentReadiness: currentReadiness({
        governor: governed({ deadline: '2026-10-08T00:00:00.000Z' }),
      }),
    },
  }),
  corpusCase('doctor-keep-awake-native-deadline-released', {
    command: 'doctor',
    ok: true,
    data: {
      machine: MACHINE,
      currentReadiness: currentReadiness({
        governor: governed({
          deadline: undefined,
          adapter: {
            at: '2026-10-09T00:10:00.000Z',
            action: 'apply-deadline',
            result: 'released',
          },
        }),
      }),
    },
  }),
  corpusCase('doctor-keep-awake-none', {
    command: 'doctor',
    ok: true,
    data: {
      machine: MACHINE,
      currentReadiness: currentReadiness({
        governor: governed({ keepAwakeMode: 'none', deadline: undefined }),
      }),
    },
  }),
  corpusCase('doctor-updates-and-tools', {
    command: 'doctor',
    ok: true,
    data: {
      machine: DETAILED_MACHINE,
      currentReadiness: currentReadiness({
        environment: environmentOf(DISABLED_NETWORK_PROFILE, {
          tools: INSTALLED_TOOLS,
          setup: { state: 'ready', skipped: SKIPPED_TOOLS },
        }),
        updates: UPDATES,
        skipped: sdkObservation<string[]>(['first', undefined, 'third']),
      }),
    },
  }),
  corpusCase('doctor-failure-readiness', {
    command: 'doctor',
    ok: false,
    error: {
      code: 'PREFLIGHT',
      message: 'Readiness check failed',
      machine: 'primary',
    },
    data: {
      machine: { ...MACHINE, state: 'cold' },
      currentReadiness: currentReadiness({
        ready: false,
        failures: ['T3 environment endpoint'],
        skipped: [],
        network: INSPECTION.network,
      }),
    },
  }),
  corpusCase('doctor-failure-bare', {
    command: 'doctor',
    ok: false,
    error: { code: 'INPUT', message: 'Workstation "missing" was not found' },
  }),

  // terminate
  corpusCase('terminate-success', {
    command: 'terminate',
    ok: true,
    data: {
      machine: MACHINE,
      workstation: {
        status: 'deleted',
        id: 'sprite-primary',
        name: 'primary',
      },
    },
  }),
  corpusCase('terminate-failure-cancelled', {
    command: 'terminate',
    ok: false,
    error: { code: 'CANCELLED', message: 'Typed name did not match' },
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
    error: { code: 'INPUT', message: 'Invalid value for --cpu' },
  }),
  ...ERROR_CODES.map((code) =>
    corpusCase(`error-code-${code.toLowerCase()}`, {
      command: 'show',
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
  corpusCase('serialization-undefined-in-detail', {
    command: 'show',
    ok: true,
    data: {
      machine: {
        ...MACHINE,
        createdAt: sdkObservation<string>(new Date('2026-10-09T12:00:00.000Z')),
        agentUrl: undefined,
      },
      inspection: {
        ...INSPECTION,
        probeFailures: [{ probe: 'network', reason: 'no answer' }],
        services: [
          { name: 'a', needs: [] },
          sdkObservation<GuestInspection['services'][number]>(undefined),
        ],
      },
    },
  }),
];

/**
 * names one characterized result
 * @param name unique kebab-case identity
 * @param result completed result
 * @param options output controls other than `json`
 * @returns the corpus entry
 */
function corpusCase(
  name: string,
  result: CommandResult,
  options: CommandOptions = {},
): CorpusCase {
  return { name, result, options };
}

/**
 * passes a runtime value the types forbid, as an SDK observation can
 * @param value the observed value
 * @returns the value typed as the contract claims it is
 */
function sdkObservation<T>(value: unknown): T {
  return value as T;
}

/**
 * builds a recorded governor report that differs from the default
 * @param state fields replacing the default recorded state
 * @returns the report
 */
function governed(state: Partial<GovernorState>): GuestInspection['governor'] {
  return { recorded: true, state: { ...RECORDED_GOVERNOR, ...state } };
}

/**
 * builds doctor readiness evidence that differs from a healthy default
 * @param overrides fields replacing the healthy default
 * @returns the readiness evidence
 */
function currentReadiness(
  overrides: Partial<CurrentReadiness> = {},
): CurrentReadiness {
  return {
    ...PASSING_READINESS,
    network: INSPECTION.network,
    native: INSPECTION.native,
    services: [],
    environment: INSPECTION.environment,
    governor: INSPECTION.governor,
    ...overrides,
  };
}
