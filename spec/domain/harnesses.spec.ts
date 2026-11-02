import { describe, expect, it } from 'vitest';

import { harnessIds, harnessLabel } from '#domain/harnesses';

describe('fn:harnessIds', () => {
  it('should list every registered harness in registration order', () => {
    expect(harnessIds()).toEqual(['claude']);
  });
});

describe('fn:harnessLabel', () => {
  it('should capitalize the identifier', () => {
    expect(harnessIds().map(harnessLabel)).toEqual(['Claude']);
  });
});
