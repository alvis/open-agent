import { describe, expect, it } from 'vitest';

import { serviceLabels } from '#application/catalog/services';
import { registry } from '#composition/registry';

describe('fn:serviceLabels', () => {
  it('should name no service for a network', () => {
    expect(Object.values(serviceLabels(registry))).not.toContain('None');
  });
});
