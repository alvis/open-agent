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
