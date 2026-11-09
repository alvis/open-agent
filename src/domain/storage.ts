import { selectionLabel } from '#domain/selection-inputs';

import type {
  ProductDeclarations,
  ProviderDeclaration,
  StorageCapability,
  StorageGrowth,
} from '#domain/declarations';
import type { ProviderId } from '#domain/ids';
import type {
  ProfileField,
  ProfileOptions,
  ProfileValidationOptions,
  ProfileViolation,
} from '#domain/profile';

/** the growth policy a workstation runs with */
export type StoragePolicy =
  | { state: 'unsupported' }
  | { state: 'off' }
  | {
      state: 'on';
      thresholdPercent: number;
      stepGb: number;
      limitGb: number;
      mechanisms: readonly StorageGrowth[];
    };

/** the profile options that shape automatic growth and have no effect without it, in option order */
export const STORAGE_POLICY_OPTIONS = [
  'autoExtendThresholdPercent',
  'autoExtendStepGb',
  'storageLimitGb',
] as const satisfies ReadonlyArray<keyof ProfileOptions>;

/** a profile option that shapes automatic growth */
export type StoragePolicyOption = (typeof STORAGE_POLICY_OPTIONS)[number];

/** the storage options every profile carries, and their values when nothing chooses them */
export const STORAGE_OPTION_DEFAULTS = {
  minStorageGb: 10,
  autoExtendThresholdPercent: 80,
  autoExtendStepGb: 10,
  storageLimitGb: 100,
} as const satisfies Pick<ProfileOptions, 'minStorageGb' | StoragePolicyOption>;

/** a provider's storage and the requested storage options to validate */
export interface StorageViolationsParams {
  declarations: ProductDeclarations;
  provider: ProviderId;
  options: ProfileOptions;
  requests: Pick<
    ProfileValidationOptions,
    'isStorageLimitRequested' | 'storagePolicyFlags'
  >;
}

/**
 * tells whether a provider's storage grows without the user acting
 * @param storage the provider's declared storage capability
 * @returns true when at least one growth mechanism is declared
 */
export function supportsAutoGrowth(storage: StorageCapability): boolean {
  return storage.growth.length > 0;
}

/**
 * tells whether the host can grow a provider's storage on request, as `setup --storage` does
 * @param storage the provider's declared storage capability
 * @returns true when the provider declares a host extend operation
 */
export function supportsHostGrowth(storage: StorageCapability): boolean {
  return storage.hostExtend;
}

/**
 * locates the filesystem that holds a provider's persistent data, which
 * inspection measures
 * @param storage the provider's declared storage capability
 * @returns the guest path whose filesystem holds the persistent data
 */
export function storagePath(storage: StorageCapability): string {
  return storage.path;
}

/**
 * sizes a new workstation's storage
 * @param storage the provider's declared storage capability
 * @param options the profile's options
 * @returns the provider's default size, raised to the requested minimum, in whole GB
 */
export function initialStorageGb(
  storage: StorageCapability,
  options: ProfileOptions,
): number {
  return Math.max(storage.defaultGb, options.minStorageGb);
}

/**
 * resolves the growth policy a workstation runs with on a provider
 * @param storage the provider's declared storage capability
 * @param options the profile's options
 * @returns unsupported without automatic growth, off when the profile turns it off, and otherwise on with the limit raised to the starting size and lowered to the provider's maximum
 */
export function effectiveStoragePolicy(
  storage: StorageCapability,
  options: ProfileOptions,
): StoragePolicy {
  if (!supportsAutoGrowth(storage)) {
    return { state: 'unsupported' };
  }
  if (options.autoExtend === false) {
    return { state: 'off' };
  }

  return {
    state: 'on',
    thresholdPercent: options.autoExtendThresholdPercent,
    stepGb: options.autoExtendStepGb,
    limitGb: Math.min(
      Math.max(options.storageLimitGb, initialStorageGb(storage, options)),
      storage.maxGb,
    ),
    mechanisms: storage.growth,
  };
}

/**
 * tells whether the guest's storage watcher grows a workstation's storage
 * @param storage the provider's declared storage capability
 * @param policy the workstation's growth policy
 * @returns true when the provider lets the guest extend its storage and growth is on
 */
export function runsStorageWatcher(
  storage: StorageCapability,
  policy: StoragePolicy,
): boolean {
  return storage.growth.includes('guest-extend') && policy.state === 'on';
}

/**
 * checks an explicit request to grow a workstation's storage to a size
 * @param storage the provider's declared storage capability
 * @param requestedGb the size asked for, in GB
 * @returns why the provider cannot grow its storage to the size, or undefined when it can
 */
export function hostGrowthRefusal(
  storage: StorageCapability,
  requestedGb: number,
): string | undefined {
  if (!supportsHostGrowth(storage)) {
    return 'the provider cannot grow its storage on request';
  }
  if (!Number.isSafeInteger(requestedGb) || requestedGb < 1) {
    return 'storage must be a whole number of GB of at least 1';
  }
  if (requestedGb > storage.maxGb) {
    return `storage of ${String(requestedGb)} GB is more than the provider allows: at most ${String(storage.maxGb)} GB`;
  }

  return undefined;
}

/**
 * checks the storage options against the provider's declared storage; a limit
 * the caller did not supply is fitted by the effective policy, never refused
 * @param params known provider, requested options and what the caller supplied
 * @param params.declarations the data every registered driver declares
 * @param params.provider known provider id
 * @param params.options requested options
 * @param params.requests whether the caller supplied the limit, and which policy options it gave as flags
 * @returns violations for a minimum above the provider's maximum, automatic growth the provider cannot do, a supplied limit outside the starting size to the maximum while growth is on, and policy flags without effect
 */
export function storageViolations({
  declarations,
  provider,
  options,
  requests,
}: StorageViolationsParams): ProfileViolation[] {
  const { displayName, capabilities } = declarations.providers[provider];
  const { storage } = capabilities;
  const policy = effectiveStoragePolicy(storage, options);

  return [
    ...(Number.isSafeInteger(options.minStorageGb) &&
    options.minStorageGb > storage.maxGb
      ? [
          {
            code: 'undeclared-capability' as const,
            message: `${selectionLabel('minStorageGb')} of ${String(options.minStorageGb)} GB is more than ${displayName} allows: at most ${String(storage.maxGb)} GB`,
            fields: ['provider', 'minStorageGb'] as ProfileField[],
          },
        ]
      : []),
    ...(options.autoExtend === true && !supportsAutoGrowth(storage)
      ? [
          {
            code: 'undeclared-capability' as const,
            message: `${selectionLabel('autoExtend')} needs a provider whose storage grows automatically; ${displayName} has fixed storage`,
            fields: ['provider', 'autoExtend'] as ProfileField[],
          },
        ]
      : []),
    ...(policy.state === 'on'
      ? suppliedLimitViolations({ storage, displayName, options, requests })
      : ineffectiveFlagViolations({
          state: policy.state,
          displayName,
          flags: requests.storagePolicyFlags ?? [],
        })),
  ];
}

/**
 * checks a supplied growth limit lies between the starting size and the provider's maximum
 * @param params the provider's storage and name, requested options and what the caller supplied
 * @param params.storage the provider's declared storage capability
 * @param params.displayName the provider's name
 * @param params.options requested options
 * @param params.requests whether the caller supplied the limit
 * @returns a violation for a supplied limit below the starting size or above the maximum
 */
function suppliedLimitViolations({
  storage,
  displayName,
  options,
  requests,
}: {
  storage: StorageCapability;
  displayName: string;
  options: ProfileOptions;
  requests: StorageViolationsParams['requests'];
}): ProfileViolation[] {
  const { storageLimitGb } = options;
  const startGb = initialStorageGb(storage, options);
  // a malformed size is reported by its bound alone, and a starting size above
  // the maximum by the minimum's own violation
  if (
    !requests.isStorageLimitRequested ||
    !Number.isSafeInteger(storageLimitGb) ||
    !Number.isSafeInteger(startGb) ||
    startGb > storage.maxGb
  ) {
    return [];
  }
  const label = selectionLabel('storageLimitGb');

  return [
    ...(storageLimitGb < startGb
      ? [
          {
            code: 'invalid-option' as const,
            message: `${label} of ${String(storageLimitGb)} GB is below the starting size of ${String(startGb)} GB`,
            fields: ['minStorageGb', 'storageLimitGb'] as ProfileField[],
          },
        ]
      : []),
    ...(storageLimitGb > storage.maxGb
      ? [
          {
            code: 'undeclared-capability' as const,
            message: `${label} of ${String(storageLimitGb)} GB is more than ${displayName} allows: at most ${String(storage.maxGb)} GB`,
            fields: ['provider', 'storageLimitGb'] as ProfileField[],
          },
        ]
      : []),
  ];
}

/**
 * refuses each explicit policy flag while automatic growth is not on, since it would have no effect
 * @param params the policy state, the provider's name and the explicit flags
 * @param params.state why growth is not on
 * @param params.displayName the provider's name
 * @param params.flags policy options given as explicit flags
 * @returns one violation per explicit policy flag, in option order
 */
function ineffectiveFlagViolations({
  state,
  displayName,
  flags,
}: {
  state: 'off' | 'unsupported';
  displayName: string;
  flags: readonly StoragePolicyOption[];
}): ProfileViolation[] {
  return STORAGE_POLICY_OPTIONS.filter((option) => flags.includes(option)).map(
    (option) => ({
      code:
        state === 'off'
          ? ('invalid-option' as const)
          : ('undeclared-capability' as const),
      message: `${selectionLabel(option)} has no effect: automatic storage growth is ${state} on ${displayName}`,
      fields:
        state === 'off'
          ? ([option, 'autoExtend'] as ProfileField[])
          : (['provider', option] as ProfileField[]),
    }),
  );
}

/**
 * checks a provider's storage declaration is coherent, as the driver catalog requires
 * @param declaration the provider's capabilities and storage adapter
 * @returns the first reason the declaration is incoherent, or undefined when it is coherent
 */
export function storageDeclarationProblem(
  declaration: Pick<ProviderDeclaration, 'capabilities' | 'storageAsset'>,
): string | undefined {
  const { defaultGb, maxGb, growth } = declaration.capabilities.storage;

  if (defaultGb < 1) {
    return `default storage of ${String(defaultGb)} GB is below 1 GB`;
  }
  if (maxGb < defaultGb) {
    return `maximum storage of ${String(maxGb)} GB is below the default of ${String(defaultGb)} GB`;
  }
  if (new Set(growth).size !== growth.length) {
    return `storage growth mechanisms repeat: ${growth.join(', ')}`;
  }
  if (growth.includes('guest-extend') && !declaration.storageAsset) {
    return 'guest-extend storage growth needs a storage adapter (storageAsset)';
  }

  return undefined;
}
