import { commandError } from './failures';

import { summarizeMachine } from './machine';

import type { BoundProvider } from '#application/catalog/providers';
import type { ListData, UnavailableProvider } from '#application/data';
import type { ApplicationDependencies } from '#application/ports/dependencies';
import type { CommandResult } from '#application/result';
import type { ProviderId } from '#domain/ids';
import type { CommandErrorCode } from '#kernel/faults';

/** a provider bound for listing, or the reason it cannot be queried */
export type ProviderAvailability =
  BoundProvider | { id: ProviderId; code: CommandErrorCode; reason: string };

/**
 * lists current managed workstations across every available provider without
 * opening guest sessions; a provider that fails is reported as unavailable
 * @param dependencies the registered drivers, the guest mechanics
 * @param providers providers bound with their credentials, or why they are not
 * @returns merged control-plane summaries and unavailable providers
 */
export async function listWorkstations(
  dependencies: Pick<ApplicationDependencies, 'registry' | 'guest'>,
  providers: readonly ProviderAvailability[],
): Promise<CommandResult> {
  const results = await Promise.all(
    providers.map(async (entry) => listProvider(dependencies, entry)),
  );
  const unavailable = results.flatMap((result) =>
    'reason' in result ? [result] : [],
  );
  const machines = results.flatMap((result) =>
    'machines' in result ? result.machines : [],
  );
  if (machines.length === 0 && unavailable.length === results.length) {
    const codes = new Set(unavailable.map(({ code }) => code));
    const [shared] = codes;

    return {
      command: 'list',
      ok: false,
      error: {
        code: codes.size === 1 && shared ? shared : 'PROVIDER',
        message: 'No provider could be queried',
        details: unavailable.map(
          ({ provider, reason }) => `${provider}: ${reason}`,
        ),
      },
    };
  }

  return { command: 'list', ok: true, data: { machines, unavailable } };
}

/**
 * queries one provider, turning its failure into an unavailable entry
 * @param dependencies the registered drivers, the guest mechanics
 * @param entry bound provider or its unavailability reason
 * @returns the provider's machines, or why it is unavailable
 */
async function listProvider(
  dependencies: Pick<ApplicationDependencies, 'registry' | 'guest'>,
  entry: ProviderAvailability,
): Promise<{ machines: ListData['machines'] } | UnavailableProvider> {
  if ('reason' in entry) {
    return { provider: entry.id, code: entry.code, reason: entry.reason };
  }
  try {
    const workstations = await entry.driver.list();

    // listing never wakes a guest, so only the release metadata records is
    // read; a newer workstation is marked, and every action on it still refuses
    return {
      machines: workstations.map((workstation) => {
        const newerRelease =
          dependencies.guest.release.newerMetadata(workstation);

        return {
          ...summarizeMachine(dependencies, workstation),
          provider: entry.id,
          newerRelease,
        };
      }),
    };
  } catch (error) {
    const { code, message } = commandError(error);

    return { provider: entry.id, code, reason: message };
  }
}
