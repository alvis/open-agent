import { describe, expect, it } from 'vitest';

import { registry } from '#composition/registry';
import { driverCredentialNames } from '#domain/environment-names';
import { networkIds } from '#domain/networks';

describe('fn:driverCredentialNames', () => {
  it('should reserve the management credential of every registered provider', () => {
    expect(driverCredentialNames(registry)).toEqual(['SPRITES_TOKEN']);
  });
});

describe('fn:networkIds', () => {
  it('should list every registered network, including one that declares nothing', () => {
    expect(networkIds()).toEqual(['none']);
  });
});
