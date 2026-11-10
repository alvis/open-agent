import { describe, expect, it, vi } from 'vitest';

import { createSpritesClient } from '#adapters/drivers/providers/sprite/client';
import { OperationContext, withOperation } from '#kernel/operation';

const { delay } = vi.hoisted(() => ({
  delay: vi.fn(async (_ms: number) => undefined),
}));

vi.mock('node:timers/promises', () => ({ setTimeout: delay }));

/** what undici throws when a connection drops before an answer */
const DROPPED = new TypeError('fetch failed');

/**
 * replaces the network with a request that never answers until its signal aborts
 * @returns the signals each request was issued with
 */
function hangingNetwork(): AbortSignal[] {
  const signals: AbortSignal[] = [];
  vi.stubGlobal('fetch', async (_url: string, init: RequestInit = {}) => {
    const { signal } = init;
    if (signal) {
      signals.push(signal);
    }

    return new Promise<never>((_resolve, reject) => {
      signal?.addEventListener(
        'abort',
        () => reject(new Error('aborted', { cause: signal.reason })),
        {
          once: true,
        },
      );
    });
  });

  return signals;
}

describe('fn:createSpritesClient', () => {
  it('should preserve a non-Error transport rejection', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn<typeof fetch>(async () => new Response())
        .mockRejectedValueOnce('transport closed'),
    );
    const client = createSpritesClient('sdk-only-offline');

    await expect(client.getSprite('unavailable')).rejects.toBe(
      'transport closed',
    );
  });

  it('should abort a hung request as soon as the command is cancelled', async () => {
    const signals = hangingNetwork();
    const controller = new AbortController();
    const operation = new OperationContext({ signal: controller.signal });
    const client = createSpritesClient('sdk-only-cancellable');

    const pending = withOperation(operation, async () =>
      client.getSprite('hung'),
    );
    await vi.waitFor(() => expect(signals).toHaveLength(1));
    controller.abort();

    await expect(pending).rejects.toThrow(/^Network error: /u);
    expect(signals[0]?.aborted).toBe(true);
  });

  it('should send a read again after its connection drops, backing off between attempts', async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>(async () =>
        Response.json({ id: 'sprite-1', name: 'returned' }),
      )
      .mockRejectedValueOnce(DROPPED)
      .mockRejectedValueOnce(DROPPED);
    vi.stubGlobal('fetch', fetch);
    const client = createSpritesClient('sdk-only-retried');

    const sprite = await client.getSprite('returned');

    expect(sprite.name).toBe('returned');
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(delay.mock.calls.map(([ms]) => ms)).toEqual([500, 1000]);
  });

  it('should report a network error once a read has failed every attempt', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => {
      throw DROPPED;
    });
    vi.stubGlobal('fetch', fetch);
    const client = createSpritesClient('sdk-only-unreachable');

    await expect(client.getSprite('unreachable')).rejects.toThrow(
      /^Network error: fetch failed/u,
    );
    expect(fetch).toHaveBeenCalledTimes(4);
  });

  it('should send a write once when its connection drops', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => {
      throw DROPPED;
    });
    vi.stubGlobal('fetch', fetch);
    const client = createSpritesClient('sdk-only-write');

    await expect(client.createSprite('written')).rejects.toThrow(
      /^Network error: fetch failed/u,
    );
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('should stop sending a read again once the command is cancelled during its backoff', async () => {
    const controller = new AbortController();
    const fetch = vi.fn<typeof globalThis.fetch>(async () => {
      throw DROPPED;
    });
    vi.stubGlobal('fetch', fetch);
    delay.mockImplementationOnce(async () => {
      controller.abort();

      throw new Error('aborted');
    });
    const operation = new OperationContext({ signal: controller.signal });
    const client = createSpritesClient('sdk-only-cancelled');

    await expect(
      withOperation(operation, async () => client.getSprite('cancelled')),
    ).rejects.toThrow(/^Network error: fetch failed/u);
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
