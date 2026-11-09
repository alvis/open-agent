import { describe, expect, it, vi } from 'vitest';

import { familyOf } from '#adapters/guest/os/families';
import { foundationSteps } from '#adapters/guest/plan/foundation';
import { registry } from '#composition/registry';
import { ROOT_ONLY_MODE } from '#domain/guest';

import { DISABLED_NETWORK_PROFILE } from '../../../fixtures/profile';

import type { PlanProvider } from '#application/ports/plan';
import type { ToolSpec } from '#domain/tools';

vi.mock(
  '#adapters/guest/platform/assets',
  async (importOriginal) =>
    ({
      ...(await importOriginal<
        typeof import('#adapters/guest/platform/assets')
      >()),
      readAsset: vi.fn(async (asset) => `contents of ${asset.path}`),
    }) satisfies Partial<typeof import('#adapters/guest/platform/assets')>,
);

const release = {
  family: 'debian',
  id: 'debian',
  versionId: '12',
  arch: 'x86_64',
  libc: 'glibc',
} as const;
const source = { kind: 'brew', formula: 'optional' } as const;
const tool = {
  name: 'optional',
  required: false,
  executables: ['optional'],
  version: { executable: 'optional', args: ['--version'], account: 'agent' },
  sources: [source],
} satisfies ToolSpec;

describe('fn:foundationSteps', () => {
  it('should leave Homebrew optional when only optional tools need it', async () => {
    const { id, capabilities, serviceBackend } = registry.providers.sprite;
    const provider = {
      id,
      capabilities: { ...capabilities, keepAwakeMode: 'none' },
      serviceBackend,
    } satisfies PlanProvider;

    const steps = await foundationSteps({
      registry,
      provider,
      profile: DISABLED_NETWORK_PROFILE,
      release,
      family: familyOf(release),
      tools: [tool],
      resolutions: [{ tool: tool.name, source }],
    });

    expect(steps.find((step) => step.id === 'homebrew')).toEqual(
      expect.objectContaining({ critical: false, retry: 'transport' }),
    );
  });

  it('should omit Homebrew when no tool resolves to a formula', async () => {
    const steps = await foundationSteps({
      registry,
      provider: registry.providers.sprite,
      profile: DISABLED_NETWORK_PROFILE,
      release,
      family: familyOf(release),
      tools: [],
      resolutions: [],
    });

    expect(steps.find((step) => step.id === 'homebrew')).toBeUndefined();
    expect(steps.find((step) => step.id === 'bootstrap')).toEqual(
      expect.objectContaining({ critical: true, retry: 'transport' }),
    );
  });

  it('should install the storage watcher root-only beside the governor', async () => {
    const steps = await foundationSteps({
      registry,
      provider: registry.providers.sprite,
      profile: DISABLED_NETWORK_PROFILE,
      release,
      family: familyOf(release),
      tools: [],
      resolutions: [],
    });

    expect(
      steps.find(({ id }) => id === 'asset:governor/storage.sh')?.apply,
    ).toEqual({
      argv: [
        familyOf(release).shell,
        '-c',
        expect.any(String),
        'oa-file',
        '/opt/open-agent/governor/storage.sh',
        '700',
      ],
      input: { kind: 'text', value: 'contents of governor/storage.sh' },
    });
  });

  it("should install a provider's storage adapter root-only with the guest programs", async () => {
    const provider = {
      ...registry.providers['fly-machine'],
      storageAsset: {
        path: 'drivers/providers/fixture/storage.sh',
        mode: ROOT_ONLY_MODE,
        installAs: '/opt/open-agent/providers/fixture/storage.sh',
      },
    } satisfies PlanProvider;

    const steps = await foundationSteps({
      registry,
      provider,
      profile: DISABLED_NETWORK_PROFILE,
      release,
      family: familyOf(release),
      tools: [],
      resolutions: [],
    });

    expect(
      steps.find(
        ({ id }) => id === 'asset:drivers/providers/fixture/storage.sh',
      ),
    ).toEqual(
      expect.objectContaining({
        account: 'root',
        apply: {
          argv: [
            familyOf(release).shell,
            '-c',
            expect.any(String),
            'oa-file',
            '/opt/open-agent/providers/fixture/storage.sh',
            '700',
          ],
          input: {
            kind: 'text',
            value: 'contents of drivers/providers/fixture/storage.sh',
          },
        },
      }),
    );
  });
});
