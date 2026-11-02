import { tmpdir } from 'node:os';

import { describe, expect, it } from 'vitest';

import {
  unrecordedProfile,
  assertSameWorkstationKind,
  readSetupEnvironment,
} from '#application/setup/recorded';
import { defaultProfile } from '#domain/profile';

import { DISABLED_NETWORK_PROFILE } from '../../fixtures/profile';

import { dependencies } from '../../mocks/dependencies';
import { createFilesystemSprite, workstationOf } from '../../mocks/sprites';

import type { GuestChannel } from '#application/ports/guest-channel';

const guest =
  {} satisfies Partial<GuestChannel> as Partial<GuestChannel> as GuestChannel;

describe('fn:unrecordedProfile', () => {
  it('should use defaults when provider metadata has no registered summary', () => {
    const { workstation } = workstationOf(
      createFilesystemSprite({ root: tmpdir() }),
    );

    expect(unrecordedProfile(dependencies, workstation)).toEqual(
      defaultProfile(dependencies.defaults),
    );
  });
});

describe('fn:assertSameWorkstationKind', () => {
  it('should reject a provider change while accepting the recorded agent', () => {
    expect(() =>
      assertSameWorkstationKind(DISABLED_NETWORK_PROFILE, {
        provider: 'other-provider',
      }),
    ).toThrowError(expect.objectContaining({ code: 'INPUT' }));
    expect(() =>
      assertSameWorkstationKind(DISABLED_NETWORK_PROFILE, { agent: 't3' }),
    ).not.toThrow();
  });
});

describe('fn:readSetupEnvironment', () => {
  it('should require full recovery when the guest has no installation record', async () => {
    const wired = {
      ...dependencies,
      guest: {
        ...dependencies.guest,
        environment: {
          ...dependencies.guest.environment,
          find: async () => undefined,
        },
      },
    } satisfies typeof dependencies;

    await expect(
      readSetupEnvironment(wired, guest, 'tools'),
    ).rejects.toMatchObject({ code: 'PREFLIGHT' });
    await expect(
      readSetupEnvironment(wired, guest, 'all'),
    ).resolves.toBeUndefined();
  });
});
