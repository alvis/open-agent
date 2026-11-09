import { machine } from 'node:os';

import { describe, expect, it } from 'vitest';

import { runWithBrew } from '../../mocks/brew';

import type { BrewScenario } from '../../mocks/brew';

const ENVIRONMENT = {
  tools: [
    { name: 'jq', required: true, source: { kind: 'brew', formula: 'jq' } },
    { name: 'gh', required: true, source: { kind: 'brew', formula: 'gh' } },
    {
      name: 'node',
      required: false,
      source: { kind: 'brew', formula: 'node' },
    },
  ],
};

const INSTALLED = { jq: '1.7.1', gh: '2.60.0', node: '22.1.0' } as const;
const NEWER = { gh: '2.61.0', node: '22.2.0' } as const;
const PREVIOUS_SUCCESS = '2026-01-01T00:00:00Z';

const buildUpdateScript = (
  only: string,
): string => `OA_VERSIONS_JQ=$(command -v jq)
exec 8>&1
oa_update_system() { echo "system update for \${2:-every tool}" >&8; }
oa_update_system_clean() { :; }
oa_update_system_clean_roots() { :; }
oa_npm_clean() { :; }
oa_npm_clean_roots() { :; }
oa_rustup_clean() { :; }
oa_rustup_clean_roots() { :; }
oa_links_restore() { :; }
(oa_update_run "$OA_TEST_WORK/environment.json" "$OA_TEST_WORK/update-status.json" \\
  "$(command -v jq)" true 1 '${only}') >/dev/null 2>&1`;

/** one tool's outcome in update-status.json */
interface ToolOutcome {
  name: string;
  manager: string;
  required: boolean;
  outcome: string;
  from: string | null;
  to: string | null;
  reason?: string;
}

/** what one update is given beside the stand-in Homebrew's scenario */
interface UpdateOptions {
  /** the selection, a comma-separated list of tool names, empty for every tool */
  only?: string;
  /** each tool's install time environment.json records before the update */
  installedAt?: Record<string, string>;
  /** tools environment.json records after the brew ones */
  extraTools?: readonly object[];
}

/**
 * runs one update and reads back everything it recorded
 * @param scenario what the stand-in Homebrew has and does, beyond the installed versions
 * @param options the selection and the install times recorded beforehand
 * @returns the update's summary, each tool's recorded install time and the recorded selection
 */
async function runUpdate(
  scenario: Omit<BrewScenario, 'installed'>,
  options: UpdateOptions = {},
) {
  const { only = '', installedAt = {}, extraTools = [] } = options;
  const environment = {
    tools: [
      ...ENVIRONMENT.tools.map((tool) =>
        installedAt[tool.name]
          ? { ...tool, installedAt: installedAt[tool.name] }
          : tool,
      ),
      ...extraTools,
    ],
  };
  const run = await runWithBrew({
    scenario: { installed: INSTALLED, newer: NEWER, ...scenario },
    libraries: ['tools/versions.sh', 'maintenance/updater.sh'],
    script: buildUpdateScript(only),
    files: {
      'environment.json': JSON.stringify(environment),
      'update-status.json': JSON.stringify({ lastSuccess: PREVIOUS_SUCCESS }),
    },
  });
  const status = JSON.parse(run.status) as {
    lastSuccess: string | null;
    selection: string[] | null;
    tools: ToolOutcome[];
  };
  const recorded = JSON.parse(run.environment) as {
    tools: Array<{ name: string; version?: string; installedAt?: string }>;
  };

  return {
    summary: {
      upgrades: run.calls.filter((call) => call.startsWith('upgrade')),
      succeeded: status.lastSuccess !== PREVIOUS_SUCCESS,
      lastSuccess: status.lastSuccess,
      tools: status.tools,
      versions: Object.fromEntries(
        recorded.tools.map(({ name, version }) => [name, version]),
      ),
    },
    installs: Object.fromEntries(
      recorded.tools.flatMap(({ name, installedAt: at }) =>
        at ? [[name, at]] : [],
      ),
    ),
    selection: status.selection,
    systemUpdates: run.stdout.split('\n').filter((line) => line !== ''),
  };
}

/**
 * runs one update and summarizes its upgrades, verdict and recorded versions
 * @param scenario what the stand-in Homebrew has and does, beyond the installed versions
 * @param options the selection and the install times recorded beforehand
 * @returns the brew upgrades run, whether the last success moved, the outcomes and versions
 */
async function update(
  scenario: Omit<BrewScenario, 'installed'>,
  options: UpdateOptions = {},
) {
  return (await runUpdate(scenario, options)).summary;
}

const outcome = (
  name: keyof typeof INSTALLED,
  recorded: Pick<ToolOutcome, 'outcome' | 'to' | 'reason'>,
): ToolOutcome => ({
  name,
  manager: 'brew',
  required: name !== 'node',
  from: INSTALLED[name],
  ...recorded,
});

describe('fn:oa_update_run', () => {
  it('should run no upgrade when every formula is current', async () => {
    const result = await update({});

    expect(result).toEqual({
      upgrades: [],
      succeeded: true,
      lastSuccess: expect.any(String),
      tools: [
        outcome('jq', {
          outcome: 'skipped',
          to: '1.7.1',
          reason: 'it is current',
        }),
        outcome('gh', {
          outcome: 'skipped',
          to: '2.60.0',
          reason: 'it is current',
        }),
        outcome('node', {
          outcome: 'skipped',
          to: '22.1.0',
          reason: 'it is current',
        }),
      ],
      versions: INSTALLED,
    });
  });

  it('should upgrade the outdated formulae in one run and record each in order', async () => {
    const result = await update({ outdated: ['node', 'gh'] });

    expect(result).toEqual({
      upgrades: ['upgrade --formula gh node'],
      succeeded: true,
      lastSuccess: expect.any(String),
      tools: [
        outcome('jq', {
          outcome: 'skipped',
          to: '1.7.1',
          reason: 'it is current',
        }),
        outcome('gh', { outcome: 'installed', to: '2.61.0' }),
        outcome('node', { outcome: 'installed', to: '22.2.0' }),
      ],
      versions: { ...INSTALLED, ...NEWER },
    });
  });

  it('should fail the formula moved by a failed batch and retry only the unchanged formula', async () => {
    const result = await update({ outdated: ['gh', 'node'], broken: ['node'] });

    expect(result).toEqual({
      upgrades: ['upgrade --formula gh node', 'upgrade --formula node'],
      succeeded: false,
      lastSuccess: PREVIOUS_SUCCESS,
      tools: [
        outcome('jq', {
          outcome: 'skipped',
          to: '1.7.1',
          reason: 'it is current',
        }),
        outcome('gh', {
          outcome: 'failed',
          to: '2.61.0',
          reason:
            'Homebrew failed after its version changed; post-install success is unconfirmed',
        }),
        outcome('node', {
          outcome: 'failed',
          to: '22.1.0',
          reason: 'its brew upgrade failed',
        }),
      ],
      versions: { ...INSTALLED, gh: '2.61.0' },
    });
  });

  it('should fail a required formula whose upgrade fails alone too and withhold the last success', async () => {
    const result = await update({ outdated: ['gh', 'node'], broken: ['gh'] });

    expect(result).toEqual({
      upgrades: ['upgrade --formula gh node', 'upgrade --formula gh'],
      succeeded: false,
      lastSuccess: PREVIOUS_SUCCESS,
      tools: [
        outcome('jq', {
          outcome: 'skipped',
          to: '1.7.1',
          reason: 'it is current',
        }),
        outcome('gh', {
          outcome: 'failed',
          to: '2.60.0',
          reason: 'its brew upgrade failed',
        }),
        outcome('node', {
          outcome: 'failed',
          to: '22.2.0',
          reason:
            'Homebrew failed after its version changed; post-install success is unconfirmed',
        }),
      ],
      versions: { ...INSTALLED, node: '22.2.0' },
    });
  });

  it('should keep a formula whose new version has no bottle out of the run', async () => {
    const result = await update({
      outdated: ['gh', 'node'],
      unbottled: ['node'],
    });

    expect(result).toEqual({
      upgrades: ['upgrade --formula gh'],
      succeeded: true,
      lastSuccess: expect.any(String),
      tools: [
        outcome('jq', {
          outcome: 'skipped',
          to: '1.7.1',
          reason: 'it is current',
        }),
        outcome('gh', { outcome: 'installed', to: '2.61.0' }),
        outcome('node', {
          outcome: 'skipped',
          to: '22.1.0',
          reason: `its new version has no bottle for ${machine()}`,
        }),
      ],
      versions: { ...INSTALLED, gh: '2.61.0' },
    });
  });

  it('should not treat a keg moved before a post-install failure as installed', async () => {
    const result = await update({ outdated: ['gh'], postinstallFails: ['gh'] });

    expect(result).toEqual({
      upgrades: ['upgrade --formula gh'],
      succeeded: false,
      lastSuccess: PREVIOUS_SUCCESS,
      tools: [
        outcome('jq', {
          outcome: 'skipped',
          to: '1.7.1',
          reason: 'it is current',
        }),
        outcome('gh', {
          outcome: 'failed',
          to: '2.61.0',
          reason:
            'Homebrew failed after its version changed; post-install success is unconfirmed',
        }),
        outcome('node', {
          outcome: 'skipped',
          to: '22.1.0',
          reason: 'it is current',
        }),
      ],
      versions: { ...INSTALLED, gh: '2.61.0' },
    });
  });

  it('should fail every formula a failed run moved, since none can prove its post-install ran', async () => {
    const result = await update({
      outdated: ['gh', 'node'],
      postinstallFails: ['gh'],
    });

    expect(result).toEqual({
      upgrades: ['upgrade --formula gh node'],
      succeeded: false,
      lastSuccess: PREVIOUS_SUCCESS,
      tools: [
        outcome('jq', {
          outcome: 'skipped',
          to: '1.7.1',
          reason: 'it is current',
        }),
        outcome('gh', {
          outcome: 'failed',
          to: '2.61.0',
          reason:
            'Homebrew failed after its version changed; post-install success is unconfirmed',
        }),
        outcome('node', {
          outcome: 'failed',
          to: '22.2.0',
          reason:
            'Homebrew failed after its version changed; post-install success is unconfirmed',
        }),
      ],
      versions: { ...INSTALLED, ...NEWER },
    });
  });

  it('should withhold the last success for a required formula a failed run moved even when the retry of the rest succeeds', async () => {
    const result = await update({
      outdated: ['gh', 'node'],
      postinstallFails: ['gh'],
      crowded: ['node'],
    });

    expect(result).toEqual({
      upgrades: ['upgrade --formula gh node', 'upgrade --formula node'],
      succeeded: false,
      lastSuccess: PREVIOUS_SUCCESS,
      tools: [
        outcome('jq', {
          outcome: 'skipped',
          to: '1.7.1',
          reason: 'it is current',
        }),
        outcome('gh', {
          outcome: 'failed',
          to: '2.61.0',
          reason:
            'Homebrew failed after its version changed; post-install success is unconfirmed',
        }),
        outcome('node', { outcome: 'installed', to: '22.2.0' }),
      ],
      versions: { ...INSTALLED, ...NEWER },
    });
  });

  it('should retain a failed upgrade when its resulting version cannot be verified', async () => {
    const result = await update({
      outdated: ['gh'],
      postinstallFails: ['gh'],
      unreadableAfterUpgrade: ['gh'],
    });

    expect(result).toMatchObject({
      upgrades: ['upgrade --formula gh'],
      succeeded: false,
      lastSuccess: PREVIOUS_SUCCESS,
      tools: expect.arrayContaining([
        outcome('gh', {
          outcome: 'failed',
          to: null,
          reason:
            'Homebrew failed and its version could not be verified; post-install success is unconfirmed',
        }),
      ]),
      versions: { ...INSTALLED, gh: '2.61.0' },
    });
  });

  it('should fail every formula without upgrading when brew cannot refresh', async () => {
    const result = await update({ outdated: ['gh'], shouldFailRefresh: true });

    expect(result).toEqual({
      upgrades: [],
      succeeded: false,
      lastSuccess: PREVIOUS_SUCCESS,
      tools: [
        outcome('jq', {
          outcome: 'failed',
          to: '1.7.1',
          reason: 'Homebrew could not refresh its formulae',
        }),
        outcome('gh', {
          outcome: 'failed',
          to: '2.60.0',
          reason: 'Homebrew could not refresh its formulae',
        }),
        outcome('node', {
          outcome: 'failed',
          to: '22.1.0',
          reason: 'Homebrew could not refresh its formulae',
        }),
      ],
      versions: INSTALLED,
    });
  });
  it('should record when each installed tool was installed and keep the others', async () => {
    const { installs, selection } = await runUpdate(
      { outdated: ['gh'] },
      { installedAt: { node: '2026-01-02T00:00:00Z' } },
    );

    expect(installs).toEqual({
      gh: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/),
      node: '2026-01-02T00:00:00Z',
    });
    expect(selection).toBeNull();
  });

  it('should upgrade only the selected tools, record the selection and keep the last success', async () => {
    const { summary, installs, selection } = await runUpdate(
      { outdated: ['gh', 'node'] },
      { only: 'gh,jq' },
    );

    expect(summary).toEqual({
      upgrades: ['upgrade --formula gh'],
      succeeded: false,
      lastSuccess: PREVIOUS_SUCCESS,
      tools: [
        outcome('jq', {
          outcome: 'skipped',
          to: '1.7.1',
          reason: 'it is current',
        }),
        outcome('gh', { outcome: 'installed', to: '2.61.0' }),
      ],
      versions: { ...INSTALLED, gh: '2.61.0' },
    });
    expect(selection).toEqual(['gh', 'jq']);
    expect(Object.keys(installs)).toEqual(['gh']);
  });

  it('should hand the selection to the system update', async () => {
    const { systemUpdates } = await runUpdate(
      {},
      {
        only: 'gh,curl',
        extraTools: [
          {
            name: 'curl',
            required: false,
            source: { kind: 'system', packages: ['curl'] },
          },
        ],
      },
    );

    expect(systemUpdates).toEqual(['system update for gh,curl']);
  });
});
