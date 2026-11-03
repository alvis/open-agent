import { describe, expect, it } from 'vitest';

import { selectSetupSection } from '#application/setup/selection';

import { driveInk } from '../../fixtures/ink';

describe('fn:selectSetupSection', () => {
  it.each([
    { options: { withPairCode: true }, section: 'agent' },
    { options: { envFile: 'runtime.vars' }, section: 'env' },
  ] as const)(
    'should select $section from explicit actions',
    async ({ options, section }) => {
      await expect(selectSetupSection(options)).resolves.toBe(section);
    },
  );

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
