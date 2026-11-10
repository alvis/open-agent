import { sleep } from '../timing';

export const API_URL = 'https://api.machines.dev/v1';
export const GRAPHQL_URL = 'https://api.fly.io/graphql';
export const REQUEST_TIMEOUT_MS = 30_000;
const SCHEME = 'FlyV1 ';
/** a wait may be held open for a minute */
const LONG_REQUEST_TIMEOUT_MS = 90_000;
/** a read is sent this often in all before its failure fails a case */
const READ_ATTEMPTS = 4;
const READ_RETRY_MS = 1_000;

/**
 * sends one Machines API request and decodes its JSON answer
 * @param token Fly organization token of the e2e run
 * @param path path below the API base
 * @param request HTTP method and JSON body of the request
 * @param request.method verb of the request, GET unless given
 * @param request.body payload sent as JSON, none unless given
 * @returns decoded answer
 */
export async function flyJson<T>(
  token: string,
  path: string,
  request: { method?: string; body?: unknown } = {},
): Promise<T> {
  const { method = 'GET', body } = request;
  const response = await sendFlyRequest(
    `${API_URL}${path}`,
    {
      method,
      headers: {
        authorization: authorizationOf(token),
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    },
    { timeoutMs: LONG_REQUEST_TIMEOUT_MS },
  );
  const text = await response.text();
  if (!response.ok) {
    throw new Error(
      `Fly ${method} ${path.split('?')[0]} answered ${response.status}`,
    );
  }

  return (text === '' ? undefined : JSON.parse(text)) as T;
}

/**
 * sends one Fly API request; a read is sent again after a failed connection or
 * an expired timeout, since the API at times closes a connection mid-request,
 * while a write is sent once
 * @param url absolute API address
 * @param init request settings, without a signal
 * @param limits per-attempt timeout, and whether the request only reads
 * @param limits.timeoutMs milliseconds each attempt may take
 * @param limits.isRead true for a request that changes nothing, as a GET by default
 * @returns the API's answer
 */
export async function sendFlyRequest(
  url: string,
  init: Omit<RequestInit, 'signal'>,
  limits: { timeoutMs: number; isRead?: boolean },
): Promise<Response> {
  const { timeoutMs, isRead = (init.method ?? 'GET') === 'GET' } = limits;
  const attempts = isRead ? READ_ATTEMPTS : 1;
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await fetch(url, {
        ...init,
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      if (attempt >= attempts) {
        throw error;
      }
    }
    await sleep(READ_RETRY_MS * attempt);
  }
}

/**
 * renders the Machines API authorization header of a token
 * @param token Fly token, with or without its scheme
 * @returns header value
 */
export function authorizationOf(token: string): string {
  return token.startsWith(SCHEME) ? token : `${SCHEME}${token}`;
}
