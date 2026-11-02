import { SpritesClient } from '@fly/sprites';
import { describe, expect, it, vi } from 'vitest';

import { runCommand } from '#application/workstation';
import { OperationContext } from '#kernel/operation';

import { dependencies } from '../mocks/dependencies';

import type { Interaction } from '#application/ports/interaction';

// a guest command runs through the framed guest shell boundary
vi.mock(
  '#adapters/guest/platform/session/open',
  async () => import('../mocks/session'),
);

const TOKEN = 'workflow-org/1234/0123abcd/4567ef89';
const options = { nonInteractive: true } as const;

function withoutProviderCredentials(): void {
  vi.stubEnv('SPRITES_TOKEN', undefined);
}

const interaction: Interaction = {
  input: async () => '',
  secret: async () => '',
  select: async (_prompt, choices) => choices[0]!.value,
  multiselect: async () => [],
  confirm: async () => true,
  progress: () => undefined,
  status: () => undefined,
};

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

  it('should apply an explicit list credential source to the default provider', async () => {
    withoutProviderCredentials();
    vi.stubEnv('OPEN_AGENT_SPRITE_SOURCE', TOKEN);
    const list = vi
      .spyOn(SpritesClient.prototype, 'listAllSprites')
      .mockResolvedValue([]);

    const result = await runCommand(dependencies, {
      command: 'list',
      options: {
        ...options,
        providerTokenSource: 'env:OPEN_AGENT_SPRITE_SOURCE',
      },
    });

    expect(result).toMatchObject({
      command: 'list',
      ok: true,
      data: {
        machines: [],
        unavailable: [],
      },
    });
    expect(list).toHaveBeenCalledOnce();
  });

  it('should explain unavailable prompts in a caller-owned operation when no provider can list', async () => {
    withoutProviderCredentials();
    const operation = new OperationContext({
      signal: new AbortController().signal,
    });
    operation.setPromptBlocker('this invocation has no terminal');

    const result = await runCommand(
      dependencies,
      { command: 'list', options },
      { operation },
    );

    expect(result).toMatchObject({
      command: 'list',
      ok: false,
      error: {
        code: 'INPUT',
        details: expect.arrayContaining([
          expect.stringContaining('this invocation has no terminal'),
        ]),
      },
    });
    expect(operation.closed).toBe(true);
  });

  it('should report missing prerequisites without prompt guidance for a direct command', async () => {
    withoutProviderCredentials();

    const result = await runCommand(dependencies, {
      command: 'list',
      options: { ...options, provider: 'sprite' },
    });

    expect(result).toMatchObject({
      command: 'list',
      ok: false,
      error: { code: 'INPUT', details: expect.any(Array) },
    });
    if (!result.ok) {
      expect(result.error.details).not.toContainEqual(
        expect.stringContaining('Prompts are disabled'),
      );
    }
  });

  it('should reject an entered credential that fails provider preflight', async () => {
    withoutProviderCredentials();
    const secret = vi.fn(async () => 'FlyV1 fm2_generated-macaroon');
    const result = await runCommand(
      dependencies,
      { command: 'list', options: {} },
      { interaction: { ...interaction, secret } },
    );

    expect(result).toMatchObject({
      command: 'list',
      ok: false,
      error: { code: 'INPUT', details: expect.any(Array) },
    });
    expect(secret).toHaveBeenCalledOnce();
  });

  it('should list with a credential entered through the interaction', async () => {
    withoutProviderCredentials();
    const secret = vi.fn(async () => TOKEN);
    const list = vi
      .spyOn(SpritesClient.prototype, 'listAllSprites')
      .mockResolvedValue([]);

    const result = await runCommand(
      dependencies,
      { command: 'list', options: {} },
      { interaction: { ...interaction, secret } },
    );

    expect(result).toMatchObject({
      command: 'list',
      ok: true,
      data: { machines: [], unavailable: [] },
    });
    expect(secret).toHaveBeenCalledOnce();
    expect(list).toHaveBeenCalledOnce();
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
