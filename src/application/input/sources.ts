import { parse } from 'dotenv';

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
}

const KEYCHAIN_REFERENCE_PARTS = 2;

/**
 * reads credential environment sources
 * @param dependencies what this computer provides
 * @param options explicitly selected credential file
 * @returns process and file values; the file takes precedence
 */
export async function readEnvironmentSources(
  dependencies: Pick<ApplicationDependencies, 'host'>,
  options: CommandOptions,
): Promise<InputSources> {
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
