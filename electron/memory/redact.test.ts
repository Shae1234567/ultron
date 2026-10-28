import { describe, expect, it } from 'vitest';
import { redactSecrets } from './redact';

describe('redactSecrets', () => {
  it('removes keys, tokens, passwords and card numbers', () => {
    const out = redactSecrets([
      'gemini AIzaSyD4f6gH8jK0lM2nP4qR6sT8uV0wX2yZ4aB6',
      'composio ck_abcdefghijklmnop1234',
      'github ghp_abcdefghijklmnopqrstuvwxyz0123456789',
      'my password is hunter22',
      'card 4242 4242 4242 4242',
      'jwt eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U',
    ].join('\n'));
    expect(out).not.toMatch(/AIza|ck_abc|ghp_|hunter22|4242 4242|eyJhbGci/);
    expect(out).toContain('password [removed]');
    expect(out).toContain('[card number removed]');
  });

  it('leaves ordinary text and numbers alone', () => {
    const text = 'Shae scored 78, 91, 85 and 66. Phone the club at 403 555 0199. Tryouts were on 2026-09-10.';
    expect(redactSecrets(text)).toBe(text);
  });
});
