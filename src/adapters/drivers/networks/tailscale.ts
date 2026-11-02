import {
  cleanupTailnetDevice,
  removeStaleTailnetDevice,
} from './tailscale/cleanup';
import { enrollTailscale } from './tailscale/enroll';
import { identifyTailnetDevice } from './tailscale/identity';
import {
  issueTailscaleCredential,
  preflightTailscale,
} from './tailscale/preflight';
import { tailscaleReadiness } from './tailscale/readiness';
import { releaseTailscale } from './tailscale/release';
import { tailscaleDaemon, tailscaleLauncher } from './tailscale/service';
import { inspectTailscale } from './tailscale/status';
import { tailscaleTool } from './tailscale/tools';

import type { NetworkDriver } from '#application/ports/drivers';
import type { NetworkStatus } from '#domain/observations/network';

/** Tailscale as a private-network driver */
export const tailscale: NetworkDriver<'tailscale', NetworkStatus> = {
  id: 'tailscale',
  kind: 'networks',
  displayName: 'Tailscale',
  tools: [tailscaleTool],
  inputs: {
    account: {
      environment: 'TAILSCALE_TAILNET',
      prompt:
        'Tailscale tailnet (API ID, .ts.net domain, or bare DNS subdomain)',
      flag: '--network-account ACCOUNT',
    },
    management: {
      environment: 'TAILSCALE_API_KEY',
      prompt: 'Tailscale management API key',
      flag: '--network-key-source env:NAME, file:PATH, or keychain:SERVICE/ACCOUNT',
      store: 'tailscale',
    },
    enrollment: {
      environment: 'TAILSCALE_AUTH_KEY',
      flag: '--network-auth-key-source SOURCE',
    },
  },
  daemon: tailscaleDaemon,
  launcher: tailscaleLauncher,
  preflight: preflightTailscale,

  issueCredential: issueTailscaleCredential,
  enroll: enrollTailscale,
  release: releaseTailscale,
  status: inspectTailscale,

  readiness: tailscaleReadiness,
  identify: identifyTailnetDevice,

  cleanup: cleanupTailnetDevice,
  removeStaleDevice: removeStaleTailnetDevice,
};
