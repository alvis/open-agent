import { mkdtempDisposable, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { SpritesClient } from '@fly/sprites';
import { describe, expect, it, vi } from 'vitest';

import {
  MANAGED_LABEL,
  SCHEMA_LABEL,
} from '#adapters/drivers/providers/sprite/labels';
import { terminateWorkstation } from '#application/terminate';

import { environmentOf } from '../fixtures/environment';
import { DISABLED_NETWORK_PROFILE } from '../fixtures/profile';
import { dependencies } from '../mocks/dependencies';
import { createFilesystemSprite, providerOf } from '../mocks/sprites';

import type { Sprite } from '@fly/sprites';
import type { Mock } from 'vitest';

import type { CommandRequest } from '#application/contracts';
import type { Interaction } from '#application/ports/interaction';

import type { GuestExecute } from '../mocks/sprites';

const environment = environmentOf(DISABLED_NETWORK_PROFILE);

/**
 * creates a verified provider target with actual isolated guest files
 * @param root disposable directory for guest and local inputs
 * @returns exact-target request, SDK-only provider boundary and the guest's
 * answer to every command other than a file program
 */
async function createTerminationBoundary(root: string): Promise<{
  sprite: Sprite;
  execute: Mock<GuestExecute>;
  client: SpritesClient;
  request: CommandRequest;
}> {
  const execute = vi.fn<GuestExecute>(async () => ({
    stdout: '',
    stderr: 'native status unavailable',
    exitCode: 1,
  }));
  const sprite = Object.assign(createFilesystemSprite({ root, execute }), {
    id: 'sprite-incomplete',
    organizationName: 'test-organization',
    labels: [MANAGED_LABEL, SCHEMA_LABEL],
  });
  const client = Object.assign(new SpritesClient('test-token'), {
    getSprite: vi.fn<SpritesClient['getSprite']>(async () => sprite),
    deleteSprite: vi.fn<SpritesClient['deleteSprite']>(async () => undefined),
  } satisfies Partial<SpritesClient>);
  const envPath = join(root, 'selected.env');
  await writeFile(envPath, ['OPEN_AGENT_NETWORK=none', ''].join('\n'));
  const request = {
    command: 'terminate',
    machine: sprite.name,
    options: {
      credentialFile: envPath,
      yes: true,
      nonInteractive: true,
      localCredentials: false,
    },
  } satisfies CommandRequest;

  return { sprite, execute, client, request };
}

/**
 * a deletion prompt whose typed answer is controlled by the test
 * @param typedName answer supplied to the deletion prompt
 * @returns interaction recording status and progress
 */
function deletionInteraction(typedName: string): Interaction {
  const refuse = async (): Promise<never> => {
    throw new Error('unexpected termination prompt');
  };

  return {
    input: vi.fn(async () => typedName),
    secret: refuse,
    select: refuse,
    multiselect: refuse,
    confirm: refuse,
    progress: vi.fn(),
    status: vi.fn(),
  };
}

describe('fn:terminateWorkstation', () => {
  it('should cancel before guest inspection when the typed name differs', async () => {
    await using directory = await mkdtempDisposable(
      join(tmpdir(), 'open-agent-terminate-typed-mismatch-'),
    );
    const { sprite, client, request } = await createTerminationBoundary(
      directory.path,
    );
    const interaction = deletionInteraction('another-workstation');

    const result = await terminateWorkstation(dependencies, {
      request: { ...request, options: { ...request.options, yes: false } },
      provider: providerOf(client),
      interaction,
    });

    expect(result).toMatchObject({ ok: false, error: { code: 'CANCELLED' } });
    expect(interaction.input).toHaveBeenCalledExactlyOnceWith({
      message: `Type ${sprite.name} to delete it`,
      required: true,
    });
    expect(interaction.status).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'warning' }),
    );
    expect(sprite.filesystem().exists).not.toHaveBeenCalled();
    expect(client.deleteSprite).not.toHaveBeenCalled();
  });

  it('should delete after the typed name matches and report progress', async () => {
    await using directory = await mkdtempDisposable(
      join(tmpdir(), 'open-agent-terminate-typed-match-'),
    );
    const { sprite, client, request } = await createTerminationBoundary(
      directory.path,
    );
    const interaction = deletionInteraction(sprite.name);

    const result = await terminateWorkstation(dependencies, {
      request: { ...request, options: { ...request.options, yes: false } },
      provider: providerOf(client),
      interaction,
    });

    expect(result).toMatchObject({ ok: true });
    expect(interaction.progress).toHaveBeenCalledWith({
      stage: 'terminate',
      message: `Deleting workstation ${sprite.name}`,
    });
    expect(client.deleteSprite).toHaveBeenCalledExactlyOnceWith(sprite.name);
  });

  it.each([undefined, ''])(
    'should require a typed name after selecting a workstation with no requested name (%s)',
    async (machine) => {
      await using directory = await mkdtempDisposable(
        join(tmpdir(), 'open-agent-terminate-selected-'),
      );
      const { sprite, client, request } = await createTerminationBoundary(
        directory.path,
      );
      const listAllSprites = vi.fn<SpritesClient['listAllSprites']>(
        async () => [sprite],
      );
      vi.spyOn(client, 'listAllSprites').mockImplementation(listAllSprites);
      const input = vi.fn(async () => sprite.name);
      const interaction: Interaction = {
        ...deletionInteraction(sprite.name),
        input,
        select: async (_prompt, choices) => {
          const selected = choices[0];
          if (!selected) {
            throw new Error('no workstation was offered');
          }

          return selected.value;
        },
      };

      const result = await terminateWorkstation(dependencies, {
        request: { ...request, machine },
        provider: providerOf(client),
        interaction,
      });

      expect(result).toMatchObject({ ok: true });
      expect(listAllSprites).toHaveBeenCalledOnce();
      expect(input).toHaveBeenCalledExactlyOnceWith({
        message: `Type ${sprite.name} to delete it`,
        required: true,
      });
      expect(client.deleteSprite).toHaveBeenCalledExactlyOnceWith(sprite.name);
    },
  );

  it('should refuse a supplied name that differs from the ownership-verified Sprite before deletion', async () => {
    await using directory = await mkdtempDisposable(
      join(tmpdir(), 'open-agent-terminate-mismatch-'),
    );
    const { sprite, client, request } = await createTerminationBoundary(
      directory.path,
    );

    await expect(
      terminateWorkstation(dependencies, {
        request: { ...request, machine: 'different-target' },
        provider: providerOf(client),
      }),
    ).rejects.toEqual(
      expect.objectContaining({
        code: 'CONFLICT',
        message: expect.stringMatching(
          /does not match the verified workstation/,
        ),
      }),
    );

    expect(client.getSprite).toHaveBeenCalledExactlyOnceWith(
      'different-target',
    );
    expect(sprite.filesystem().exists).not.toHaveBeenCalled();
    expect(client.deleteSprite).not.toHaveBeenCalled();
  });

  it('should delete a verified incomplete workstation without requiring an absent environment', async () => {
    for (const hasManifest of [false, true]) {
      await using directory = await mkdtempDisposable(
        join(tmpdir(), 'open-agent-terminate-incomplete-'),
      );
      const { sprite, execute, client, request } =
        await createTerminationBoundary(directory.path);
      if (hasManifest) {
        await sprite.filesystem().mkdir('/opt/open-agent', { recursive: true });
        await sprite
          .filesystem()
          .writeJSON('/opt/open-agent/environment.json', environment);
      }

      const result = await terminateWorkstation(dependencies, {
        request,
        provider: providerOf(client),
      });

      expect(result).toMatchObject({
        command: 'terminate',
        ok: true,
        data: {
          workstation: { status: 'deleted', id: sprite.id, name: sprite.name },
        },
      });
      expect(client.deleteSprite).toHaveBeenCalledExactlyOnceWith(sprite.name);
      expect(execute).not.toHaveBeenCalled();
    }
  });
});
