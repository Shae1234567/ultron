import { beforeEach, describe, expect, it, vi } from 'vitest';

/*
 * Private work (health logs, injuries, grades) only goes to a brain that neither keeps nor
 * trains on it: the local model, or a free service he trusts with it (Groq by default).
 * Here OpenRouter ranks first, so ordinary questions go there - private ones must not.
 */

const settings = {
  brain: 'cloud', thinking: 'deep', gemini: { model: '' },
  clouds: { openrouter: { rank: 0 }, groq: { rank: 1 } } as Record<string, { rank?: number }>,
  ollama: { host: 'http://127.0.0.1:11434', model: 'qwen3.5:4b', numCtx: 8192 },
  privacy: { trusted: ['groq'], terms: [] as string[] },
};
vi.mock('../store', () => ({ getSettings: () => settings, saveSettings: () => {}, readDoc: (_n: string, f: unknown) => f, writeDoc: () => {} }));
const keys = new Set(['OPENROUTER_API_KEY', 'GROQ_API_KEY']);
vi.mock('../secrets', () => ({ getSecret: (n: string) => (keys.has(n) ? `key-${n}` : ''), hasSecret: (n: string) => keys.has(n) }));
vi.mock('../ollama', () => ({ status: async () => ({ running: false, modelInstalled: false }) }));
vi.mock('./providers/ollama', () => ({ ollamaChat: async () => { throw new Error('the local model is off in this test'); } }));
vi.mock('./providers/gemini', () => ({ listGeminiModels: async () => null, geminiChat: async () => { throw new Error('no Gemini here'); } }));

const asked: string[] = [];
vi.mock('./providers/openaiCompat', () => ({
  openaiChat: async (t: { baseUrl: string; model: string }) => {
    const svc = t.baseUrl.includes('openrouter') ? 'openrouter' : t.baseUrl.includes('groq') ? 'groq' : 'other';
    asked.push(svc);
    return { text: `answered by ${svc}`, toolCalls: [], provider: 'cloud', model: t.model };
  },
}));

const clouds = await import('../clouds');
const { chat } = await import('./llm');
const { NO_PRIVATE_BRAIN } = await import('./privacy');

beforeEach(async () => {
  asked.length = 0;
  settings.privacy.trusted = ['groq'];
  clouds.resetClouds();
  vi.stubGlobal('fetch', vi.fn(async (url: string) => (url.endsWith('/models')
    ? new Response(JSON.stringify({ data: [{ id: 'alpha-70b-instruct' }] }), { status: 200 })
    : new Response('{}', { status: 404 }))));
  await clouds.refreshAllClouds(true);
});

const ask = (priv: boolean) => chat({ system: '', messages: [{ role: 'user', content: 'how did I sleep this week?' }], private: priv });

describe('private data and the AI services', () => {
  it('an ordinary question goes to the first-ranked service', async () => {
    expect((await ask(false)).text).toBe('answered by openrouter');
  });

  it('a private one skips the services that may keep it, and goes to the trusted one', async () => {
    expect((await ask(true)).text).toBe('answered by groq');
    expect(asked).not.toContain('openrouter');
  });

  it('inside a request marked private, every call is private without saying so', async () => {
    const { markPrivate, withPrivacyScope } = await import('./privacy');
    const text = await withPrivacyScope(async () => {
      markPrivate();
      return (await chat({ system: '', messages: [{ role: 'user', content: 'and my grades?' }] })).text;
    });
    expect(text).toBe('answered by groq');
    // ...while a call that says it is not private (background memory filing for an ordinary exchange) is not.
    const plain = await withPrivacyScope(async () => { markPrivate(); return (await ask(false)).text; });
    expect(plain).toBe('answered by openrouter');
  });

  it('with nothing trusted and the local model off, it says so instead of sending it anywhere', async () => {
    settings.privacy.trusted = [];
    await expect(ask(true)).rejects.toThrow(NO_PRIVATE_BRAIN);
    expect(asked).toEqual([]);
  });
});
