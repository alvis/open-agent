import { buildChoiceParser } from '@stricli/core';

import { registry } from '#composition/registry';
import { harnessIds } from '#domain/harnesses';
import { AGENT_IDS, PROVIDER_IDS, releaseChannelIds } from '#domain/ids';
import { networkIds } from '#domain/networks';

import { machineFlags } from './machine-flags';
import { parseWholeNumber } from './whole-number';

/** local provider credential selection shared by every operation */
export const providerCredentialFlags = {
  credentialFile: {
    kind: 'parsed',
    parse: String,
    optional: true,
    placeholder: 'FILE',
    brief:
      'FILE · dotenv file of authentication credentials, read on this computer only',
  },
  providerTokenSource: {
    kind: 'parsed',
    parse: String,
    optional: true,
    placeholder: 'SOURCE',
    brief:
      'SOURCE · provider management credential source reference, for the provider --provider selects (sprite when omitted)',
  },
  localCredentials: {
    kind: 'boolean',
    optional: true,
    withNegated: true,
    brief: 'enable or disable saved credentials',
  },
} as const;

/** output and automation controls shared by every operation */
export const outputFlags = {
  json: { kind: 'boolean', default: false, brief: 'print one JSON result' },
  color: {
    kind: 'boolean',
    optional: true,
    withNegated: true,
    brief: 'enable or disable color',
  },
  verbose: { kind: 'boolean', default: false, brief: 'show detailed status' },
  quiet: {
    kind: 'boolean',
    default: false,
    brief: 'hide routine status and progress',
  },
  nonInteractive: { kind: 'boolean', default: false, brief: 'disable prompts' },
} as const;

/** complete controls for read-only and shared workstation operations */
export const commonFlags = {
  ...providerCredentialFlags,
  ...outputFlags,
} as const;

/** consent for selected create, setup, and terminate actions */
export const consentFlags = {
  yes: {
    kind: 'boolean',
    default: false,
    brief: 'confirm already selected actions',
  },
} as const;

/** explicit pairing action, separate from ordinary integration choices */
export const pairingFlags = {
  withPairCode: {
    kind: 'boolean',
    optional: true,
    withNegated: false,
    brief:
      'create and display a pairing code in the agent URL (5 minutes); alias --with-<agent>-pair-code',
  },
} as const;

/** provider choice, which commands on an existing workstation also accept to skip the search across providers */
export const providerFlags = {
  provider: {
    kind: 'parsed',
    parse: buildChoiceParser(PROVIDER_IDS),
    optional: true,
    placeholder: 'PROVIDER',
    brief: `PROVIDER · ${PROVIDER_IDS.join(', ')}`,
  },
} as const;

/** driver and option selection, in the order interactive setup asks for it */
export const selectionFlags = {
  ...providerFlags,
  ...machineFlags,
  agent: {
    kind: 'parsed',
    parse: buildChoiceParser(AGENT_IDS),
    optional: true,
    placeholder: 'AGENT',
    brief: `AGENT · ACP agent: ${AGENT_IDS.join(', ')}`,
  },
  release: {
    kind: 'parsed',
    parse: buildChoiceParser(releaseChannelIds(registry)),
    optional: true,
    placeholder: 'CHANNEL',
    brief: `CHANNEL · ACP agent release channel: ${releaseChannelIds(registry).join(', ')}; the agent's default when omitted`,
  },
  harness: {
    kind: 'parsed',
    parse: buildChoiceParser(harnessIds()),
    optional: true,
    variadic: true,
    placeholder: 'HARNESS',
    brief: `HARNESS · ${harnessIds().join(', ')} (repeatable)`,
  },
  network: {
    kind: 'parsed',
    parse: buildChoiceParser(networkIds()),
    optional: true,
    placeholder: 'NETWORK',
    brief: `NETWORK · ${networkIds().join(', ')}`,
  },
  idleMinutes: {
    kind: 'parsed',
    parse: parseWholeNumber,
    optional: true,
    placeholder: 'MINUTES',
    brief: 'MINUTES · suspend after idle; 0 never suspends (default 5)',
  },
  holdMaxMinutes: {
    kind: 'parsed',
    parse: parseWholeNumber,
    optional: true,
    placeholder: 'MINUTES',
    brief: 'MINUTES · turn-hold lifetime after its last refresh (default 60)',
  },
  updateDueDays: {
    kind: 'parsed',
    parse: parseWholeNumber,
    optional: true,
    placeholder: 'DAYS',
    brief:
      'DAYS · after the last successful update before another is due, at least 1 (default 1)',
  },
} as const;

/** non-secret provision and setup integration choices */
export const integrationFlags = {
  github: {
    kind: 'boolean',
    optional: true,
    withNegated: true,
    brief: 'enable or disable GitHub access',
  },
  gitIdentity: {
    kind: 'boolean',
    optional: true,
    withNegated: true,
    brief: 'enable or disable Git/JJ identity',
  },
  gitName: {
    kind: 'parsed',
    parse: String,
    optional: true,
    placeholder: 'NAME',
    brief: 'NAME · Git author name',
  },
  gitEmail: {
    kind: 'parsed',
    parse: String,
    optional: true,
    placeholder: 'EMAIL',
    brief: 'EMAIL · Git author email',
  },
  gitCommitterName: {
    kind: 'parsed',
    parse: String,
    optional: true,
    placeholder: 'NAME',
    brief: 'NAME · Git committer name',
  },
  gitCommitterEmail: {
    kind: 'parsed',
    parse: String,
    optional: true,
    placeholder: 'EMAIL',
    brief: 'EMAIL · Git committer email',
  },
  githubHost: {
    kind: 'parsed',
    parse: String,
    optional: true,
    placeholder: 'HOST',
    brief: 'HOST · GitHub host',
  },
} as const;

/** credential source references for selected integrations */
export const integrationCredentialFlags = {
  githubTokenSource: {
    kind: 'parsed',
    parse: String,
    optional: true,
    placeholder: 'SOURCE',
    brief: 'SOURCE · GitHub token source reference',
  },
} as const;

/** optional native plugin and marketplace selections; per-harness flags come from flags/harness */
export const pluginFlags = {
  plugins: {
    kind: 'boolean',
    optional: true,
    withNegated: true,
    brief: 'enable or disable plugins',
  },
} as const;

/** setup-only action selectors */
export const setupFlags = {
  section: {
    kind: 'parsed',
    parse: buildChoiceParser([
      'all',
      'agent',
      'network',
      'github',
      'git',
      'env',
      'system',
      'plugins',
      'tools',
    ] as const),
    optional: true,
    placeholder: 'SECTION',
    brief:
      'SECTION · all, agent, network, github, git, env, system, plugins, or tools',
  },
  pluginHarness: {
    kind: 'parsed',
    parse: buildChoiceParser(harnessIds()),
    optional: true,
    placeholder: 'HARNESS',
    brief: `HARNESS · plugin harness: ${harnessIds().join(', ')}`,
  },
  update: { kind: 'boolean', default: false, brief: 'update managed tools' },
} as const;
