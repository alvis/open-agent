import { describe, expect, it } from 'vitest';

import { validateCommandRequest } from '#application/validation';

import type { CommandRequest } from '#application/contracts';

describe('fn:validateCommandRequest', () => {
  it('should reject a create request naming an invalid workstation', () => {
    const request: CommandRequest = {
      command: 'create',
      options: { name: 'Not A Name' },
    };

    expect(() => validateCommandRequest(request)).toThrow(
      expect.objectContaining({ code: 'INPUT' }),
    );
  });
});
