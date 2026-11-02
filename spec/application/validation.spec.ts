import { describe, expect, it } from 'vitest';

import {
  validateCommandRequest,
  validateSetupIntegrationOptions,
} from '#application/validation';

import type { CommandOptions, CommandRequest } from '#application/contracts';

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

  it('should reject conflicting requests before credentials or remote access', () => {
    const conflicts: CommandOptions[] = [
      {
        localCredentials: false,
        providerTokenSource: 'keychain:test/account',
      },
    ];

    for (const options of conflicts) {
      expect(() =>
        validateCommandRequest({ command: 'create', options }),
      ).toThrow(expect.objectContaining({ code: 'USAGE' }));
    }
  });

  it('should restrict section selection to setup', () => {
    expect(() =>
      validateCommandRequest({
        command: 'create',
        options: { section: 'tools' },
      }),
    ).toThrow(expect.objectContaining({ code: 'USAGE' }));
    expect(() =>
      validateCommandRequest({ command: 'setup', options: {} }),
    ).not.toThrow();
  });

  it('should refuse a pairing code for a non-pairing section', () => {
    expect(() =>
      validateCommandRequest({
        command: 'setup',
        options: { section: 'tools', withPairCode: true },
      }),
    ).toThrow(expect.objectContaining({ code: 'USAGE' }));
  });
});

describe('fn:validateSetupIntegrationOptions', () => {
  it('should allow network and option switches only in sections that apply them', () => {
    expect(() =>
      validateSetupIntegrationOptions(
        {
          network: 'none',
          harness: ['claude'],
          idleMinutes: 0,
        },
        'all',
      ),
    ).not.toThrow();
    expect(() => validateSetupIntegrationOptions({}, undefined)).not.toThrow();
    expect(() =>
      validateSetupIntegrationOptions({ network: 'none' }, 'network'),
    ).not.toThrow();
    expect(() =>
      validateSetupIntegrationOptions({ network: 'none' }, 'tools'),
    ).toThrow(expect.objectContaining({ code: 'USAGE' }));
    expect(() =>
      validateSetupIntegrationOptions({ idleMinutes: 30 }, 'network'),
    ).toThrow(expect.objectContaining({ code: 'USAGE' }));
  });

  it('should allow the update interval switch only in the tools section or the full setup', () => {
    const options = { updateDueDays: 3 };

    expect(() =>
      validateSetupIntegrationOptions(options, 'tools'),
    ).not.toThrow();
    expect(() => validateSetupIntegrationOptions(options, 'all')).not.toThrow();
    expect(() => validateSetupIntegrationOptions(options, 'agent')).toThrow(
      expect.objectContaining({ code: 'USAGE' }),
    );
    expect(() =>
      validateSetupIntegrationOptions({ updateDueDays: 3 }, 'network'),
    ).toThrow(expect.objectContaining({ code: 'USAGE' }));
  });
});
