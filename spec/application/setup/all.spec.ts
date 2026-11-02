import { mkdtempDisposable, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { CLAUDE_SETTINGS } from '#adapters/drivers/harnesses/claude/paths';
import {
  MANAGED_LABEL,
  mergeMetadataLabels,
  SCHEMA_LABEL,
} from '#adapters/drivers/providers/sprite/labels';
import { ENVIRONMENT_PATH } from '#adapters/guest/platform/layout';
import { setupAll } from '#application/setup/all';
import { registry } from '#composition/registry';
import { summarizeProfile } from '#domain/recorded';
import { agentService } from '#domain/services';
import { OPEN_AGENT_VERSION } from '#kernel/version';

import { DISABLED_NETWORK_PROFILE } from '../../fixtures/profile';
import { dependencies, dependenciesWith } from '../../mocks/dependencies';
import {
  createFilesystemSprite,
  holdServices,
  workstationOf,
} from '../../mocks/sprites';

import type { SetupContext } from '#application/setup/context';

// setup's root session is a framed guest shell only the live specs open
vi.mock(
  '#adapters/guest/platform/session/open',
  async () => import('../../mocks/session'),
);
describe('fn:setupAll', () => {
  it('should complete the full setup and record readiness after configuring the guest', async () => {
    await using directory = await mkdtempDisposable(
      join(tmpdir(), 'open-agent-setup-all-'),
    );
    const sprite = createFilesystemSprite({
      root: directory.path,
      execute: async () => ({
        stdout: '',
        stderr: '',
        exitCode: 0,
      }),
    });
    const services = holdServiceDefinitions(sprite);
    vi.spyOn(sprite, 'updateURLSettings').mockResolvedValue(undefined);
    const profile = DISABLED_NETWORK_PROFILE;
    Object.assign(sprite, {
      labels: mergeMetadataLabels([MANAGED_LABEL, SCHEMA_LABEL], {
        setup: 'ready',
        profile: summarizeProfile(profile),
        version: OPEN_AGENT_VERSION,
      }),
    });
    const context: SetupContext = {
      ...workstationOf(sprite),
      options: {
        nonInteractive: true,
      },
      input: {
        profile,
        sources: {},
        missing: [],
      },
      profile,
      persistsProfile: false,
      mutation: { started: false },
    };
    const agentName = registry.agents[profile.agent].service.name;
    const guest = {
      ...dependencies.guest,
      native: {
        ...dependencies.guest.native,
        inspectAgentEnvironment: async () => ({
          ok: true as const,
          serverVersion: '',
        }),
      },
      inspection: {
        inspect: async () => ({
          services: [registry.agents[profile.agent].service.name].map(
            (name) => ({ name, needs: [], status: 'running' as const }),
          ),
          network: {
            online: false,
            skipped: true,
            reason: 'No private network is selected',
          },
          native: {
            claude: {
              authentication: 'not-configured' as const,
            },
            agentEnvironment: { ok: true as const, serverVersion: '' },
            harnesses: {},
          },
          environment: await dependencies.guest.environment.read(
            await context.connection.guest(),
          ),
          probeFailures: [],
        }),
      },
    };

    await expect(
      setupAll(
        dependenciesWith({ guest }),
        await context.connection.guest(),
        context,
      ),
    ).resolves.toMatchObject({
      network: { status: 'disabled', readiness: 'skipped' },
    });

    expect(
      await sprite.filesystem().exists('/opt/open-agent/workstation-name'),
    ).toBe(true);
    expect(await sprite.filesystem().exists(CLAUDE_SETTINGS)).toBe(true);
    expect(
      JSON.parse(
        await readFile(join(directory.path, ENVIRONMENT_PATH), 'utf8'),
      ),
    ).toMatchObject({ setup: { state: 'ready' } });
    expect(sprite.updateURLSettings).toHaveBeenCalledOnce();
    expect(services.get(agentName)?.state?.status).toBe('running');
  });

  it('should leave the agent serving and the setup incomplete when the final setup section fails', async () => {
    await using directory = await mkdtempDisposable(
      join(tmpdir(), 'open-agent-setup-failure-'),
    );
    const sprite = createFilesystemSprite({
      root: directory.path,
      execute: async () => ({ stdout: '', stderr: '', exitCode: 0 }),
    });
    const services = holdServiceDefinitions(sprite);
    const exposure = vi
      .spyOn(sprite, 'updateURLSettings')
      .mockResolvedValue(undefined);
    const profile = DISABLED_NETWORK_PROFILE;
    const context: SetupContext = {
      ...workstationOf(sprite),
      options: {
        nonInteractive: true,
      },
      input: { profile, sources: {}, missing: [] },
      profile,
      persistsProfile: false,
      mutation: { started: false },
    };
    const channel = await context.connection.guest();
    const agentName = registry.agents[profile.agent].service.name;
    await channel.services.ensure(agentService(registry, profile));
    const failure = new Error('The harness configuration could not be written');
    const observed: Array<{ status: string | undefined }> = [];
    using _harness = vi
      .spyOn(registry.harnesses.claude, 'configure')
      .mockImplementation(async () => {
        observed.push({ status: services.get(agentName)?.state?.status });
        throw failure;
      });

    await expect(setupAll(dependencies, channel, context)).rejects.toBe(
      failure,
    );

    expect(observed).toEqual([{ status: 'running' }]);
    expect(services.get(agentName)?.state?.status).toBe('running');
    expect(
      JSON.parse(
        await readFile(join(directory.path, ENVIRONMENT_PATH), 'utf8'),
      ),
    ).toMatchObject({ setup: { state: 'incomplete' } });
    expect(exposure.mock.calls).toEqual([]);
    await context.connection.close();
  });
});

/**
 * holds native service definitions, including the routed port the SDK returns
 * @param sprite filesystem-backed provider boundary
 * @returns the provider's live service definitions and states
 */
function holdServiceDefinitions(
  sprite: Parameters<typeof holdServices>[0],
): ReturnType<typeof holdServices> {
  const services = holdServices(sprite);
  const create = vi.mocked(sprite.createService).getMockImplementation();
  if (!create) {
    throw new Error('The native service creation boundary is not installed');
  }
  vi.mocked(sprite.createService).mockImplementation(
    async (name, request, timeout) => {
      const result = await create(name, request, timeout);
      const service = services.get(name);
      if (service) {
        service.httpPort = request.httpPort;
      }

      return result;
    },
  );

  return services;
}
