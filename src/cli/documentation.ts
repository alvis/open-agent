/** how a command on an existing workstation finds its provider */
const PROVIDER_SELECTION = `Without --provider, each provider with a ready credential is asked for the
workstation. --provider PROVIDER names the provider instead, and it is the
provider a --provider-token-source belongs to; with a token source and no
--provider, sprite answers.`;

/** complete create guidance without turning optional integrations into defaults */
export const createDocumentation = {
  brief: 'create one new coding workstation',
  customUsage: ['[--name NAME] [options]'],
  fullDescription: `Creates a private workstation, verifies readiness, then exposes its agent URL.
Interactive runs ask for the provider, ACP agent, harnesses, then network; a
step with one choice is skipped. Flags and
OPEN_AGENT_* environment variables answer the same questions.

EXAMPLES
  open-agent create --name devbox
  open-agent create --name devbox --network none
  open-agent create --name devbox --non-interactive`,
} as const;

/** list guidance keeps the provider-only read and output modes clear */
export const listDocumentation = {
  brief: 'list owned workstations on every provider with credentials',
  customUsage: ['[options]'],
  fullDescription: `Lists current managed workstations from every provider whose credential
is available, without waking their guests. A provider whose query fails is
reported as unavailable. A workstation a newer open-agent set up is listed and
marked, but no other command acts on it until open-agent is upgraded. --provider PROVIDER names the provider a
--provider-token-source belongs to (sprite when omitted); every other provider
is still listed.

EXAMPLES
  open-agent list
  open-agent list --provider-token-source env:MY_TOKEN`,
} as const;

/** documents workstation details and explicit inspection */
export const showDocumentation = {
  brief: 'show a workstation from current control-plane state',
  customUsage: ['[<workstation>] [--inspect] [options]'],
  fullDescription: `Shows current provider details and the ordinary agent URL without
waking the guest. --inspect checks live guest services and may wake it.
${PROVIDER_SELECTION} Credentials precede output controls below.

EXAMPLES
  open-agent show devbox
  open-agent show devbox --inspect`,
} as const;
