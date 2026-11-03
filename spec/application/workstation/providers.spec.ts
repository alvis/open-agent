import { tmpdir } from 'node:os';

import { describe, expect, it } from 'vitest';

import { locateProvider } from '#application/workstation/providers';

import { dependencies } from '../../mocks/dependencies';
import { createFilesystemSprite, workstationOf } from '../../mocks/sprites';

import type { ProviderDriver } from '#application/ports/drivers';
import type { ProviderId } from '#domain/ids';

const workstation = workstationOf(
  createFilesystemSprite({ root: tmpdir() }),
).workstation;
const options = { localCredentials: false };
const failure = new Error('Provider inventory unavailable');

/**
 * supplies provider inventory I/O while keeping the registered preflight real
 * @param inventories records or failures returned by each provider
 * @returns dependencies with isolated management boundaries
 */
function inventoriesOf(
  inventories: Record<ProviderId, Array<typeof workstation> | Error>,
) {
  const inventory = (id: ProviderId) =>
    ({
      list: async () => {
        const result = inventories[id];
        if (result instanceof Error) {
          throw result;
        }

        return result;
      },
      get: async () => {
        const result = inventories[id];
        if (result instanceof Error) {
          throw result;
        }
        const [record] = result;
        if (!record) {
          throw Object.assign(new Error('No workstation'), {
            code: 'not-found',
          });
        }

        return record;
      },
    }) satisfies Partial<ProviderDriver>;

  return {
    registry: {
      ...dependencies.registry,
      providers: {
        sprite: {
          ...dependencies.registry.providers.sprite,
          preflight: dependencies.registry.providers.sprite.preflight.bind(
            dependencies.registry.providers.sprite,
          ),
          authenticate: () => ({
            ...dependencies.registry.providers.sprite,
            ...inventory('sprite'),
          }),
        },
      },
    },
    host: {
      ...dependencies.host,
      environment: {
        ...dependencies.host.environment,
        variables: () => ({
          SPRITES_TOKEN: 'organization/1234/0123abcd/4567ef89',
        }),
      },
    },
  } satisfies Pick<typeof dependencies, 'registry' | 'host'>;
}

describe('fn:locateProvider', () => {
  it.each([
    { machine: 'workstation', sprite: [workstation] },
    { machine: 'workstation', sprite: [] },
    { sprite: failure },
  ])(
    'should answer with the only ready provider whatever its inventory ($machine)',
    async ({ machine, sprite }) => {
      const wired = inventoriesOf({ sprite });

      await expect(
        locateProvider(wired, { command: 'show', machine, options }),
      ).resolves.toBe('sprite');
    },
  );
});
