import { CommandFault } from '#kernel/faults';
import { runOperation } from '#kernel/operation';

import { assertTailnetHostnameAvailable, createTailscaleAuthKey } from './api';

import type {
  NetworkManagement,
  NetworkPreflightParams,
  NetworkPreflightResult,
} from '#application/ports/drivers';

/**
 * checks the exact device name before provisioning
 * @param params device name and management credential
 * @returns every failed check in the order made
 */
export async function preflightTailscale(
  params: NetworkPreflightParams,
): Promise<NetworkPreflightResult> {
  const { hostname, management } = params;
  const credential = management?.account ? management.credential : undefined;
  const account = management?.account;
  const [availability] = await runOperation(async () =>
    Promise.allSettled([
      credential && account
        ? assertTailnetHostnameAvailable(credential, account, hostname)
        : Promise.resolve(),
    ]),
  );

  return {
    problems: [availability].flatMap((check) =>
      check.status === 'rejected' ? [check.reason as unknown] : [],
    ),
  };
}

/**
 * mints a short-lived single-use enrolment key from the management credential
 * @param management Tailscale management API key and tailnet
 * @returns transient key for one new device
 */
export async function issueTailscaleCredential(
  management: NetworkManagement,
): Promise<string> {
  if (!management.account) {
    throw new CommandFault({
      code: 'INPUT',
      message:
        'Tailscale enrolment requires the tailnet of the management API key',
    });
  }

  return createTailscaleAuthKey(management.credential, management.account);
}
