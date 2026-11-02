import { describe, expect, it } from 'vitest';

import { setupNetwork } from '#application/setup/network';

describe('fn:setupNetwork', () => {
  it('should leave a workstation without a network disabled', () => {
    expect(setupNetwork()).toEqual({
      network: { status: 'disabled', readiness: 'skipped' },
    });
  });
});
