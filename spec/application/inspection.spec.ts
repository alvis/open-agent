import { mkdtempDisposable } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';

import { SpritesClient } from '@fly/sprites';
import { describe, expect, it, vi } from 'vitest';

import {
  MANAGED_LABEL,
  SCHEMA_LABEL,
  mergeMetadataLabels,
} from '#adapters/drivers/providers/sprite/labels';
import { ENVIRONMENT_PATH } from '#adapters/guest/platform/layout';
import { showWorkstation } from '#application/inspection';
import { runCommand } from '#application/workstation';
import { resultExitCode } from '#cli/exit';
import { prepareResult, writePreparedResult } from '#cli/output';
import { projectResult } from '#cli/output/project';
import { serializeResult } from '#cli/serialization';
import { summarizeProfile } from '#domain/recorded';

import { OperationContext } from '#kernel/operation';

import { rememberSecret } from '#kernel/redaction';

import { OPEN_AGENT_VERSION } from '#kernel/version';

import { environmentOf } from '../fixtures/environment';
import { DISABLED_NETWORK_PROFILE } from '../fixtures/profile';

import { dependencies } from '../mocks/dependencies';
import {
  createFilesystemSprite,
  providerOf,
  serveServiceRegistry,
} from '../mocks/sprites';

import type { Sprite } from '@fly/sprites';

import type { Mock } from 'vitest';

import type { GuestExecute } from '../mocks/sprites';

// setup's root session is a framed guest shell only the live specs open
vi.mock(
  '#adapters/guest/platform/session/open',
  async () => import('../mocks/session'),
);

/** the profile the installed workstation recorded */
const PROFILE = DISABLED_NETWORK_PROFILE;

/**
 * creates a managed SDK boundary with one installed disposable workstation
 * @param root isolated guest filesystem root
 * @param ready whether the guest serves ready service and endpoint evidence
 * @returns provider client, managed Sprite and the guest's answer to every
 * command other than a file program
 */
async function installedSprite(
  root: string,
  ready = false,
): Promise<{
  client: SpritesClient;
  sprite: Sprite;
  execute: Mock<GuestExecute>;
}> {
  const client = new SpritesClient('test-org/1/0abc/0def');
  const agentEnvironment = {
    ok: true,
    serverVersion: '0.0.46-nightly.20261014.3118',
    orchestrationProtocolVersion: 2,
  };
  const execute = vi.fn<GuestExecute>(async (_file, args) => ({
    stdout:
      ready && args?.includes('/usr/bin/curl')
        ? `${JSON.stringify(agentEnvironment)}\n200`
        : '[]',
    stderr: '',
    exitCode: 0,
  }));
  const sprite = Object.assign(createFilesystemSprite({ root, execute }), {
    id: 'sprite-temporary',
    organizationName: 'test-org',
    // set up by this release
    labels: mergeMetadataLabels([MANAGED_LABEL, SCHEMA_LABEL], {
      setup: 'ready',
      profile: summarizeProfile(PROFILE),
      version: OPEN_AGENT_VERSION,
    }),
    url: 'https://temporary.sprites.app',
    status: 'running',
    listServices: vi.fn<Sprite['listServices']>(async () =>
      ready
        ? [
            {
              name: 't3-code',
              cmd: '/opt/open-agent/drivers/agents/t3/launcher.sh',
              args: [],
              needs: [],
              state: { name: 't3-code', status: 'running' },
            },
          ]
        : [],
    ),
  });
  serveServiceRegistry(sprite);
  vi.spyOn(client, 'listAllSprites').mockResolvedValue([sprite]);
  vi.spyOn(client, 'getSprite').mockResolvedValue(sprite);
  await sprite
    .filesystem()
    .writeFile(ENVIRONMENT_PATH, JSON.stringify(environmentOf(PROFILE)));

  return { client, sprite, execute };
}

/**
 * creates a managed SDK boundary with one workstation
 * @param root isolated guest filesystem root
 * @returns provider client and the guest's answer to every command other
 * than a file program
 */
async function managedSprite(
  root: string,
): Promise<{ client: SpritesClient; execute: Mock<GuestExecute> }> {
  const client = new SpritesClient('test-org/1/0abc/0def');
  const execute = vi.fn<GuestExecute>(async () => ({
    stdout: '',
    stderr: '',
    exitCode: 0,
  }));
  const sprite = Object.assign(
    createFilesystemSprite({ root, name: 'primary', execute }),
    {
      id: 'sprite-primary',
      organizationName: 'test-org',
      labels: [MANAGED_LABEL, SCHEMA_LABEL],
      url: 'https://primary.sprites.app',
      status: 'running',
    },
  );
  vi.spyOn(client, 'getSprite').mockResolvedValue(sprite);

  return { client, execute };
}

describe('cmd:show', () => {
  it('should report a non-Error SDK rejection as one redacted failure', async () => {
    const privateRejection = 'sdk-private-rejection';
    rememberSecret(privateRejection);
    vi.stubEnv('SPRITES_TOKEN', 'test-org/1/0abc/0def');
    vi.spyOn(SpritesClient.prototype, 'getSprite').mockRejectedValueOnce(
      privateRejection,
    );
    const result = await runCommand(dependencies, {
      command: 'show',
      machine: 'primary',
      options: { nonInteractive: true },
    });
    const stdout = new PassThrough();
    const stderr = new PassThrough();
    let out = '';
    let diagnostic = '';
    stdout.on('data', (chunk: Buffer) => {
      out += chunk.toString();
    });
    stderr.on('data', (chunk: Buffer) => {
      diagnostic += chunk.toString();
    });
    try {
      writePreparedResult(
        prepareResult({
          result,
          streams: { stdout, stderr },
        }),
        { stdout, stderr },
      );
    } finally {
      stdout.destroy();
      stderr.destroy();
    }

    expect(result).toMatchObject({
      command: 'show',
      ok: false,
      error: { code: 'UNEXPECTED', machine: 'primary' },
    });
    expect(out).toBe('');
    expect(diagnostic).toContain('Workstation: primary');
    expect(diagnostic).not.toContain('sdk-private-rejection');
  });

  it('should keep failed native inspection visible in show --inspect', async () => {
    await using directory = await mkdtempDisposable(
      join(tmpdir(), 'open-agent-show-probe-failure-'),
    );
    const { client, sprite } = await installedSprite(directory.path);
    const exists = vi.mocked(sprite.filesystem().exists);
    const seeded = exists.getMockImplementation()!;
    exists.mockImplementation(async (path) => {
      if (path.endsWith('/.claude/.credentials.json')) {
        throw new Error('native credential probe unavailable');
      }

      return seeded(path);
    });

    const result = await showWorkstation(dependencies, {
      request: {
        command: 'show',
        machine: 'temporary',
        options: { inspect: true },
      },
      provider: providerOf(client),
    });
    expect(result).toMatchObject({
      command: 'show',
      ok: true,
      data: {
        inspection: {
          probeFailures: [
            { probe: 'native', reason: 'native credential probe unavailable' },
          ],
          readiness: {
            ready: false,
            failures: expect.arrayContaining(['native inspection unavailable']),
          },
        },
      },
    });
    expect(serializeResult(projectResult(result))).toMatchObject({
      data: { inspection: { probeFailures: [{ probe: 'native' }] } },
    });
  });

  it('should return cancellation exit 130 during a deferred show --inspect probe', async () => {
    await using directory = await mkdtempDisposable(
      join(tmpdir(), 'open-agent-show-cancel-'),
    );
    const { sprite } = await installedSprite(directory.path);
    const pending =
      Promise.withResolvers<Awaited<ReturnType<Sprite['listServices']>>>();
    vi.mocked(sprite.listServices).mockReturnValue(pending.promise);
    vi.spyOn(SpritesClient.prototype, 'getSprite').mockResolvedValue(sprite);
    vi.stubEnv('SPRITES_TOKEN', 'test-org/1/0abc/0def');
    const controller = new AbortController();
    const context = new OperationContext({ signal: controller.signal });
    try {
      const resultPromise = runCommand(
        dependencies,
        {
          command: 'show',
          machine: 'temporary',
          options: { nonInteractive: true, inspect: true },
        },
        { operation: context },
      );
      await vi.waitFor(() =>
        expect(sprite.listServices).toHaveBeenCalledOnce(),
      );
      controller.abort();
      const result = await resultPromise;
      expect(result).toMatchObject({
        command: 'show',
        ok: false,
        error: { code: 'CANCELLED', machineId: 'sprite-temporary' },
      });
      expect(resultExitCode(result)).toBe(130);
    } finally {
      pending.resolve([]);
    }
  });

  it('should show the ordinary URL without opening the guest', async () => {
    await using directory = await mkdtempDisposable(
      join(tmpdir(), 'open-agent-show-url-'),
    );
    const { client, execute } = await managedSprite(directory.path);

    const result = await showWorkstation(dependencies, {
      request: {
        command: 'show',
        machine: 'primary',
        options: {},
      },
      provider: providerOf(client),
    });

    expect(result).toMatchObject({
      ok: true,
      data: { machine: { agentUrl: 'https://primary.sprites.app' } },
    });
    expect(execute).not.toHaveBeenCalled();
  });
});

describe('provider choice on an existing workstation', () => {
  it('should answer with sprite when only a provider token source is given', async () => {
    vi.stubEnv('OPEN_AGENT_TEST_SOURCE', 'FlyV1 fm2_generated-macaroon');
    vi.stubEnv('SPRITES_TOKEN', undefined);

    const result = await runCommand(dependencies, {
      command: 'show',
      machine: 'primary',
      options: {
        providerTokenSource: 'env:OPEN_AGENT_TEST_SOURCE',
        nonInteractive: true,
      },
    });

    expect(result).toMatchObject({
      command: 'show',
      ok: false,
      error: {
        code: 'INPUT',
        details: [expect.stringContaining('holds a Fly API token')],
      },
    });
  });
});
