import { describe, expect, it, vi } from 'vitest';

import { providersHolding } from '#application/catalog/providers';
import { ProviderFault } from '#kernel/provider-fault';

import type { BoundProvider } from '#application/catalog/providers';
import type { ProviderDriver } from '#application/ports/drivers';

/**
 * binds a stand-in provider that answers get and list as given
 * @param id provider identifier
 * @param driver the parts of the driver the lookup calls
 * @returns the bound provider
 */
function bound(
  id: BoundProvider['id'],
  driver: Pick<ProviderDriver, 'get' | 'list'>,
): BoundProvider {
  return { id, driver: driver as ProviderDriver };
}

const notFound = new ProviderFault({ code: 'not-found', message: 'absent' });
const broken = new ProviderFault({ code: 'transient', message: 'down' });
const record = {} as Awaited<ReturnType<ProviderDriver['get']>>;

describe('fn:providersHolding', () => {
  it('should name the provider that holds a named workstation', async () => {
    const result = await providersHolding(
      [
        bound('sprite', {
          get: vi.fn(async () => record),
          list: vi.fn(async () => []),
        }),
      ],
      'mine',
    );

    expect(result).toEqual({ holders: ['sprite'], failures: [] });
  });

  it('should ignore a provider that does not find the named workstation', async () => {
    const result = await providersHolding(
      [
        bound('sprite', {
          get: vi.fn(async () => Promise.reject(notFound)),
          list: vi.fn(async () => []),
        }),
      ],
      'mine',
    );

    expect(result).toEqual({ holders: [], failures: [] });
  });

  it('should report a provider that could not be asked instead of counting it as empty', async () => {
    const result = await providersHolding(
      [
        bound('sprite', {
          get: vi.fn(async () => Promise.reject(broken)),
          list: vi.fn(async () => []),
        }),
      ],
      'mine',
    );

    expect(result).toEqual({ holders: [], failures: [broken] });
  });

  it('should name every provider that holds any workstation when no name is given', async () => {
    const result = await providersHolding([
      bound('sprite', {
        get: vi.fn(async () => record),
        list: vi.fn(async () => [record]),
      }),
    ]);

    expect(result).toEqual({ holders: ['sprite'], failures: [] });
  });
});
