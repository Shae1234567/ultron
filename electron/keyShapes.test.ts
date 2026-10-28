import { describe, expect, it } from 'vitest';
import { keyFromClipboard, keyHint, serviceOfKey, wrongBox } from './keyShapes';

// Made-up keys of the right shapes - none of these is real.
const OR = `sk-or-v1-${'a1'.repeat(32)}`;
const NV = `nvapi-${'Ab3_'.repeat(12)}`;
const GQ = `gsk_${'Q9x'.repeat(16)}`;

describe('key shapes', () => {
  it('knows whose key a key is', () => {
    expect(serviceOfKey(OR)?.id).toBe('openrouter');
    expect(serviceOfKey(NV)?.id).toBe('nvidia');
    expect(serviceOfKey(GQ)?.id).toBe('groq');
    expect(serviceOfKey('hello')).toBeNull();
  });

  it('turns back a key pasted into the wrong box, and lets unknown shapes through', () => {
    expect(wrongBox('openrouter', GQ)).toMatch(/looks like a Groq key, not an OpenRouter one/);
    expect(wrongBox('nvidia', OR)).toMatch(/OpenRouter key, not a NVIDIA one|OpenRouter key, not an NVIDIA one/);
    expect(wrongBox('openrouter', OR)).toBeNull();
    expect(wrongBox('openrouter', 'some-new-format-key-123')).toBeNull();
    expect(wrongBox('deepseek', `sk-${'b'.repeat(40)}`)).toBeNull();
  });

  it('describes a refused key by its shape, never its value', () => {
    expect(keyHint('openrouter', OR)).toMatch(/right shape for OpenRouter.*deleted/);
    expect(keyHint('nvidia', GQ)).toMatch(/looks like a Groq key/);
    expect(keyHint('nvidia', 'nvapi-short')).toMatch(/doesn't look like an NVIDIA key/);
    for (const k of [OR, NV, GQ]) for (const id of ['openrouter', 'nvidia', 'groq']) expect(keyHint(id, k) ?? '').not.toContain(k.slice(6, 20));
  });
});

describe('the clipboard watcher', () => {
  it('never offers a copied key to the AI', async () => {
    const { looksLikeSecret } = await import('./clipboardWatch');
    expect(looksLikeSecret(`sk-or-v1-${'a1'.repeat(32)}`)).toBe(true);
    expect(looksLikeSecret('ck_' + 'x'.repeat(24))).toBe(true);
    expect(looksLikeSecret('Ab3dEf7hIj0LmN2pQr5tUv8xYz1Bc4De')).toBe(true);
    expect(looksLikeSecret('the mitochondria is the powerhouse of the cell')).toBe(false);
    expect(looksLikeSecret('https://example.com/page')).toBe(false);
  });
});

describe('Paste & test', () => {
  const clean = (x: string) => x.trim().replace(/^["']|["']$/g, '');
  const now = async () => {};
  it('takes one key from the clipboard, waiting out a held clipboard', async () => {
    let n = 0;
    const read = () => { n++; if (n < 3) throw new Error('held'); return '  "nvapi-abc123"  '; };
    expect(await keyFromClipboard(read, 'NVIDIA', clean, now)).toEqual({ key: 'nvapi-abc123' });
  });
  it('says what to do when the clipboard is empty or is not a key', async () => {
    expect(await keyFromClipboard(() => '', 'NVIDIA', clean, now)).toMatchObject({ error: expect.stringMatching(/Copy the new NVIDIA key first/) });
    expect(await keyFromClipboard(() => 'my key is abc', 'NVIDIA', clean, now)).toMatchObject({ error: expect.stringMatching(/not a single key/) });
  });
});
