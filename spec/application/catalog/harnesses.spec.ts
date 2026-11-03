import { describe, expect, it, vi } from 'vitest';

import {
  configureHarnesses,
  harnessDrivers,
} from '#application/catalog/harnesses';
import { registry } from '#composition/registry';

import type { GuestChannel } from '#application/ports/guest-channel';

describe('fn:configureHarnesses', () => {
  it('should configure each harness', async () => {
    const configure = vi.fn<typeof registry.harnesses.claude.configure>(
      async () => undefined,
    );
    const driver = {
      ...registry.harnesses.claude,
      configure,
    } satisfies typeof registry.harnesses.claude;
    const guest =
      {} satisfies Partial<GuestChannel> as Partial<GuestChannel> as GuestChannel;

    await configureHarnesses(guest, { drivers: [driver] });

    expect(configure.mock.calls).toEqual([[guest]]);
  });
});

describe('fn:harnessDrivers', () => {
  it('should resolve drivers in the requested order', () => {
    expect(harnessDrivers(registry, ['claude']).map(({ id }) => id)).toEqual([
      'claude',
    ]);
  });
});
