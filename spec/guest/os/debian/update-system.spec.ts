import { describe, expect, it } from 'vitest';

import { runWithBrew } from '../../../mocks/brew';

const ENVIRONMENT = {
  tools: [
    {
      name: 'curl',
      source: { kind: 'system', packages: ['curl', 'libcurl4'] },
    },
    { name: 'tailscale', source: { kind: 'system', packages: ['tailscale'] } },
    { name: 'git', source: { kind: 'system', packages: ['curl', 'git'] } },
    { name: 'gh', source: { kind: 'brew', formula: 'gh' } },
  ],
};

/**
 * runs the system update with apt standing in, and lists what it upgraded
 * @param only the selection, a comma-separated list of tool names, empty for every tool
 * @returns the update's exit status and the packages apt was asked to upgrade
 */
async function updateSystem(only: string) {
  const run = await runWithBrew({
    scenario: { installed: {} },
    libraries: ['os/debian/update-system.sh'],
    script: `oa_policy_rc_install() { :; }
oa_lists_update() { :; }
oa_pkg_upgrade() { echo "upgrade $*"; }
oa_update_system "$OA_TEST_WORK/environment.json" '${only}'`,
    files: { 'environment.json': JSON.stringify(ENVIRONMENT) },
  });

  return {
    exitCode: run.exitCode,
    upgrades: run.stdout.split('\n').filter((line) => line !== ''),
  };
}

describe('fn:oa_update_system', () => {
  it('should upgrade the packages of every system tool once when nothing is selected', async () => {
    const result = await updateSystem('');

    expect(result).toEqual({
      exitCode: 0,
      upgrades: ['upgrade curl git libcurl4 tailscale'],
    });
  });

  it('should upgrade only the packages of the selected system tools', async () => {
    const result = await updateSystem('tailscale,gh');

    expect(result).toEqual({ exitCode: 0, upgrades: ['upgrade tailscale'] });
  });

  it('should upgrade nothing when no selected tool is a system tool', async () => {
    const result = await updateSystem('gh');

    expect(result).toEqual({ exitCode: 0, upgrades: [] });
  });
});
