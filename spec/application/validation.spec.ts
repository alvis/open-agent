import { describe, expect, it } from 'vitest';

import { validateCommandRequest } from '#application/validation';

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
});
