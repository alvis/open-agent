import { describe, expect, it, vi } from 'vitest';

import {
  preflightTailscale,
  issueTailscaleCredential,
} from '#adapters/drivers/networks/tailscale/preflight';

const boundary = vi.hoisted(
  () =>
    ({
      assertTailnetHostnameAvailable: vi.fn<
        typeof import('#adapters/drivers/networks/tailscale/api').assertTailnetHostnameAvailable
      >(async () => undefined),
      createTailscaleAuthKey: vi.fn<
        typeof import('#adapters/drivers/networks/tailscale/api').createTailscaleAuthKey
      >(async () => 'enrollment-key'),
    }) satisfies Partial<
      typeof import('#adapters/drivers/networks/tailscale/api')
    >,
);
vi.mock(
  '#adapters/drivers/networks/tailscale/api',
  () =>
    boundary satisfies Partial<
      typeof import('#adapters/drivers/networks/tailscale/api')
    >,
);
const management = { credential: 'test-key', account: 'example.ts.net' };

describe('fn:preflightTailscale', () => {
  it('should report a hostname failure as a problem', async () => {
    const availability = new Error('hostname occupied');
    boundary.assertTailnetHostnameAvailable.mockRejectedValueOnce(availability);

    expect(
      await preflightTailscale({ hostname: 'workstation', management }),
    ).toEqual({ problems: [availability] });
  });

  it('should pass after successful management checks', async () => {
    expect(
      await preflightTailscale({ hostname: 'workstation', management }),
    ).toEqual({ problems: [] });
  });

  it.each([
    { hostname: 'workstation' },
    { hostname: 'workstation', management: { credential: 'test-key' } },
  ])(
    'should omit unavailable management checks for $management',
    async (params) => {
      expect(await preflightTailscale(params)).toEqual({ problems: [] });
      expect(boundary.assertTailnetHostnameAvailable).not.toHaveBeenCalled();
    },
  );
});

describe('Tailscale management prerequisites', () => {
  it('should reject credential issuance without a management account', async () => {
    await expect(
      issueTailscaleCredential({ credential: 'test-key' }),
    ).rejects.toMatchObject({ code: 'INPUT' });
  });

  it('should issue a transient enrollment key', async () => {
    expect(await issueTailscaleCredential(management)).toBe('enrollment-key');
  });
});
