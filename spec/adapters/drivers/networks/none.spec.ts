import { mkdtempDisposable } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { none } from '#adapters/drivers/networks/none';
import { registry } from '#composition/registry';

import { createFilesystemSprite, guestOf } from '../../../mocks/sprites';

import type { Sprite } from '@fly/sprites';

/**
 * builds a guest that records every command it is asked to run
 * @param root directory backing the guest filesystem
 * @returns the guest and the recorded commands
 */
function recordingGuest(root: string) {
  const execute = vi.fn<Sprite['execFile']>(async () => ({
    stdout: '',
    stderr: '',
    exitCode: 0,
  }));
  const sprite = createFilesystemSprite({ root, execute });

  return { guest: guestOf(sprite), execute, sprite };
}

describe('None network driver', () => {
  it('should be the driver the catalog registers for the none network', () => {
    expect(registry.networks.none).toBe(none);
  });

  it('should declare no tools', () => {
    expect(none).toMatchObject({
      id: 'none',
      kind: 'networks',
      tools: [],
    });
  });

  it('should pass preflight without checking any caller input', async () => {
    await expect(none.preflight({ hostname: 'workstation' })).resolves.toEqual({
      problems: [],
    });
  });

  it('should enroll without touching the guest', async () => {
    await using directory = await mkdtempDisposable(
      join(tmpdir(), 'open-agent-none-driver-'),
    );
    const { guest, execute, sprite } = recordingGuest(directory.path);

    await none.enroll(guest, { hostname: 'workstation' });

    expect(execute).not.toHaveBeenCalled();
    expect(sprite.spawn).not.toHaveBeenCalled();
  });

  it('should report a neutral not-configured status without asking the guest', async () => {
    await using directory = await mkdtempDisposable(
      join(tmpdir(), 'open-agent-none-status-'),
    );
    const { guest, execute } = recordingGuest(directory.path);

    const status = await none.status(guest);

    expect(status).toEqual({
      online: false,
      skipped: true,
      reason: 'No private network is selected',
    });
    expect(await none.status(guest)).not.toBe(status);
    expect(execute).not.toHaveBeenCalled();
  });

  it('should report readiness as skipped, never as a failure', () => {
    expect(none.readiness({ online: false, skipped: true })).toEqual([
      { name: 'private network', status: 'skipped' },
    ]);
  });
});
