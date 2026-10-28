import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const dir = path.join(os.tmpdir(), `secret-safety-${process.pid}`);
/** Entries whose "ciphertext" starts with this cannot be decrypted, to stand in for a corrupt value. */
const BROKEN = 'BROKEN:';

vi.mock('electron', () => ({
  app: { getPath: () => dir },
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (s: string) => Buffer.from(`enc:${s}`),
    decryptString: (b: Buffer) => {
      const text = b.toString();
      if (text.startsWith(BROKEN)) throw new Error('Error while decrypting the ciphertext provided to safeStorage.decryptString.');
      return text.replace(/^enc:/, '');
    },
  },
}));

const file = () => path.join(dir, 'secrets.json');
const enc = (v: string) => Buffer.from(`enc:${v}`).toString('base64');
const broken = () => Buffer.from(`${BROKEN}whatever`).toString('base64');
const read = () => JSON.parse(fs.readFileSync(file(), 'utf8')) as { items: Record<string, string> };

beforeEach(() => {
  fs.mkdirSync(dir, { recursive: true });
  vi.resetModules();
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe('one unreadable secret must not cost the others', () => {
  it('still loads every other key when one cannot be decrypted', async () => {
    fs.writeFileSync(file(), JSON.stringify({
      v: 1,
      encrypted: true,
      // GEMINI comes first in the name order, GROQ is broken, DISCORD comes later.
      items: { GEMINI_API_KEY: enc('gem-key'), GROQ_API_KEY: broken(), DISCORD_BOT_TOKEN: enc('disc-token') },
    }));
    const { getSecret, hasSecret } = await import('./secrets');
    expect(getSecret('GEMINI_API_KEY')).toBe('gem-key');
    // The one after the broken entry is the whole point: before the fix the loop aborted here.
    expect(getSecret('DISCORD_BOT_TOKEN')).toBe('disc-token');
    expect(hasSecret('GROQ_API_KEY')).toBe(false);
  });

  it('saving a new key keeps the others, including the unreadable one', async () => {
    fs.writeFileSync(file(), JSON.stringify({
      v: 1,
      encrypted: true,
      items: { GEMINI_API_KEY: enc('gem-key'), GROQ_API_KEY: broken(), DISCORD_BOT_TOKEN: enc('disc-token') },
    }));
    const { setSecret } = await import('./secrets');
    setSecret('OPENROUTER_API_KEY', 'new-router-key');
    const items = read().items;
    // The real regression: a save used to write a truncated file and lose these for good.
    expect(Object.keys(items).sort()).toEqual(['DISCORD_BOT_TOKEN', 'GEMINI_API_KEY', 'GROQ_API_KEY', 'OPENROUTER_API_KEY']);
    // The unreadable one is written back byte for byte, not dropped and not re-encrypted.
    expect(items.GROQ_API_KEY).toBe(broken());
  });

  it('removing a key leaves the rest alone', async () => {
    fs.writeFileSync(file(), JSON.stringify({
      v: 1, encrypted: true, items: { GEMINI_API_KEY: enc('gem-key'), DISCORD_BOT_TOKEN: enc('disc-token') },
    }));
    const { setSecret, getSecret } = await import('./secrets');
    setSecret('GEMINI_API_KEY', '');
    expect(getSecret('DISCORD_BOT_TOKEN')).toBe('disc-token');
    expect(Object.keys(read().items)).toEqual(['DISCORD_BOT_TOKEN']);
  });
});

describe('the key file is never the only copy', () => {
  it('writes a backup beside it, and restores from that if the live file is lost', async () => {
    fs.writeFileSync(file(), JSON.stringify({ v: 1, encrypted: true, items: { GEMINI_API_KEY: enc('gem-key') } }));
    const first = await import('./secrets');
    first.setSecret('GROQ_API_KEY', 'groq-key');
    expect(fs.existsSync(`${file()}.backup`)).toBe(true);

    // Something deletes the live file - a crash mid-write, a tidy-up gone wrong.
    fs.rmSync(file());
    vi.resetModules();
    const after = await import('./secrets');
    expect(after.getSecret('GEMINI_API_KEY')).toBe('gem-key');
    expect(after.getSecret('GROQ_API_KEY')).toBe('groq-key');
    expect(fs.existsSync(file())).toBe(true);
  });

  it('ignores a corrupt live file and uses the backup', async () => {
    fs.writeFileSync(file(), JSON.stringify({ v: 1, encrypted: true, items: { DISCORD_BOT_TOKEN: enc('disc') } }));
    const first = await import('./secrets');
    first.setSecret('GNEWS_API_KEY', 'news-key');
    fs.writeFileSync(file(), '{ this is not json');
    vi.resetModules();
    const after = await import('./secrets');
    expect(after.getSecret('DISCORD_BOT_TOKEN')).toBe('disc');
    expect(after.getSecret('GNEWS_API_KEY')).toBe('news-key');
  });
});

describe('a key for a service this build no longer has', () => {
  it('is kept, not deleted, so swapping a service out never loses what was pasted', async () => {
    fs.writeFileSync(file(), JSON.stringify({
      v: 1,
      encrypted: true,
      // Neither of these is one of this build's names any more - SambaNova was swapped out,
      // and Cohere was dropped on 7 Oct 2026 after its key was rejected. Both must survive.
      items: { GEMINI_API_KEY: enc('gem-key'), SAMBANOVA_API_KEY: enc('samba-key'), COHERE_API_KEY: enc('cohere-key') },
    }));
    const { setSecret } = await import('./secrets');
    setSecret('GROQ_API_KEY', 'groq-key');
    const items = read().items;
    expect(Object.keys(items).sort()).toEqual(['COHERE_API_KEY', 'GEMINI_API_KEY', 'GROQ_API_KEY', 'SAMBANOVA_API_KEY']);
    // Byte for byte - still usable if either service ever comes back.
    expect(items.SAMBANOVA_API_KEY).toBe(enc('samba-key'));
    expect(items.COHERE_API_KEY).toBe(enc('cohere-key'));
  });
});
