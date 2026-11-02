import { describe, expect, it, vi } from 'vitest';

import {
  assertTailnetHostnameAvailable,
  createTailscaleAuthKey,
  deleteTailnetDevice,
  findTailnetDevice,
} from '#adapters/drivers/networks/tailscale/api';

const devices = [
  {
    id: 'api-id',
    nodeId: 'node-id',
    name: 'Home.example.ts.net',
    hostname: 'router',
  },
  { id: 'minimal', name: 'minimal.example.ts.net' },
];
const http = {
  fetch: vi.fn<typeof fetch>(async (input, options) => {
    const path = new URL(
      input instanceof Request ? input.url : input.toString(),
    ).pathname;
    if (path.endsWith('/keys')) {
      return Response.json({ key: 'enrollment-key' });
    }
    if (options?.method === 'DELETE') {
      return new Response(null, { status: 204 });
    }

    return Response.json({ devices });
  }),
} satisfies Partial<typeof globalThis>;

describe('fn:assertTailnetHostnameAvailable', () => {
  it.each(['ROUTER.', 'Home.example.ts.net', 'home'])(
    'should reject the existing hostname %s',
    async (name) => {
      vi.stubGlobal('fetch', http.fetch);

      await expect(
        assertTailnetHostnameAvailable('test-key', 'example.ts.net', name),
      ).rejects.toMatchObject({ code: 'CONFLICT' });
    },
  );

  it('should accept a name absent from every device alias', async () => {
    vi.stubGlobal('fetch', http.fetch);

    await expect(
      assertTailnetHostnameAvailable(
        'test-key',
        'example.ts.net',
        'new-workstation',
      ),
    ).resolves.toBeUndefined();
  });
});

describe('fn:createTailscaleAuthKey', () => {
  it('should issue a single-use preauthorized key for the resolved tailnet', async () => {
    vi.stubGlobal('fetch', http.fetch);

    expect(await createTailscaleAuthKey('test-key', ' example.ts.net ')).toBe(
      'enrollment-key',
    );
    expect(http.fetch).toHaveBeenCalledWith(
      new URL('https://api.tailscale.com/api/v2/tailnet/example.ts.net/keys'),
      expect.objectContaining({
        method: 'POST',
        headers: {
          'Authorization': 'Bearer test-key',
          'Content-Type': 'application/json',
        },
        body: expect.stringContaining('"reusable":false'),
      }),
    );
  });

  it('should reject an absent enrollment key', async () => {
    vi.stubGlobal('fetch', http.fetch);
    http.fetch
      .mockImplementationOnce(async () => Response.json({ devices }))
      .mockImplementationOnce(async () => Response.json({}));

    await expect(
      createTailscaleAuthKey('test-key', 'example.ts.net'),
    ).rejects.toMatchObject({ code: 'PROVIDER' });
  });
});

describe('tailnet device management', () => {
  it.each(['api-id', 'node-id', 'missing'])(
    'should find only the device with the recorded identity %s',
    async (id) => {
      vi.stubGlobal('fetch', http.fetch);

      expect(await findTailnetDevice('test-key', 'example.ts.net', id)).toEqual(
        id === 'missing' ? undefined : { name: 'Home.example.ts.net' },
      );
    },
  );

  it('should delete the encoded device identity without decoding an empty response', async () => {
    vi.stubGlobal('fetch', http.fetch);

    await expect(
      deleteTailnetDevice('test-key', 'device/id'),
    ).resolves.toBeUndefined();
    expect(http.fetch).toHaveBeenCalledWith(
      new URL('https://api.tailscale.com/api/v2/device/device%2Fid'),
      expect.objectContaining({ method: 'DELETE' }),
    );
  });

  it.each([
    { status: 401, tailnet: 'short', code: 'AUTH' },
    { status: 403, tailnet: 'short', code: 'AUTH' },
    { status: 500, tailnet: 'short', code: 'PROVIDER' },
    { status: 404, tailnet: 'example.ts.net', code: 'PROVIDER' },
  ])(
    'should preserve HTTP $status as a $code failure without retrying',
    async ({ status, tailnet, code }) => {
      vi.stubGlobal('fetch', http.fetch);
      http.fetch.mockImplementationOnce(
        async () => new Response('private response', { status }),
      );

      await expect(
        findTailnetDevice('private-key', tailnet, 'id'),
      ).rejects.toMatchObject({
        code,
        status,
        message: expect.not.stringContaining('private'),
      });
      expect(http.fetch.mock.calls).toHaveLength(1);
    },
  );

  it('should retry a missing short tailnet as its lowercase DNS name', async () => {
    vi.stubGlobal('fetch', http.fetch);
    http.fetch.mockImplementationOnce(
      async () => new Response(null, { status: 404 }),
    );

    expect(await findTailnetDevice('test-key', ' My-Net ', 'api-id')).toEqual({
      name: 'Home.example.ts.net',
    });
    expect(
      http.fetch.mock.calls.map(([url]) =>
        url instanceof Request ? url.url : url.toString(),
      ),
    ).toEqual([
      'https://api.tailscale.com/api/v2/tailnet/My-Net/devices?fields=all',
      'https://api.tailscale.com/api/v2/tailnet/my-net.ts.net/devices?fields=all',
    ]);
  });

  it('should preserve a device deletion HTTP failure without treating it as tailnet resolution', async () => {
    vi.stubGlobal('fetch', http.fetch);
    http.fetch.mockImplementationOnce(
      async () => new Response(null, { status: 404 }),
    );

    await expect(deleteTailnetDevice('test-key', 'gone')).rejects.toMatchObject(
      { code: 'PROVIDER', status: 404 },
    );
  });
});
