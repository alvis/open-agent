import { buildChoiceParser } from '@stricli/core';

import { harnessIds } from '#domain/harnesses';
import { AGENT_IDS, PROVIDER_IDS } from '#domain/ids';
import { networkIds } from '#domain/networks';

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
} as const;

/** output and automation controls shared by every operation */
export const outputFlags = {
  json: { kind: 'boolean', default: false, brief: 'print one JSON result' },
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

/** driver selection, in the order interactive setup asks for it */
export const selectionFlags = {
  ...providerFlags,
  agent: {
    kind: 'parsed',
    parse: buildChoiceParser(AGENT_IDS),
    optional: true,
    placeholder: 'AGENT',
    brief: `AGENT · ACP agent: ${AGENT_IDS.join(', ')}`,
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
} as const;

/** setup-only action selectors */
export const setupFlags = {
  section: {
    kind: 'parsed',
    parse: buildChoiceParser(['all', 'agent', 'network'] as const),
    optional: true,
    placeholder: 'SECTION',
    brief: 'SECTION · all, agent, or network',
  },
} as const;
