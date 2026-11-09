import { describe, expect, it, vi } from 'vitest';

import { FlyApi } from '#adapters/drivers/providers/fly-machine/api';
import { createManagedApp } from '#adapters/drivers/providers/fly-machine/creation';
import { InteractionExit } from '#kernel/navigation';
import { OperationContext, withOperation } from '#kernel/operation';

import { DISABLED_NETWORK_PROFILE } from '../../../../fixtures/profile';

import type { ProfileOptions, WorkstationProfile } from '#domain/profile';

interface Request {
  method: string;
  path: string;
}

const PROFILE: WorkstationProfile = {
  ...DISABLED_NETWORK_PROFILE,
  provider: 'fly-machine',
};

function reply(body: unknown, status = 200): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/**
 * serves one create attempt through the real Fly HTTP client
 * @param replies queued provider answers
 * @param onRequest optional action at a request boundary
 * @returns requests observed in order
 */
function useReplies(
  replies: readonly Response[],
  onRequest?: (request: Request) => void,
): Request[] {
  const remaining = [...replies];
  const seen: Request[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn<typeof fetch>(async (input, init) => {
      const url = new URL(
        input instanceof globalThis.Request ? input.url : input,
      );
      const request = { method: init?.method ?? 'GET', path: url.pathname };
      seen.push(request);
      onRequest?.(request);

      return remaining.shift() ?? reply({ error: 'unexpected request' }, 400);
    }),
  );

  return seen;
}

/**
 * reads the JSON bodies the stubbed fetch sent to one path
 * @param path request path
 * @returns decoded bodies in request order
 */
function sentBodies(path: string): unknown[] {
  return vi
    .mocked(fetch)
    .mock.calls.filter(
      ([input]) =>
        new URL(input instanceof globalThis.Request ? input.url : input)
          .pathname === path,
    )
    .map(([, init]) =>
      typeof init?.body === 'string'
        ? (JSON.parse(init.body) as unknown)
        : undefined,
    );
}

async function create(profile: WorkstationProfile = PROFILE): Promise<unknown> {
  return createManagedApp({
    api: new FlyApi('token'),
    name: 'alpha',
    organization: 'team',
    region: 'lhr',
    profile,
    port: 3773,
  });
}

describe('Fly app creation reconciliation', () => {
  it('should report a globally taken app name without deleting or looking up another account’s app', async () => {
    const seen = useReplies([reply({ error: 'name already taken' }, 422)]);

    await expect(create()).rejects.toMatchObject({
      machine: 'alpha',
      outcome: 'absent',
      cause: expect.objectContaining({ code: 'conflict' }),
    });
    expect(seen).toEqual([{ method: 'POST', path: '/v1/apps' }]);
  });

  it('should report an indeterminate create when the failed write left a visible app', async () => {
    const seen = useReplies([
      reply({ error: 'request refused' }, 400),
      reply({
        id: 'app-1',
        name: 'alpha',
        internal_numeric_id: 42,
        organization: { slug: 'team' },
      }),
    ]);

    await expect(create()).rejects.toMatchObject({
      machine: 'alpha',
      outcome: 'unknown',
      cause: expect.objectContaining({ code: 'failed' }),
    });
    expect(seen).toEqual([
      { method: 'POST', path: '/v1/apps' },
      { method: 'GET', path: '/v1/apps/alpha' },
    ]);
  });

  it('should report an unknown outcome when reconciliation cannot read the app', async () => {
    const seen = useReplies([
      reply({ error: 'request refused' }, 400),
      reply({ error: 'lookup forbidden' }, 403),
    ]);

    await expect(create()).rejects.toMatchObject({
      machine: 'alpha',
      outcome: 'unknown',
      cause: expect.objectContaining({ code: 'failed' }),
    });
    expect(seen).toEqual([
      { method: 'POST', path: '/v1/apps' },
      { method: 'GET', path: '/v1/apps/alpha' },
    ]);
  });

  it('should accept concurrent removal of its app during cleanup and confirm absence', async () => {
    const seen = useReplies([
      reply(undefined, 204),
      reply({ error: 'volume unavailable' }, 400),
      reply({ error: 'already removed' }, 404),
      reply({ error: 'missing' }, 404),
    ]);

    await expect(create()).rejects.toMatchObject({
      machine: 'alpha',
      outcome: 'absent',
      cause: expect.objectContaining({ code: 'failed' }),
    });
    expect(seen).toEqual([
      { method: 'POST', path: '/v1/apps' },
      { method: 'POST', path: '/v1/apps/alpha/volumes' },
      { method: 'DELETE', path: '/v1/apps/alpha' },
      { method: 'GET', path: '/v1/apps/alpha' },
    ]);
  });

  it('should reconcile a cancelled app create outside the cancelled operation', async () => {
    const controller = new AbortController();
    const seen = useReplies(
      [reply(undefined, 204), reply({ error: 'missing' }, 404)],
      ({ path }) => {
        if (path === '/v1/apps') {
          controller.abort();
        }
      },
    );
    const operation = new OperationContext({ signal: controller.signal });

    await expect(withOperation(operation, create)).rejects.toMatchObject({
      outcome: 'absent',
      cause: new InteractionExit('cancel'),
    });
    expect(seen).toEqual([
      { method: 'POST', path: '/v1/apps' },
      { method: 'GET', path: '/v1/apps/alpha' },
    ]);
  });

  it('should report an unknown outcome when cleanup cannot remove its app', async () => {
    const seen = useReplies([
      reply(undefined, 204),
      reply({ error: 'volume unavailable' }, 400),
      reply({ error: 'delete refused' }, 403),
    ]);

    await expect(create()).rejects.toMatchObject({
      machine: 'alpha',
      outcome: 'unknown',
      cause: expect.objectContaining({ code: 'failed' }),
    });
    expect(seen).toEqual([
      { method: 'POST', path: '/v1/apps' },
      { method: 'POST', path: '/v1/apps/alpha/volumes' },
      { method: 'DELETE', path: '/v1/apps/alpha' },
    ]);
  });

  it('should clean up an app after cancellation during volume creation', async () => {
    const controller = new AbortController();
    const seen = useReplies(
      [
        reply(undefined, 204),
        reply({ id: 'volume-1' }),
        reply(undefined, 204),
        reply({ error: 'missing' }, 404),
      ],
      ({ path }) => {
        if (path === '/v1/apps/alpha/volumes') {
          controller.abort();
        }
      },
    );
    const operation = new OperationContext({ signal: controller.signal });

    await expect(withOperation(operation, create)).rejects.toMatchObject({
      outcome: 'absent',
      cause: new InteractionExit('cancel'),
    });
    expect(seen).toEqual([
      { method: 'POST', path: '/v1/apps' },
      { method: 'POST', path: '/v1/apps/alpha/volumes' },
      { method: 'DELETE', path: '/v1/apps/alpha' },
      { method: 'GET', path: '/v1/apps/alpha' },
    ]);
  });
});

describe('Fly machine selection before creation', () => {
  it('should refuse an unsupported machine before sending a provider request', async () => {
    const seen = useReplies([]);
    const profile = {
      ...PROFILE,
      options: { ...PROFILE.options, minCpus: 32, minMemoryGb: 256 },
    } satisfies WorkstationProfile;
    const attempt = create(profile);

    await expect(attempt).rejects.toMatchObject({
      name: 'ProviderFault',
      code: 'failed',
      message: expect.stringMatching(/32 CPUs.*256 GB/),
    });
    expect(seen).toEqual([]);
  });
});

describe('Fly storage at creation', () => {
  it.each<{
    storage: string;
    options: Partial<ProfileOptions>;
    sizeGb: number;
    growth: Record<string, number>;
  }>([
    {
      storage: 'default size, growing by the default policy',
      options: {},
      sizeGb: 10,
      growth: {
        extend_threshold_percent: 80,
        add_size_gb: 10,
        size_gb_limit: 100,
      },
    },
    {
      storage: 'requested minimum, growing by the requested policy',
      options: {
        minStorageGb: 40,
        autoExtendThresholdPercent: 85,
        autoExtendStepGb: 5,
        storageLimitGb: 200,
      },
      sizeGb: 40,
      growth: {
        extend_threshold_percent: 85,
        add_size_gb: 5,
        size_gb_limit: 200,
      },
    },
    {
      storage: 'requested minimum, growing up to a limit raised to that size',
      options: { minStorageGb: 150 },
      sizeGb: 150,
      growth: {
        extend_threshold_percent: 80,
        add_size_gb: 10,
        size_gb_limit: 150,
      },
    },
    {
      storage: 'default size, never growing when automatic growth is off',
      options: { autoExtend: false },
      sizeGb: 10,
      growth: {},
    },
  ])(
    'should create the volume at the $storage',
    async ({ options, sizeGb, growth }) => {
      useReplies([
        reply(undefined, 204),
        reply({ id: 'volume-1' }),
        reply({ id: 'machine-1', state: 'created' }),
        reply(undefined, 204),
      ]);

      await create({ ...PROFILE, options: { ...PROFILE.options, ...options } });

      expect({
        volumes: sentBodies('/v1/apps/alpha/volumes'),
        machines: sentBodies('/v1/apps/alpha/machines'),
      }).toEqual({
        volumes: [{ name: 'open_agent', region: 'lhr', size_gb: sizeGb }],
        machines: [
          expect.objectContaining({
            config: expect.objectContaining({
              mounts: [{ volume: 'volume-1', path: '/data', ...growth }],
            }),
          }),
        ],
      });
    },
  );
});
