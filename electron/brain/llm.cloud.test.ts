import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LlmError } from './types';

/*
 * 9 Oct 2026: OpenRouter and NVIDIA showed "key refused" while both keys were fine (OpenRouter's
 * own key check said 200; no model returned 401 or 403). What the models actually did was hang,
 * get overloaded, hit free-tier limits, or retire. Mid-conversation, each of those must move on
 * to another model or service - and only a confirmed refusal may ever mark a key bad.
 */

let keys = new Set<string>(['NVIDIA_API_KEY']);
vi.mock('../store', () => ({
  getSettings: () => ({ brain: 'cloud', thinking: 'deep', gemini: { model: '' }, clouds: {}, ollama: { host: 'http://127.0.0.1:11434', model: 'qwen3.5:4b', numCtx: 8192 } }),
  saveSettings: () => {},
  readDoc: (_n: string, fallback: unknown) => fallback,
  writeDoc: () => {},
}));
vi.mock('../secrets', () => ({ getSecret: (n: string) => (keys.has(n) ? `key-${n}` : ''), hasSecret: (n: string) => keys.has(n) }));
vi.mock('../ollama', () => ({ status: async () => ({ running: false, modelInstalled: false }) }));
vi.mock('./providers/ollama', () => ({ ollamaChat: async () => { throw new Error('the local model should not be needed'); } }));
vi.mock('./providers/gemini', () => ({ listGeminiModels: async () => null, geminiChat: async () => { throw new Error('no Gemini here'); } }));

// What each service's models do when Ultron talks to them.
const behaviour = new Map<string, () => never | { text: string }>();
vi.mock('./providers/openaiCompat', () => ({
  openaiChat: async (t: { baseUrl: string; model: string }) => {
    const svc = t.baseUrl.includes('openrouter') ? 'openrouter' : 'nvidia';
    const act = behaviour.get(`${svc} ${t.model}`);
    if (!act) throw new LlmError(`Model not available: ${t.model}`, 'model');
    const out = act();
    return { text: out.text, toolCalls: [], provider: 'cloud', model: t.model };
  },
}));

const BEST = 'alpha-70b-instruct:free', NEXT = 'beta-32b-instruct:free';
// The confirm step uses the network directly: the services' key checks and one-token probes.
let network: Record<string, number> = {};

const clouds = await import('../clouds');
const { chat } = await import('./llm');

beforeEach(async () => {
  clouds.resetClouds();
  behaviour.clear();
  network = {};
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: { body?: string }) => {
    if (url.endsWith('/models')) return new Response(JSON.stringify({ data: [{ id: BEST }, { id: NEXT }] }), { status: 200 });
    const model = init?.body ? (JSON.parse(init.body) as { model: string }).model : '';
    const code = network[url.includes('/chat/') ? `chat ${model}` : url] ?? 404;
    return new Response(JSON.stringify(code === 200 ? { choices: [{ message: { content: 'hi' } }] } : { error: { message: code === 401 ? 'User not found.' : 'nope', code } }), { status: code });
  }));
  await clouds.refreshAllClouds(true);
});

const status = (id: string) => clouds.cloudStatus().find((c) => c.id === id)!;
const ask = async () => {
  const notices: string[] = [];
  const res = await chat({ system: '', messages: [{ role: 'user', content: 'hi' }], onNotice: (t) => { notices.push(t); } });
  return { res, notices };
};

describe('mid-conversation, a model problem never brands the key', () => {
  it('a 403 from one model: the key is checked, the model is set aside, and the next model answers', async () => {
    behaviour.set(`nvidia ${BEST}`, () => { throw new LlmError('The API key was refused (403): Forbidden', 'auth'); });
    behaviour.set(`nvidia ${NEXT}`, () => ({ text: 'answered by the next model' }));
    network[`chat ${NEXT}`] = 200; // the second opinion: the same key works on another model
    const { res, notices } = await ask();
    expect(res.text).toBe('answered by the next model');
    expect(status('nvidia').valid).not.toBe(false);
    expect(notices.join(' ')).toMatch(/wouldn't run .*the key is fine/);
  });

  it('a hung model hands over to the next model on the same service', async () => {
    behaviour.set(`nvidia ${BEST}`, () => { throw new LlmError('The AI service stopped responding.', 'network'); });
    behaviour.set(`nvidia ${NEXT}`, () => ({ text: 'answered by the next model' }));
    const { res } = await ask();
    expect(res.text).toBe('answered by the next model');
    expect(status('nvidia').valid).not.toBe(false);
    // ...and that's the model it goes to first from now on.
    expect(clouds.chosenModel('nvidia')).toBe(NEXT);
  });

  it('a free model at its limit hands over to the next model, not straight to another service', async () => {
    behaviour.set(`nvidia ${BEST}`, () => { throw new LlmError('Rate limited: temporarily rate-limited upstream', 'rate'); });
    behaviour.set(`nvidia ${NEXT}`, () => ({ text: 'answered by the next model' }));
    expect((await ask()).res.text).toBe('answered by the next model');
  });
});

describe('a key that really is refused', () => {
  it('is said once, with the service’s own words, and the request moves on to the next service', async () => {
    keys = new Set(['OPENROUTER_API_KEY', 'NVIDIA_API_KEY']);
    clouds.resetClouds();
    await clouds.refreshAllClouds(true);
    behaviour.set(`openrouter ${BEST}`, () => { throw new LlmError('The API key was refused (401): User not found.', 'auth'); });
    network['https://openrouter.ai/api/v1/key'] = 401;
    behaviour.set(`nvidia ${BEST}`, () => ({ text: 'answered by NVIDIA' }));
    const { res, notices } = await ask();
    expect(res.text).toBe('answered by NVIDIA');
    expect(status('openrouter').valid).toBe(false);
    expect(status('openrouter').error).toMatch(/OpenRouter refused the key: "User not found\."/);
    expect(notices.join(' ')).toMatch(/OpenRouter rejected its key/);
    keys = new Set(['NVIDIA_API_KEY']);
  });
});
