import { inspect } from 'node:util';

import { describe, expect, it } from 'vitest';

import { Secret, revealSecret } from '#kernel/secret';

describe('host secrets', () => {
  it('should deliver embedded guest contents without printing them', () => {
    const contents = 'token=kernel-embedded-value';
    const secret = Secret.embedding(contents);

    expect(revealSecret(secret)).toBe(contents);
    expect(String(secret)).not.toContain(contents);
    expect(secret.source).toBe('embedded');
  });

  it('should redact string, JSON, and inspected representations', () => {
    const value = 'kernel-secret-print-value';
    const secret = Secret.embedding(value);

    expect(String(secret)).toBe('[REDACTED]');
    expect(JSON.stringify({ credential: secret })).toBe(
      '{"credential":"[REDACTED]"}',
    );
    expect(inspect(secret)).toContain('Secret(embedded) [REDACTED]');
    expect(inspect(secret)).not.toContain(value);
  });

  it('should reject a secret wrapper that was not registered for guest delivery', () => {
    const secret = Secret.embedding('kernel-secret-proxy-value');
    const wrapper = new Proxy(secret, {});

    expect(() => revealSecret(wrapper)).toThrowError();
  });
});
