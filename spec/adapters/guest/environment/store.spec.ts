import { mkdtempDisposable } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { createEnvironmentAccess } from '#adapters/guest/environment/store';
import { registry } from '#composition/registry';

import { environmentOf } from '../../../fixtures/environment';
import { DISABLED_NETWORK_PROFILE } from '../../../fixtures/profile';
import { createFilesystemSprite, guestOf } from '../../../mocks/sprites';

const access = createEnvironmentAccess(registry);
const RECORDED = environmentOf(DISABLED_NETWORK_PROFILE);

describe('environment access on a guest', () => {
  it('should find nothing before a record exists and read a written record', async () => {
    await using directory = await mkdtempDisposable(
      join(tmpdir(), 'open-agent-environment-'),
    );
    const guest = guestOf(createFilesystemSprite({ root: directory.path }));

    await expect(access.find(guest)).resolves.toBeUndefined();
    await access.write(guest, RECORDED);

    await expect(access.find(guest)).resolves.toEqual(RECORDED);
    await expect(access.read(guest)).resolves.toEqual(RECORDED);
  });

  it('should refuse an invalid profile before writing a record', async () => {
    await using directory = await mkdtempDisposable(
      join(tmpdir(), 'open-agent-environment-'),
    );
    const guest = guestOf(createFilesystemSprite({ root: directory.path }));
    const invalid = {
      ...RECORDED,
      profile: {
        ...RECORDED.profile,
        options: { ...RECORDED.profile.options, holdMaxMinutes: 0 },
      },
    };

    await expect(access.write(guest, invalid)).rejects.toMatchObject({
      code: 'INPUT',
    });
    await expect(access.find(guest)).resolves.toBeUndefined();
  });

  it('should record profile changes', async () => {
    await using directory = await mkdtempDisposable(
      join(tmpdir(), 'open-agent-environment-'),
    );
    const guest = guestOf(createFilesystemSprite({ root: directory.path }));
    const updated = {
      ...DISABLED_NETWORK_PROFILE,
      options: {
        ...DISABLED_NETWORK_PROFILE.options,
        holdMaxMinutes: 30,
      },
    };
    await access.write(guest, RECORDED);

    await access.writeProfile(guest, updated);

    await expect(access.read(guest)).resolves.toMatchObject({
      profile: updated,
    });
  });
});
