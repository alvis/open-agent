import { readAsset } from '#adapters/guest/platform/assets';
import { AWAKE_ASSET } from '#adapters/guest/platform/awake';
import {
  AGENT_HOME,
  AGENT_ID,
  LOGIN_PROFILE,
  LOGIN_PROFILE_PATH,
  PING_GROUP_RANGE,
} from '#adapters/guest/platform/layout';
import { libraryCommand } from '#adapters/guest/platform/library';
import {
  HOMEBREW_LIBRARY,
  LINKS_LIBRARY,
  NPM_LIBRARY,
  RUSTUP_LIBRARY,
  VERSIONS_LIBRARY,
} from '#adapters/guest/tools/libraries';

import { assetStep, assetStepId, fileStep } from './steps/file';
import { homebrewStep } from './steps/homebrew';

import type { DriverRegistry } from '#application/ports/drivers';
import type { OsFamily } from '#application/ports/os';
import type { PlanProvider, SetupStep } from '#application/ports/plan';
import type { GuestAsset, OsRelease } from '#domain/guest';
import type { WorkstationProfile } from '#domain/profile';
import type { Resolution, ToolSpec } from '#domain/tools';

/** id of the step that creates the agent account */
const ACCOUNTS_STEP = 'accounts';
/** id of the step that installs the bootstrap system packages */
export const BOOTSTRAP_STEP = 'bootstrap';
/** id of the best-effort step that lets every group open ping sockets */
const SYSCTL_STEP = 'sysctl:ping';
/** id of the step that writes the login profile */
const PROFILE_STEP = 'login-profile';
/** the login profile's mode: every login shell reads it */
const PROFILE_MODE = 0o644;

/** longest one command of the account step may take */
const ACCOUNTS_LIMIT_MS = 60_000;
/** longest one command of the bootstrap step may take, its lock wait included */
const BOOTSTRAP_LIMIT_MS = 1_200_000;
/** longest one command of the sysctl step may take */
const SYSCTL_LIMIT_MS = 30_000;

/** what the foundation of a plan is built from */
interface FoundationContext {
  /** every registered driver, whose agent and network bring launchers */
  registry: DriverRegistry;
  /** the provider, whose awake adapter is installed */
  provider: PlanProvider;
  /** the selection, whose agent and network bring launchers */
  profile: WorkstationProfile;
  /** the guest's release, as the session probed it */
  release: OsRelease;
  /** the guest's OS family */
  family: OsFamily;
  /** every tool setup resolved */
  tools: readonly ToolSpec[];
  /** the source picked for each tool */
  resolutions: readonly Resolution[];
}

/**
 * builds the steps every package step builds on: the guest programs, the
 * agent account, the bootstrap packages, Homebrew where a tool is poured from
 * it, the login profile and the ping sysctl
 * @param context the provider, selection, release, family and resolved tools
 * @returns the asset, account, bootstrap, Homebrew, profile and sysctl steps
 */
export async function foundationSteps(
  context: FoundationContext,
): Promise<SetupStep[]> {
  const { family, release } = context;
  const assets = guestAssets(context);
  const installs = await Promise.all(
    assets.map(async (asset) =>
      assetStep(family, asset, await readAsset(asset)),
    ),
  );
  const libraries = assets.map(assetStepId);
  const homebrew = family.homebrew(release);
  const brewTools = context.resolutions.flatMap((resolution) =>
    'source' in resolution && resolution.source.kind === 'brew'
      ? [resolution.tool]
      : [],
  );
  const required = new Set(
    context.tools.filter(({ required }) => required).map(({ name }) => name),
  );

  return [
    ...installs,
    accountsStep(family, libraries),
    bootstrapStep(family, family.bootstrapPackages(release)),
    ...(homebrew.supported && brewTools.length > 0
      ? [
          homebrewStep({
            family,
            prerequisites: homebrew.prerequisites,
            needs: [BOOTSTRAP_STEP],
            critical: brewTools.some((tool) => required.has(tool)),
          }),
        ]
      : []),
    fileStep(family, {
      id: PROFILE_STEP,
      component: 'login profile',
      path: LOGIN_PROFILE_PATH,
      contents: LOGIN_PROFILE,
      mode: PROFILE_MODE,
    }),
    sysctlStep(family),
  ];
}

/**
 * lists the guest programs setup installs before any step sources one: the
 * family's library, the tool libraries, the governor and the provider's awake
 * adapter, and the agent's launcher
 * @param context the provider, the selection and the family
 * @returns each asset once
 */
function guestAssets(
  context: Pick<
    FoundationContext,
    'registry' | 'provider' | 'profile' | 'family'
  >,
): GuestAsset[] {
  const { registry, provider, profile, family } = context;
  const assets = [
    family.library,
    HOMEBREW_LIBRARY,
    NPM_LIBRARY,
    RUSTUP_LIBRARY,
    LINKS_LIBRARY,
    VERSIONS_LIBRARY,
    AWAKE_ASSET,
    ...(provider.awakeAsset ? [provider.awakeAsset] : []),
    registry.agents[profile.agent].launcher,
  ];

  return [...new Map(assets.map((asset) => [asset.path, asset])).values()];
}

/**
 * renders calls into the family's library as one step command
 * @param family the guest's OS family
 * @param calls library functions and their arguments
 * @returns the command
 */
function library(
  family: OsFamily,
  calls: Parameters<typeof libraryCommand>[2],
): SetupStep['apply'] {
  return libraryCommand(family.shell, [family.library], calls);
}

/**
 * builds the step that creates the agent account with its fixed ids
 * @param family the guest's OS family
 * @param needs ids of the steps installing the library
 * @returns a critical step that ensures the account exists
 */
function accountsStep(family: OsFamily, needs: readonly string[]): SetupStep {
  return {
    id: ACCOUNTS_STEP,
    component: 'accounts',
    account: 'root',
    needs: [...needs],
    apply: library(family, [
      [
        'oa_account_ensure',
        'agent',
        AGENT_ID,
        AGENT_ID,
        AGENT_HOME,
        '/bin/bash',
        'user',
      ],
    ]),
    verify: { argv: ['id', '-u', 'agent'] },
    timeoutMs: ACCOUNTS_LIMIT_MS,
    critical: true,
    retry: 'transport',
  };
}

/**
 * builds the step that installs the family's bootstrap packages, skipping
 * the install when all are present
 * @param family the guest's OS family
 * @param packages distribution packages the release bootstraps with
 * @returns a critical step that installs any package missing
 */
function bootstrapStep(
  family: OsFamily,
  packages: readonly string[],
): SetupStep {
  return {
    id: BOOTSTRAP_STEP,
    component: 'system packages',
    account: 'root',
    needs: [ACCOUNTS_STEP],
    check: library(family, [['oa_pkg_installed', ...packages]]),
    apply: library(family, [['oa_pkg_install', ...packages]]),
    verify: library(family, [['oa_pkg_installed', ...packages]]),
    timeoutMs: BOOTSTRAP_LIMIT_MS,
    critical: true,
    retry: 'transport',
  };
}

/**
 * builds the best-effort step that lets every account open an unprivileged
 * ping socket
 * @param family the guest's OS family
 * @returns a non-critical step setting net.ipv4.ping_group_range
 */
function sysctlStep(family: OsFamily): SetupStep {
  return {
    id: SYSCTL_STEP,
    component: 'sysctl',
    account: 'root',
    needs: [BOOTSTRAP_STEP],
    apply: library(family, [
      ['oa_sysctl', 'net.ipv4.ping_group_range', PING_GROUP_RANGE],
    ]),
    timeoutMs: SYSCTL_LIMIT_MS,
    critical: false,
    retry: 'transport',
  };
}
