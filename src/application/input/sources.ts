import { parse } from 'dotenv';

import { harnessEnvironmentNames } from '#domain/environment-names';
import { HARNESS_IDS } from '#domain/ids';
import { selectionInputs } from '#domain/selection-inputs';
import { CommandFault } from '#kernel/faults';
import { checkOperation } from '#kernel/operation';

import { rememberSecret } from '#kernel/redaction';

import type { CommandOptions } from '#application/contracts';
import type { ApplicationDependencies } from '#application/ports/dependencies';

/** process and file inputs available to selection resolution */
export interface InputSources {
  processEnv: NodeJS.ProcessEnv;
  /** entries of the selected credential file */
  fileEnv: Record<string, string>;
  /** entries of the selected guest env file; absent without --env-file */
  runtimeFileEnv?: Record<string, string>;
  /** exact bytes of the selected setup file; absent without --setup-file */
  setupFile?: Buffer;
}

/**
 * names the process environment may not supply as input files
 * @param dependencies the registered drivers
 * @returns the names
 */
function reservedEnv(
  dependencies: Pick<ApplicationDependencies, 'registry'>,
): Set<string> {
  return new Set([
    ...Object.values(dependencies.registry.providers).map(
      ({ prerequisites }) => prerequisites.credential.environment,
    ),
    ...Object.values(selectionInputs()).map(({ environment }) => environment),
    'GH_TOKEN',
    'GITHUB_TOKEN',
    'GIT_AUTHOR_NAME',
    'GIT_AUTHOR_EMAIL',
    'GIT_COMMITTER_NAME',
    'GIT_COMMITTER_EMAIL',
    'NON_INTERACTIVE',
    'CI',
    'TERM',
    'NO_COLOR',
  ]);
}
/**
 * names no input source may set
 * @param dependencies the registered drivers
 * @returns the names
 */
function rejectedEnv(
  dependencies: Pick<ApplicationDependencies, 'registry'>,
): Set<string> {
  return new Set([
    'HOME',
    'PATH',
    'SHELL',
    'IFS',
    'ENV',
    'BASH_ENV',
    'CDPATH',
    'LD_PRELOAD',
    'LD_LIBRARY_PATH',
    'NODE_OPTIONS',
    'NODE_PATH',
    'PYTHONPATH',
    'PYTHONSTARTUP',
    'RUBYOPT',
    'PERL5OPT',
    'GIT_CONFIG_GLOBAL',
    'GIT_CONFIG_SYSTEM',
    'GIT_SSH_COMMAND',
    'GIT_ASKPASS',
    'SSH_ASKPASS',
    ...harnessEnvironmentNames(dependencies.registry, HARNESS_IDS),
    'HTTP_PROXY',
    'HTTPS_PROXY',
    'ALL_PROXY',
    'NO_PROXY',
  ]);
}

const KEYCHAIN_REFERENCE_PARTS = 2;

/**
 * filters the guest env file to runtime variables safe to forward to the guest
 * @param dependencies the registered drivers
 * @param fileEnv parsed entries from the selected guest env file
 * @returns variables permitted in the guest runtime environment
 */
export function runtimeEnvironment(
  dependencies: Pick<ApplicationDependencies, 'registry'>,
  fileEnv: Record<string, string>,
): Record<string, string> {
  const conflicts = Object.keys(fileEnv).filter(
    (name) =>
      rejectedEnv(dependencies).has(name) ||
      /^(?:DYLD_|LD_|GIT_CONFIG_|NPM_CONFIG_)/i.test(name),
  );
  if (conflicts.length > 0) {
    throw new CommandFault({
      code: 'INPUT',
      message: `Unsupported runtime environment overrides: ${conflicts.join(', ')}`,
    });
  }

  const selected = Object.fromEntries(
    Object.entries(fileEnv).filter(
      ([name]) => !reservedEnv(dependencies).has(name),
    ),
  );
  Object.values(selected).forEach(rememberSecret);

  return selected;
}

/**
 * reads process, selected credential and guest env files
 * @param dependencies what this computer provides
 * @param options parsed credential-file and env-file options
 * @returns sources in documented precedence order
 */
export async function readInputSources(
  dependencies: Pick<ApplicationDependencies, 'host'>,
  options: CommandOptions,
): Promise<InputSources> {
  const environment = await readEnvironmentSources(dependencies, options);
  const runtimeFileEnv = options.envFile
    ? parse(await readInputText(dependencies, options.envFile, 'env file'))
    : undefined;
  const setupFile = options.setupFile
    ? await readSetupFile(dependencies, options.setupFile)
    : undefined;

  return { ...environment, runtimeFileEnv, setupFile };
}

/**
 * reads credential environment sources
 * @param dependencies what this computer provides
 * @param options explicitly selected credential file
 * @returns process and file values; the file takes precedence
 */
export async function readEnvironmentSources(
  dependencies: Pick<ApplicationDependencies, 'host'>,
  options: CommandOptions,
): Promise<Pick<InputSources, 'processEnv' | 'fileEnv'>> {
  const fileEnv = options.credentialFile
    ? parse(
        await readInputText(
          dependencies,
          options.credentialFile,
          'credential file',
        ),
      )
    : {};

  return { processEnv: dependencies.host.environment.variables(), fileEnv };
}

/**
 * resolves an explicit local secret reference or fallback value
 * @param dependencies what this computer provides
 * @param reference optional environment, file, or keychain reference
 * @param fallback value from lower-precedence sources
 * @returns the selected secret without printing it
 */
export async function resolveSecret(
  dependencies: Pick<ApplicationDependencies, 'host'>,
  reference: string | undefined,
  fallback: string | undefined,
): Promise<string | undefined> {
  if (!reference) {
    return registerResolved(fallback?.length ? fallback : undefined);
  }
  if (reference.startsWith('env:')) {
    const name = reference.slice('env:'.length);
    const value = dependencies.host.environment.variables()[name];
    if (!value) {
      throw new CommandFault({
        code: 'INPUT',
        message: `Environment variable ${JSON.stringify(name)} is empty or unset.`,
      });
    }

    return registerResolved(value);
  }
  if (reference.startsWith('file:')) {
    const path = reference.slice('file:'.length);
    const value = (
      await readInputText(dependencies, path, 'secret file')
    ).trimEnd();
    if (!value) {
      throw new CommandFault({
        code: 'INPUT',
        message: `Secret file ${JSON.stringify(path)} is empty.`,
      });
    }

    return registerResolved(value);
  }
  if (reference.startsWith('keychain:')) {
    const [service, account] = reference
      .slice('keychain:'.length)
      .split('/', KEYCHAIN_REFERENCE_PARTS);
    if (!service || !account) {
      throw new CommandFault({
        code: 'INPUT',
        message: 'Keychain reference must be keychain:service/account',
      });
    }

    return registerResolved(await readKeychain(dependencies, service, account));
  }
  throw new CommandFault({
    code: 'INPUT',
    message:
      'Secret source must be env:NAME, file:PATH, or keychain:SERVICE/ACCOUNT',
  });
}

/**
 * reads one generic password from the caller's keychain
 * @param dependencies what this computer provides
 * @param service keychain service name
 * @param account keychain account name
 * @returns the stored secret
 */
async function readKeychain(
  dependencies: Pick<ApplicationDependencies, 'host'>,
  service: string,
  account: string,
): Promise<string> {
  return dependencies.host
    .run({
      program: 'security',
      arguments: ['find-generic-password', '-s', service, '-a', account, '-w'],
    })
    .catch((cause: unknown) => {
      checkOperation();
      throw new CommandFault({
        code: 'INPUT',
        message: 'Selected keychain secret source could not be read.',
        cause,
      });
    });
}

/**
 * registers a successfully selected secret before it leaves its source
 * @param value selected credential, if available
 * @returns the same selected credential
 */
function registerResolved(value: string | undefined): string | undefined {
  rememberSecret(value);

  return value;
}

/**
 * classifies selected local files as input faults without disclosing their contents
 * @param dependencies what this computer provides
 * @param path explicitly selected environment or secret file
 * @param source selected file kind for a safe diagnostic
 * @returns complete local input text
 */
async function readInputText(
  dependencies: Pick<ApplicationDependencies, 'host'>,
  path: string,
  source: string,
): Promise<string> {
  try {
    return await dependencies.host.readInputFile(path);
  } catch (cause) {
    checkOperation();
    throw new CommandFault({
      code: 'INPUT',
      message: `Selected ${source} ${JSON.stringify(path)} must be a readable regular file.`,
      cause,
      causeVisibility: 'private',
    });
  }
}

/**
 * reads the selected setup file's exact bytes, refusing an empty one
 * @param dependencies what this computer provides
 * @param path selected setup file
 * @returns the file's contents
 */
export async function readSetupFile(
  dependencies: Pick<ApplicationDependencies, 'host'>,
  path: string,
): Promise<Buffer> {
  const contents = await dependencies.host
    .readInputBytes(path)
    .catch((cause: unknown) => {
      checkOperation();
      throw new CommandFault({
        code: 'INPUT',
        message: `Selected setup file ${JSON.stringify(path)} must be a readable regular file.`,
        cause,
        causeVisibility: 'private',
      });
    });
  if (!contents.length) {
    throw new CommandFault({
      code: 'INPUT',
      message: `Selected setup file ${JSON.stringify(path)} is empty.`,
    });
  }

  return contents;
}
