import { SpritesClient } from '@fly/sprites';
import { describe, expect, it, vi } from 'vitest';

import { runCommand } from '#application/workstation';
import { OperationContext } from '#kernel/operation';

import { dependencies } from '../mocks/dependencies';

// a guest command runs through the framed guest shell boundary
vi.mock(
  '#adapters/guest/platform/session/open',
  async () => import('../mocks/session'),
);

const options = { nonInteractive: true } as const;

function withoutProviderCredentials(): void {
  vi.stubEnv('SPRITES_TOKEN', undefined);
}

describe('fn:runCommand', () => {
  it('should dispatch create and report missing provider credentials before creating a machine', async () => {
    withoutProviderCredentials();
    const create = vi.spyOn(SpritesClient.prototype, 'createSprite');
    const stages: string[] = [];
    const operation = new OperationContext({
      signal: new AbortController().signal,
      onStage: ({ stage, event }) => stages.push(`${stage}:${event}`),
    });

    const result = await runCommand(
      dependencies,
      {
        command: 'create',
        options: {
          ...options,
          provider: 'sprite',
          name: 'workstation',
          yes: true,
          network: 'none',
        },
      },
      { operation },
    );

    expect(result).toMatchObject({
      command: 'create',
      ok: false,
      error: { code: 'INPUT' },
    });
    expect(stages).toContain('create.preflight:start');
    expect(create).not.toHaveBeenCalled();
  });

  it('should retain known identity and recovery guidance when its caller cancels', async () => {
    const controller = new AbortController();
    const operation = new OperationContext({ signal: controller.signal });
    operation.identify({ id: 'sprite-workstation', name: 'workstation' });
    controller.abort();

    const result = await runCommand(
      dependencies,
      { command: 'create', options },
      { operation },
    );

    expect(result).toMatchObject({
      command: 'create',
      ok: false,
      error: {
        code: 'CANCELLED',
        machine: 'workstation',
        machineId: 'sprite-workstation',
        details: expect.arrayContaining([
          expect.stringContaining('Remote work may be unfinished'),
        ]),
      },
    });
    expect(operation.closed).toBe(true);
  });
});
