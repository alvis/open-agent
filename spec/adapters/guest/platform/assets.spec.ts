import { describe, expect, it } from 'vitest';

import { T3_LAUNCHER } from '#adapters/drivers/agents/t3/service';
import { guestAsset, readAsset } from '#adapters/guest/platform/assets';

describe('fn:readAsset', () => {
  it('should reject a guest asset that escapes the package tree', () => {
    expect(() => guestAsset('../outside.sh', 0o755)).toThrow(/relative/iu);
  });

  it('should assign the variables an asset adds after the layout in its header', async () => {
    const launcher = await readAsset(T3_LAUNCHER);
    const plain = await readAsset({
      path: 'drivers/providers/sprite/awake.sh',
    });

    expect(launcher).toContain("\nOA_GUEST_ROOT='/opt/open-agent'\n");
    expect(launcher).toContain("\nOA_T3_MIN_FREE_MB='64'\n");
    expect(plain).toContain("\nOA_GUEST_ROOT='/opt/open-agent'\n");
    expect(plain).not.toContain('OA_T3_MIN_FREE_MB=');
  });

  it('should refuse an added variable that is not an OA_ name or redefines the layout', async () => {
    await expect(
      readAsset({
        path: 'drivers/providers/sprite/awake.sh',
        variables: { OA_GUEST_ROOT: '/srv', PATH: '/srv/bin' },
      }),
    ).rejects.toThrow(
      'Guest asset drivers/providers/sprite/awake.sh adds invalid header variables: OA_GUEST_ROOT, PATH',
    );
  });
});
