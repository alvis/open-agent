import { describe, expect, it } from 'vitest';

import { commandError } from '#application/failures';
import { InteractionExit } from '#kernel/navigation';

describe('cl:InteractionExit', () => {
  it('should report a cancellation as a user cancellation', () => {
    expect(commandError(new InteractionExit('cancel'))).toMatchObject({
      code: 'CANCELLED',
      message: 'Cancelled by user.',
    });
  });
});
