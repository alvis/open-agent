import { describe, expect, it } from 'vitest';

import {
  validateCommandRequest,
  validateSetupIntegrationOptions,
} from '#application/validation';

import type { CommandRequest } from '#application/contracts';

describe('fn:validateCommandRequest', () => {
  it.each([
    { command: 'terminate', options: { nonInteractive: true } },
  ] satisfies CommandRequest[])(
    'should reject a request whose required consent conflicts with its options: %j',
    (request) => {
      expect(() => validateCommandRequest(request)).toThrow(
        expect.objectContaining({ code: 'USAGE' }),
      );
    },
  );

  it('should restrict section selection to setup', () => {
    expect(() =>
      validateCommandRequest({
        command: 'create',
        options: { section: 'network' },
      }),
    ).toThrow(expect.objectContaining({ code: 'USAGE' }));
    expect(() =>
      validateCommandRequest({ command: 'setup', options: {} }),
    ).not.toThrow();
  });
});

describe('fn:validateSetupIntegrationOptions', () => {
  it('should allow network and harness switches only in sections that apply them', () => {
    expect(() =>
      validateSetupIntegrationOptions(
        {
          network: 'none',
          harness: ['claude'],
        },
        'all',
      ),
    ).not.toThrow();
    expect(() => validateSetupIntegrationOptions({}, undefined)).not.toThrow();
    expect(() =>
      validateSetupIntegrationOptions({ network: 'none' }, 'network'),
    ).not.toThrow();
    expect(() =>
      validateSetupIntegrationOptions({ network: 'none' }, 'agent'),
    ).toThrow(expect.objectContaining({ code: 'USAGE' }));
    expect(() =>
      validateSetupIntegrationOptions({ harness: ['claude'] }, 'network'),
    ).toThrow(expect.objectContaining({ code: 'USAGE' }));
  });
});
