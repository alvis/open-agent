import {
  guestFileExists,
  readGuestFile,
  writeGuestFile,
} from '#adapters/guest/platform/files';
import { ENVIRONMENT_PATH } from '#adapters/guest/platform/layout';
import { validateProfile } from '#domain/profile';
import { CommandFault } from '#kernel/faults';

import {
  ENVIRONMENT_MODE,
  parseEnvironment,
  serializeEnvironment,
} from './contracts';

import type { GuestEnvironmentAccess } from '#application/ports/guest';
import type { GuestChannel } from '#application/ports/guest-channel';
import type { ProductDeclarations } from '#domain/declarations';
import type { GuestEnvironment } from '#domain/observations/environment';
import type { WorkstationProfile } from '#domain/profile';

/**
 * builds the access to the environment setup recorded on a guest
 * @param declarations the data every registered driver declares, which a recorded profile is checked against
 * @returns the environment reads and writes
 */
export function createEnvironmentAccess(
  declarations: ProductDeclarations,
): GuestEnvironmentAccess {
  const read = async (guest: GuestChannel): Promise<GuestEnvironment> =>
    readGuestEnvironment(declarations, guest);
  const write = async (
    guest: GuestChannel,
    environment: GuestEnvironment,
  ): Promise<void> => writeGuestEnvironment(declarations, guest, environment);

  return {
    read,
    find: async (guest) =>
      (await guestFileExists(guest, ENVIRONMENT_PATH))
        ? read(guest)
        : undefined,
    write,
    writeProfile: async (guest, profile) =>
      writeGuestProfile(declarations, guest, profile),
  };
}

/**
 * reads the environment setup recorded on the guest
 * @param declarations the data every registered driver declares
 * @param guest target guest
 * @returns the record
 */
async function readGuestEnvironment(
  declarations: ProductDeclarations,
  guest: GuestChannel,
): Promise<GuestEnvironment> {
  return parseEnvironment(
    declarations,
    await readGuestFile(guest, ENVIRONMENT_PATH),
  );
}

/**
 * replaces the recorded environment atomically, readable by every account
 * @param declarations the data every registered driver declares
 * @param guest target guest
 * @param environment the record
 * @throws {CommandFault} when the record's profile is invalid
 */
async function writeGuestEnvironment(
  declarations: ProductDeclarations,
  guest: GuestChannel,
  environment: GuestEnvironment,
): Promise<void> {
  const validation = validateProfile({
    declarations,
    candidate: environment.profile,
  });
  if (!validation.isValid) {
    throw new CommandFault({
      code: 'INPUT',
      message: validation.violations.map(({ message }) => message).join('; '),
    });
  }
  await writeGuestFile(guest, {
    path: ENVIRONMENT_PATH,
    contents: serializeEnvironment(environment),
    mode: ENVIRONMENT_MODE,
  });
}

/**
 * records a profile whose change no tool or service follows
 * @param declarations the data every registered driver declares
 * @param guest target guest
 * @param profile the profile to record
 */
async function writeGuestProfile(
  declarations: ProductDeclarations,
  guest: GuestChannel,
  profile: WorkstationProfile,
): Promise<void> {
  const environment = await readGuestEnvironment(declarations, guest);
  await writeGuestEnvironment(declarations, guest, {
    ...environment,
    profile,
  });
}
