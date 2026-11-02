import { describe, expect, it } from 'vitest';

import { familyOf } from '#adapters/guest/os/families';
import { toolSteps } from '#adapters/guest/plan/steps/tools';

import type { SystemToolSource, ToolSpec } from '#domain/tools';

const family = familyOf({
  family: 'debian',
});
const source = {
  kind: 'system',
  family: 'debian',
  packages: ['custom'],
} satisfies SystemToolSource;
const tool = {
  name: 'custom',
  required: true,
  executables: ['custom'],
  version: { executable: 'custom', args: ['--version'], account: 'root' },
  sources: [source],
} satisfies ToolSpec;
const context = { family, homebrewStep: 'homebrew' };

describe('fn:toolSteps', () => {
  it('should reject a resolution that names an undeclared tool', () => {
    expect(() => toolSteps([{ tool: tool.name, source }], [], context)).toThrow(
      expect.objectContaining({
        message: expect.stringMatching(/No tool custom/u),
      }),
    );
  });
});
