import { AGENT_IDS } from '#domain/ids';
import { validateProfile } from '#domain/profile';
import { selectionInputs } from '#domain/selection-inputs';
import { STORAGE_POLICY_OPTIONS } from '#domain/storage';

import { environmentReader } from './sources';

import type { CommandOptions } from '#application/contracts';
import type { ApplicationDependencies } from '#application/ports/dependencies';
import type {
  ProfileField,
  ProfileOptions,
  ProfileValidationOptions,
  ProfileViolation,
} from '#domain/profile';
import type { SelectionField } from '#domain/selection-inputs';
import type { StoragePolicyOption } from '#domain/storage';

import type { Resolved, SelectionContext } from './sources';

/** options a caller can select */
type SelectableOption = Extract<SelectionField, keyof ProfileOptions>;

/** the values a caller's flags and environment supply, before prompts and defaults */
export interface SuppliedSelection {
  /** requested provider driver id */
  provider?: string;
  /** requested ACP agent driver id */
  agent?: string;
  /** requested harness driver ids */
  harnesses?: readonly string[];
  /** requested network driver id */
  network?: string;
  /** requested options */
  options: Partial<Pick<ProfileOptions, SelectableOption>>;
}

/** what a run's supplied values are read from */
interface ReadContext extends Omit<SelectionContext, 'interaction'> {
  /** whole-number fields read from their flags alone, ignoring the environment */
  flagOnly?: readonly SelectionField[];
}

/** the options a caller can select */
const SELECTABLE_OPTIONS: readonly SelectableOption[] = [
  'agentRelease',
  'minCpus',
  'minMemoryGb',
  'minStorageGb',
  'autoExtend',
  'autoExtendThresholdPercent',
  'autoExtendStepGb',
  'storageLimitGb',
  'isExitNodeEnabled',
  'isProxyEnabled',
  'idleTimeoutMinutes',
  'holdMaxMinutes',
  'updateDueIntervalDays',
];

/** the flag that supplies each storage policy option */
const STORAGE_POLICY_FLAGS = {
  autoExtendThresholdPercent: 'autoExtendAt',
  autoExtendStepGb: 'autoExtendStep',
  storageLimitGb: 'storageLimit',
} as const satisfies Record<StoragePolicyOption, keyof CommandOptions>;

/**
 * validates what can be known before the workstation's recorded profile is:
 * catalog ids, option bounds, and each capability whose drivers are all
 * determined, because they were supplied or the catalog registers only one
 * @param dependencies the registered drivers, the profile defaults
 * @param supplied values a setup run supplies
 * @param requests requests validated alongside the selection
 * @returns every violation the supplied values alone raise
 */
export function suppliedSelectionViolations(
  dependencies: Pick<ApplicationDependencies, 'registry' | 'defaults'>,
  supplied: SuppliedSelection,
  requests: Pick<ProfileValidationOptions, 'isPairingRequested'>,
): ProfileViolation[] {
  const provider = supplied.provider;
  const agent = supplied.agent ?? AGENT_IDS[0];
  const determined = new Set<ProfileField>([
    ...(provider === undefined ? [] : (['provider'] as const)),
    'agent',
    ...(supplied.harnesses === undefined ? [] : (['harnesses'] as const)),
    ...(supplied.network === undefined ? [] : (['network'] as const)),
    ...SELECTABLE_OPTIONS.filter(
      (field) => supplied.options[field] !== undefined,
    ),
  ]);
  const validation = validateProfile({
    declarations: dependencies.registry,
    candidate: {
      provider: provider ?? dependencies.defaults.selection.provider,
      agent,
      harnesses:
        supplied.harnesses ?? dependencies.defaults.selection.harnesses,
      network: supplied.network ?? dependencies.defaults.selection.network,
      options: {
        ...dependencies.defaults.options,
        ...definedOptions(supplied),
      },
    },
    options: {
      ...requests,
      isIdleTimeoutRequested: supplied.options.idleTimeoutMinutes !== undefined,
    },
  });

  return validation.isValid
    ? []
    : validation.violations.filter(({ fields }) =>
        fields.every((field) => determined.has(field)),
      );
}

/**
 * lists the storage policy options a run gives as explicit flags, which are
 * refused rather than ignored when they would have no effect
 * @param options flags of the run
 * @returns the policy options whose flag is set, in option order
 */
export function storagePolicyFlags(
  options: CommandOptions,
): StoragePolicyOption[] {
  return STORAGE_POLICY_OPTIONS.filter(
    (option) => options[STORAGE_POLICY_FLAGS[option]] !== undefined,
  );
}

/**
 * reads every field a run owns from its flag, then the selected credential file,
 * then the process environment; the provider and agent flags are always read
 * @param dependencies the registered drivers, which declare the selection inputs
 * @param context flags, sources and the whole-number fields read from their flags alone
 * @param fields fields the run owns
 * @returns the supplied values and every unreadable environment value
 */
export function readSelection(
  dependencies: Pick<ApplicationDependencies, 'registry'>,
  context: ReadContext,
  fields: readonly SelectionField[],
): Resolved<SuppliedSelection> {
  const { options, sources, flagOnly = [] } = context;
  const read = environmentReader(sources);
  const inputs = selectionInputs(dependencies.registry);
  const owned = (field: SelectionField): string | undefined =>
    fields.includes(field) ? inputs[field].environment : undefined;
  const harnessEnvironment = owned('harnesses');
  const networkEnvironment = owned('network');
  const switches = readSwitches(options, read, owned);
  const numbers = readNumberOptions({ options, read, owned, flagOnly });

  return {
    value: {
      provider: read.choice({
        flag: options.provider,
        environment: owned('provider'),
      }),
      agent: read.choice({ flag: options.agent, environment: owned('agent') }),
      harnesses: harnessEnvironment
        ? (options.harness ?? read.list(harnessEnvironment))
        : undefined,
      network: networkEnvironment
        ? read.choice({
            flag: options.network,
            environment: networkEnvironment,
          })
        : undefined,
      options: {
        agentRelease: read.choice({
          flag: options.release,
          environment: owned('agentRelease'),
        }),
        ...switches.value,
        ...numbers.value,
      },
    },
    problems: [...switches.problems, ...numbers.problems],
  };
}

/** the options a caller turns on or off */
type SwitchOption = Extract<
  SelectableOption,
  'isExitNodeEnabled' | 'isProxyEnabled' | 'autoExtend'
>;

/**
 * reads the on/off options a run owns from their flags and environment
 * @param options flags of the run
 * @param read reader over the environment sources
 * @param owned names the environment variable of a field the run owns
 * @returns the supplied switches and every unreadable value
 */
function readSwitches(
  options: SelectionContext['options'],
  read: ReturnType<typeof environmentReader>,
  owned: (field: SelectionField) => string | undefined,
): Resolved<Partial<Record<SwitchOption, boolean>>> {
  const unread = { value: undefined, problems: [] };
  const exitNodeEnvironment = owned('isExitNodeEnabled');
  const proxyEnvironment = owned('isProxyEnabled');
  const autoExtendEnvironment = owned('autoExtend');
  const exitNode = exitNodeEnvironment
    ? read.flag(options.useExitNode, exitNodeEnvironment)
    : unread;
  const proxy = proxyEnvironment
    ? read.flag(options.proxy, proxyEnvironment)
    : unread;
  // growth takes only true or false, as its environment variable documents
  const autoExtend = autoExtendEnvironment
    ? read.literalFlag(options.autoExtend, autoExtendEnvironment)
    : unread;

  return {
    value: {
      isExitNodeEnabled: exitNode.value,
      isProxyEnabled: proxy.value,
      autoExtend: autoExtend.value,
    },
    problems: [...exitNode.problems, ...proxy.problems, ...autoExtend.problems],
  };
}

/** the options whose values are whole numbers of minutes, days, CPUs, gigabytes or percent */
const NUMBER_OPTIONS = [
  'minCpus',
  'minMemoryGb',
  'minStorageGb',
  'autoExtendThresholdPercent',
  'autoExtendStepGb',
  'storageLimitGb',
  'idleTimeoutMinutes',
  'holdMaxMinutes',
  'updateDueIntervalDays',
] as const satisfies readonly SelectableOption[];

type NumberOption = (typeof NUMBER_OPTIONS)[number];

/** what the whole-number options are read from */
interface NumberSources {
  /** flags of the run */
  options: SelectionContext['options'];
  /** reader over the environment sources */
  read: ReturnType<typeof environmentReader>;
  /** fields read from their flags alone */
  flagOnly: readonly SelectionField[];
  /** names the environment variable of a field the run owns, undefined for any other */
  owned: (field: SelectionField) => string | undefined;
}

/**
 * reads the whole-number options a run owns from their flags and environment,
 * and the flag-only ones from their flags alone
 * @param sources flags, environment reader, owned and flag-only fields
 * @returns the supplied numbers and every unreadable value
 */
function readNumberOptions(
  sources: NumberSources,
): Resolved<Partial<Record<NumberOption, number>>> {
  const { options, read, owned, flagOnly } = sources;
  const flags: Record<NumberOption, number | undefined> = {
    minCpus: options.cpu,
    minMemoryGb: options.mem,
    minStorageGb: options.storage,
    autoExtendThresholdPercent: options.autoExtendAt,
    autoExtendStepGb: options.autoExtendStep,
    storageLimitGb: options.storageLimit,
    idleTimeoutMinutes: options.idleMinutes,
    holdMaxMinutes: options.holdMaxMinutes,
    updateDueIntervalDays: options.updateDueDays,
  };
  const resolved = NUMBER_OPTIONS.map((field) => {
    const environment = owned(field);

    return {
      field,
      ...(environment
        ? read.number(flags[field], environment)
        : {
            value: flagOnly.includes(field) ? flags[field] : undefined,
            problems: [],
          }),
    };
  });

  return {
    value: Object.fromEntries(
      resolved.map(({ field, value }) => [field, value]),
    ),
    problems: resolved.flatMap(({ problems }) => problems),
  };
}

/**
 * keeps only the options a caller supplied
 * @param supplied values a caller supplied
 * @returns the supplied options without unset keys
 */
function definedOptions(
  supplied: SuppliedSelection,
): Partial<Pick<ProfileOptions, SelectableOption>> {
  return Object.fromEntries(
    SELECTABLE_OPTIONS.flatMap((field) => {
      const value = supplied.options[field];

      return value === undefined ? [] : [[field, value]];
    }),
  );
}
