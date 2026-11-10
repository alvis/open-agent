import { setTimeout as delay } from 'node:timers/promises';

import { SpritesClient } from '@fly/sprites';

import { currentOperation } from '#kernel/operation';

/** bounds every Sprites API request independently of command cancellation */
const REQUEST_TIMEOUT_MS = 30_000;
/** a read is tried this often in all before a network failure is reported */
const READ_ATTEMPTS = 4;
const RETRY_BASE_MS = 500;
/** methods that only read, so repeating one never acts twice */
const READ_METHODS: ReadonlySet<string> = new Set(['GET', 'HEAD']);

/**
 * binds a Sprites API token to a client whose requests end when the command is
 * cancelled, not only when the SDK's own timeout elapses
 * @param credential Sprites API token
 * @returns an SDK client whose requests also end on cancellation
 */
export function createSpritesClient(credential: string): SpritesClient {
  const client = new SpritesClient(credential, { timeout: REQUEST_TIMEOUT_MS });

  // the SDK routes every client request through this member and accepts no caller signal
  return Object.assign(client, { fetch: cancellableFetch });
}

/**
 * issues one request that also aborts with the current command's signal,
 * failing the way the SDK's own request wrapper does; a read whose connection
 * fails is sent again with an exponential backoff, while a write is sent once,
 * because repeating it could act twice
 * @param url request URL
 * @param init request settings, carrying the SDK's timeout signal
 * @returns the response
 */
async function cancellableFetch(
  url: string,
  init: RequestInit = {},
): Promise<Response> {
  const signal = AbortSignal.any(
    [init.signal, currentOperation()?.signal].filter(
      (candidate): candidate is AbortSignal => candidate instanceof AbortSignal,
    ),
  );
  // the SDK names the method of every request; one it does not name is sent once
  const attempts = READ_METHODS.has(String(init.method).toUpperCase())
    ? READ_ATTEMPTS
    : 1;
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await fetch(url, { ...init, signal });
    } catch (error) {
      if (!(error instanceof Error)) {
        throw error;
      }
      // a cancelled or timed-out request is never sent again
      if (attempt >= attempts || signal.aborted) {
        throw new Error(`Network error: ${error.message}`, { cause: error });
      }
    }
    await delay(RETRY_BASE_MS * 2 ** (attempt - 1), undefined, {
      signal,
    }).catch(() => undefined);
  }
}
