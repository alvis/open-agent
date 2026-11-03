import { describe, expect, it } from 'vitest';

import { selectSetupSection } from '#application/setup/selection';

import { driveInk } from '../../fixtures/ink';
import { pluginFlags } from '../../fixtures/plugin-flags';

describe('fn:selectSetupSection', () => {
  it.each([
    { options: { withPairCode: true }, section: 'agent' },
    {
      options: pluginFlags({ disableClaudePlugin: ['coding@alvis'] }),
      section: 'plugins',
    },
    {
      options: pluginFlags({
        section: 'plugins',
        disableClaudePlugin: ['coding@alvis'],
      }),
      section: 'plugins',
    },
    { options: { setupFile: 'setup.sh' }, section: 'system' },
    { options: { envFile: 'runtime.vars' }, section: 'env' },
  ] as const)(
    'should select $section from explicit actions',
    async ({ options, section }) => {
      await expect(selectSetupSection(options)).resolves.toBe(section);
    },
  );

  it('should reject explicit plugin actions for a different section', async () => {
    const options = pluginFlags({
      section: 'tools',
      disableClaudePlugin: ['coding@alvis'],
    });

    await expect(selectSetupSection(options)).rejects.toMatchObject({
      message: expect.stringContaining('conflict'),
    });
  });

  it('should require a section when prompting is unavailable or explicitly disabled', async () => {
    await expect(selectSetupSection({})).rejects.toMatchObject({
      message: expect.stringContaining('--section'),
    });
    await expect(
      driveInk(
        async (interaction) =>
          selectSetupSection({ nonInteractive: true }, interaction),
        [],
      ),
    ).rejects.toMatchObject({ message: expect.stringContaining('--section') });
  });
});
