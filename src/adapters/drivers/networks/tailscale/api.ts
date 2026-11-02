import { CommandFault } from '#kernel/faults';
import {
  operationSignal,
  checkOperation,
  runOperation,
} from '#kernel/operation';
import { rememberSecret } from '#kernel/redaction';

interface TailnetDevice {
  id: string;
  nodeId?: string;
  name: string;
  hostname?: string;
}

interface TailnetDeviceList {
  devices: TailnetDevice[];
}

interface TailnetKeyResponse {
  key: string;
}

interface ResolvedTailnet {
  id: string;
  devices: TailnetDevice[];
}

interface TailnetApiErrorParams {
  method: string;
  path: string;
  status: number;
}

const API_BASE = 'https://api.tailscale.com/api/v2';
const API_TIMEOUT_MS = 30_000;
const ENROLLMENT_KEY_EXPIRY_SECONDS = 3_600;
const NO_CONTENT_STATUS = 204;
const NOT_FOUND_STATUS = 404;
const UNAUTHENTICATED_STATUS = 401;
const ACCESS_DENIED_STATUS = 403;
const DNS_LABEL = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i;

/** HTTP failure retaining status without exposing credentials or response bodies */
class TailnetApiError extends CommandFault {
  public readonly status: number;

  /**
   * retains HTTP status for bounded read-only tailnet resolution
   * @param params non-secret method, path, and HTTP status
   * @param params.method HTTP request method
   * @param params.path endpoint path relative to the Tailscale API base
   * @param params.status observed HTTP status
   */
  constructor({ method, path, status }: TailnetApiErrorParams) {
    const action =
      status === UNAUTHENTICATED_STATUS
        ? 'Check TAILSCALE_API_KEY validity and expiry.'
        : status === ACCESS_DENIED_STATUS
          ? 'Grant the selected Tailscale API key the management permissions required by this operation.'
          : status === NOT_FOUND_STATUS && path.startsWith('/tailnet/')
            ? 'Check TAILSCALE_TAILNET against its API ID or DNS name in Tailscale settings.'
            : '';
    super({
      code:
        status === UNAUTHENTICATED_STATUS || status === ACCESS_DENIED_STATUS
          ? 'AUTH'
          : 'PROVIDER',
      message: [`Tailscale API ${method} ${path} returned ${status}`, action]
        .filter(Boolean)
        .join('; '),
    });
    this.name = 'TailnetApiError';
    this.status = status;
  }
}

/**
 * rejects a name already assigned to a device in the selected tailnet
 * @param apiKey management API credential
 * @param tailnet tailnet identity
 * @param name proposed Sprite and Tailscale hostname
 * @returns when the name is available
 */
export async function assertTailnetHostnameAvailable(
  apiKey: string,
  tailnet: string,
  name: string,
): Promise<void> {
  const response = await resolveTailnet(apiKey, tailnet);
  const expected = name.toLowerCase().replace(/\.$/, '');
  const collision = response.devices.some((device) =>
    [device.hostname, device.name, device.name.split('.')[0]].some(
      (candidate) => candidate?.toLowerCase().replace(/\.$/, '') === expected,
    ),
  );
  if (collision) {
    throw new CommandFault({
      code: 'CONFLICT',
      message: `Tailnet hostname ${name} is already assigned to a device`,
    });
  }
}

/**
 * creates one short lived, single use, persistent-device enrolment key
 * @param apiKey Tailscale management API credential
 * @param tailnet tailnet identity
 * @returns one-use enrolment key
 */
export async function createTailscaleAuthKey(
  apiKey: string,
  tailnet: string,
): Promise<string> {
  const resolved = await resolveTailnet(apiKey, tailnet);
  const response = await requestTailnet<TailnetKeyResponse>(
    apiKey,
    `/tailnet/${encodeURIComponent(resolved.id)}/keys`,
    {
      method: 'POST',
      body: JSON.stringify({
        capabilities: {
          devices: {
            create: {
              reusable: false,
              ephemeral: false,
              preauthorized: true,
            },
          },
        },
        expirySeconds: ENROLLMENT_KEY_EXPIRY_SECONDS,
        description: 'open-agent single-use enrolment',
      }),
    },
  );
  if (!response.key) {
    throw new CommandFault({
      code: 'PROVIDER',
      message: 'Tailscale did not return an enrolment key',
    });
  }
  rememberSecret(response.key);

  return response.key;
}

/**
 * deletes only the explicitly identified tailnet device
 * @param apiKey Tailscale management API credential
 * @param deviceId exact device ID to delete
 */
export async function deleteTailnetDevice(
  apiKey: string,
  deviceId: string,
): Promise<void> {
  await requestTailnet<void>(
    apiKey,
    `/device/${encodeURIComponent(deviceId)}`,
    {
      method: 'DELETE',
    },
  );
}

/**
 * finds one device in the live tailnet inventory by its exact identity
 * @param apiKey Tailscale management API credential
 * @param tailnet tailnet identity
 * @param deviceId node or legacy device ID, compared exactly
 * @returns the device's display name, or undefined when the tailnet holds none
 */
export async function findTailnetDevice(
  apiKey: string,
  tailnet: string,
  deviceId: string,
): Promise<{ name: string } | undefined> {
  const { devices } = await resolveTailnet(apiKey, tailnet);
  const device = devices.find(
    (candidate) => candidate.id === deviceId || candidate.nodeId === deviceId,
  );

  return device ? { name: device.name } : undefined;
}

/**
 * resolves exact API identities first, then a bare DNS name after a read-only 404
 * @param apiKey Tailscale management API credential
 * @param tailnet supplied API identity, DNS domain, or bare DNS subdomain
 * @returns verified API identity and current complete device inventory
 */
async function resolveTailnet(
  apiKey: string,
  tailnet: string,
): Promise<ResolvedTailnet> {
  const id = tailnet.trim();
  try {
    const response = await requestTailnet<TailnetDeviceList>(
      apiKey,
      `/tailnet/${encodeURIComponent(id)}/devices?fields=all`,
    );

    return { id, devices: response.devices };
  } catch (error) {
    checkOperation();
    if (
      (error as TailnetApiError).status !== NOT_FOUND_STATUS ||
      !DNS_LABEL.test(id)
    ) {
      throw error;
    }
  }
  const dnsName = `${id.toLowerCase()}.ts.net`;
  const response = await requestTailnet<TailnetDeviceList>(
    apiKey,
    `/tailnet/${encodeURIComponent(dnsName)}/devices?fields=all`,
  );

  return { id: dnsName, devices: response.devices };
}

/**
 * makes one authenticated, bounded Tailscale management request
 * @param apiKey Tailscale management API credential
 * @param path API path relative to the v2 base
 * @param options HTTP method and body
 * @returns decoded native API response
 */
async function requestTailnet<T>(
  apiKey: string,
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const response = await runOperation(async () =>
    fetch(new URL(`${API_BASE}${path}`), {
      ...options,
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      signal: operationSignal(API_TIMEOUT_MS),
    }),
  );
  if (!response.ok) {
    throw new TailnetApiError({
      method: options.method ?? 'GET',
      path,
      status: response.status,
    });
  }

  return response.status === NO_CONTENT_STATUS
    ? (undefined as T)
    : ((await runOperation(async () => response.json())) as T);
}
