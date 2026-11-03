import { describe, expect, it, vi } from 'vitest';

import {
  configureHarnesses,
  harnessDrivers,
} from '#application/catalog/harnesses';
import { registry } from '#composition/registry';

import type { GuestChannel } from '#application/ports/guest-channel';

describe('fn:configureHarnesses', () => {
  it('should configure each harness before installing its awake hooks', async () => {
    const configure = vi.fn<typeof registry.harnesses.claude.configure>(
      async () => undefined,
    );
    const install = vi.fn<typeof registry.harnesses.claude.hooks.install>(
      async () => undefined,
    );
    const driver = {
      ...registry.harnesses.claude,
      configure,
      hooks: { ...registry.harnesses.claude.hooks, install },
    } satisfies typeof registry.harnesses.claude;
    const guest =
      {} satisfies Partial<GuestChannel> as Partial<GuestChannel> as GuestChannel;
    const awakeHook = { program: '/bin/true' };

    await configureHarnesses(guest, { drivers: [driver], awakeHook });

    expect(configure.mock.calls).toEqual([[guest]]);
    expect(install.mock.calls).toEqual([[guest, awakeHook]]);
  });
});

describe('fn:harnessDrivers', () => {
  it('should resolve drivers in the requested order', () => {
    expect(harnessDrivers(registry, ['claude']).map(({ id }) => id)).toEqual([
      'claude',
    ]);
  });
});
