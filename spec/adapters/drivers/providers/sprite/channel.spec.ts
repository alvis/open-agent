import { ExecError, Sprite, SpritesClient } from '@fly/sprites';
import { describe, expect, it, vi } from 'vitest';

import { SpriteGuestChannel } from '#adapters/drivers/providers/sprite/channel';

const sdk = new SpritesClient('offline-test');
const failing = Object.assign(new Sprite('failed', sdk), {
  execFile: vi.fn<Sprite['execFile']>(async () => {
    throw new ExecError('command failed', {
      exitCode: 7,
      stdout: Buffer.from('partial output'),
      stderr: Buffer.from('denied'),
    });
  }),
} satisfies Partial<Sprite>);

describe('cl:SpriteGuestChannel', () => {
  it('should return failed command output from SDK execution errors', async () => {
    const channel = new SpriteGuestChannel({
      sprite: failing,
      restorableServices: [],
    });

    await expect(
      channel.exec({ program: '/bin/false', arguments: [] }),
    ).resolves.toEqual({
      exitCode: 7,
      stdout: 'partial output',
      stderr: 'denied',
    });
  });
});
