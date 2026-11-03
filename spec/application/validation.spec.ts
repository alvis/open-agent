import { describe, expect, it } from 'vitest';

import { validateCommandRequest } from '#application/validation';

import type { CommandRequest } from '#application/contracts';

describe('fn:validateCommandRequest', () => {
  it.each([
    { command: 'show', machine: 'Not A Name', options: {} },
    { command: 'create', options: { name: 'Not A Name' } },
  ] satisfies CommandRequest[])(
    'should reject a request naming an invalid workstation: %j',
    (request) => {
      expect(() => validateCommandRequest(request)).toThrow(
        expect.objectContaining({ code: 'INPUT' }),
      );
    },
  );
});
