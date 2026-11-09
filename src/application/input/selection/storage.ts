import { isDriverId } from '#domain/profile';
import {
  effectiveStoragePolicy,
  storageViolations,
  supportsAutoGrowth,
} from '#domain/storage';

import type { ApplicationDependencies } from '#application/ports/dependencies';
import type { StorageCapability } from '#domain/declarations';
import type { ProfileOptions } from '#domain/profile';
import type { StoragePolicy, StoragePolicyOption } from '#domain/storage';

import type { Prompts } from './sources';
import type { SuppliedSelection } from './supplied';

/** storage inputs, the selected provider and the policy options given as flags */
export interface StorageContext {
  /** selected provider, validated later against the catalog */
  provider: string;
  /** storage policy options given as explicit flags */
  flags: readonly StoragePolicyOption[];
  /** options the caller supplied */
  supplied: SuppliedSelection['options'];
  /** default options for a new workstation */
  base: ProfileOptions;
  /** active prompts, absent when none may be asked */
  prompts?: Prompts;
}

/** the storage options a new workstation starts with */
export type StorageOptions = Pick<
  ProfileOptions,
  | 'minStorageGb'
  | 'autoExtend'
  | 'autoExtendThresholdPercent'
  | 'autoExtendStepGb'
  | 'storageLimitGb'
>;

/** a new workstation's storage options and what their validation must know of where they came from */
export interface ResolvedStorage {
  /** the storage options */
  options: StorageOptions;
  /** whether a growth limit was supplied or answered rather than defaulted */
  isStorageLimitRequested: boolean;
  /** storage policy options given as explicit flags */
  storagePolicyFlags: readonly StoragePolicyOption[];
}

/** what the storage prompts check their answers against */
interface StorageScope {
  /** the selected provider's storage; absent while the provider choice is unknown */
  storage?: StorageCapability;
  /**
   * refuses a size the provider's storage cannot take
   * @param options the options with the answer in place
   * @param field the answered option
   * @returns why the answer is refused, or undefined to accept it
   */
  refusal(
    options: ProfileOptions,
    field: 'minStorageGb' | 'storageLimitGb',
  ): string | undefined;
}

/** what the limit prompt offers and checks */
interface LimitContext {
  /** the options chosen so far */
  chosen: ProfileOptions;
  /** the effective policy of those options; absent for an unknown provider */
  policy?: StoragePolicy;
  /** active prompts, absent when none may be asked */
  prompts?: Prompts;
}

/** the prompt rule of a size in whole GB */
const GB_RULE = { unit: 'GB', minimum: 1 } as const;

/**
 * resolves the storage of a new workstation: the minimum size, asked right
 * after the memory; then, only where the provider grows storage automatically,
 * whether to grow it and up to what size, while the threshold and step are
 * never asked. A policy value from the environment or the credential file is
 * dropped while growth is not on, since it would have no effect, but an
 * explicit flag is kept so validation refuses it
 * @param dependencies the registered drivers
 * @param context provider, explicit policy flags, supplied values, base options and prompts
 * @returns the storage options, whether the limit was requested, and the explicit policy flags
 */
export async function resolveStorage(
  dependencies: Pick<ApplicationDependencies, 'registry'>,
  context: StorageContext,
): Promise<ResolvedStorage> {
  const { flags, supplied, base } = context;
  const scope = storageScope(dependencies, context.provider);
  const minStorageGb = await resolveMinimum(scope, context);
  const autoExtend = await resolveAutoExtend(scope, context);
  const chosen: ProfileOptions = {
    ...base,
    minStorageGb,
    ...(autoExtend !== undefined && { autoExtend }),
  };
  const policy = scope.storage
    ? effectiveStoragePolicy(scope.storage, chosen)
    : undefined;
  // with growth not on, only an explicit flag survives, for validation to refuse
  const kept = (option: StoragePolicyOption): number | undefined =>
    policy && policy.state !== 'on' && !flags.includes(option)
      ? undefined
      : supplied[option];
  const storageLimitGb =
    kept('storageLimitGb') ??
    (await resolveLimit(scope, {
      chosen,
      ...(policy && { policy }),
      ...(context.prompts && { prompts: context.prompts }),
    }));

  return {
    options: {
      minStorageGb,
      ...(autoExtend !== undefined && { autoExtend }),
      autoExtendThresholdPercent:
        kept('autoExtendThresholdPercent') ?? base.autoExtendThresholdPercent,
      autoExtendStepGb: kept('autoExtendStepGb') ?? base.autoExtendStepGb,
      storageLimitGb: storageLimitGb ?? base.storageLimitGb,
    },
    isStorageLimitRequested: storageLimitGb !== undefined,
    storagePolicyFlags: flags,
  };
}

/**
 * binds the storage checks to the selected provider when the catalog registers it
 * @param dependencies the registered drivers
 * @param provider selected provider, possibly unknown
 * @returns the provider's storage and a check of answered sizes against it; no storage and no check for an unknown provider
 */
function storageScope(
  dependencies: Pick<ApplicationDependencies, 'registry'>,
  provider: string,
): StorageScope {
  const declarations = dependencies.registry;
  if (!isDriverId(provider, { declarations, kind: 'providers' })) {
    return { refusal: () => undefined };
  }

  return {
    storage: declarations.providers[provider].capabilities.storage,
    refusal: (options, field) =>
      storageViolations({
        declarations,
        provider,
        options,
        requests: { isStorageLimitRequested: field === 'storageLimitGb' },
      }).find(({ fields }) => fields.includes(field))?.message,
  };
}

/**
 * resolves the minimum storage: the supplied size, else an answer the provider can take, else the base size
 * @param scope the provider's storage checks
 * @param context supplied values, base options and prompts
 * @returns the minimum storage, in whole GB
 */
async function resolveMinimum(
  scope: StorageScope,
  context: StorageContext,
): Promise<number> {
  const { supplied, base, prompts } = context;

  return (
    supplied.minStorageGb ??
    (await prompts?.number('Minimum storage (GB)', base.minStorageGb, {
      ...GB_RULE,
      check: (value) =>
        scope.refusal({ ...base, minStorageGb: value }, 'minStorageGb'),
    })) ??
    base.minStorageGb
  );
}

/**
 * resolves whether storage grows automatically, asked only where the provider can grow it
 * @param scope the provider's storage
 * @param context supplied values, base options and prompts
 * @returns the choice, absent when nobody made one
 */
async function resolveAutoExtend(
  scope: StorageScope,
  context: StorageContext,
): Promise<boolean | undefined> {
  const { supplied, base, prompts } = context;
  const growable =
    scope.storage !== undefined && supportsAutoGrowth(scope.storage);

  return (
    supplied.autoExtend ??
    (growable
      ? await prompts?.confirm(
          'Grow storage automatically?',
          base.autoExtend ?? true,
        )
      : undefined) ??
    base.autoExtend
  );
}

/**
 * asks for the growth limit while growth is on, offering the effective limit
 * @param scope the provider's storage checks
 * @param context the options chosen so far, their effective policy and prompts
 * @returns the answered limit, absent when growth is not on or nobody may be asked
 */
async function resolveLimit(
  scope: StorageScope,
  context: LimitContext,
): Promise<number | undefined> {
  const { prompts, chosen, policy } = context;

  return policy?.state === 'on'
    ? prompts?.number('Grow up to (GB)', policy.limitGb, {
        ...GB_RULE,
        check: (value) =>
          scope.refusal({ ...chosen, storageLimitGb: value }, 'storageLimitGb'),
      })
    : undefined;
}
