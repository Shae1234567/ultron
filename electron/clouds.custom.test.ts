import { beforeEach, describe, expect, it, vi } from 'vitest';

/* Services he adds himself (10 Oct 2026), and the race that keeps a hanging model from slowing Ultron down. */

const keys = new Map<string, string>();
const settings: { clouds: Record<string, unknown>; customClouds: { id: string; label: string; baseUrl: string; model?: string; modelsUrl?: string }[] } = { clouds: {}, customClouds: [] };
vi.mock('./secrets', () => ({
  getSecret: (n: string) => keys.get(n) ?? '',
  hasSecret: (n: string) => keys.has(n),
  setCustomSecret: (n: string, v: string | null) => { if (v) keys.set(n, v); else keys.delete(n); },
}));
vi.mock('./store', () => ({
  getSettings: () => settings,
  saveSettings: (p: Partial<typeof settings>) => Object.assign(settings, p),
  readDoc: (_n: string, f: unknown) => f,
  writeDoc: () => {},
}));

const clouds = await import('./clouds');
const { health } = await import('./cloudHealth');

type Answer = { status: number; body?: unknown } | 'hang';
let routes: Record<string, Answer> = {};
let asked: string[] = [];
const OK = { status: 200, body: { choices: [{ message: { role: 'assistant', content: 'ok' } }] } };

beforeEach(() => {
  clouds.resetClouds();
  keys.clear();
  settings.customClouds = [];
  routes = {};
  asked = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: { body?: string }) => {
    const model = init?.body ? (JSON.parse(init.body) as { model: string }).model : '';
    const key = url.includes('/chat/completions') ? `chat ${new URL(url).host} ${model}` : `GET ${url}`;
    asked.push(key);
    const a = routes[key] ?? { status: 404, body: { error: { message: 'no such route', code: 404 } } };
    if (a === 'hang') throw Object.assign(new Error('timeout'), { name: 'TimeoutError' });
    return new Response(JSON.stringify(a.body ?? {}), { status: a.status });
  }));
});

describe('adding a service', () => {
  it('a preset with one paste: GitHub Models, whose model list is a plain list somewhere else', async () => {
    routes['GET https://models.github.ai/catalog/models'] = { status: 200, body: [{ id: 'openai/gpt-4.1-mini' }, { id: 'meta/llama-4-scout' }] };
    routes['chat models.github.ai openai/gpt-4.1'] = OK;
    routes['chat models.github.ai openai/gpt-4.1-mini'] = OK;
    routes['chat models.github.ai meta/llama-4-scout'] = OK;
    const r = await clouds.addCloud({ preset: 'github', key: 'ghp_example' });
    expect(r).toMatchObject({ ok: true, id: 'github' });
    expect(keys.get('CUSTOM_GITHUB')).toBe('ghp_example');
    expect(clouds.cloudStatus().find((c) => c.id === 'github')).toMatchObject({ label: 'GitHub Models', custom: true, valid: true });
    expect(clouds.readyClouds().map((c) => c.id)).toContain('github');
  });

  it('any other OpenAI-compatible address', async () => {
    routes['GET https://api.example.test/v1/models'] = { status: 200, body: { data: [{ id: 'big-model-70b-instruct' }] } };
    routes['chat api.example.test big-model-70b-instruct'] = OK;
    const r = await clouds.addCloud({ label: 'My Server', baseUrl: 'https://api.example.test/v1/chat/completions', key: 'sk-x' });
    expect(r).toMatchObject({ ok: true, id: 'my-server' });
    expect(settings.customClouds[0]).toMatchObject({ id: 'my-server', baseUrl: 'https://api.example.test/v1' });
  });

  it('refuses addresses that are not https (except this PC) and names that clash with a built-in', async () => {
    expect(await clouds.addCloud({ label: 'x', baseUrl: 'http://example.test/v1', key: 'k' })).toMatchObject({ ok: false });
    expect(await clouds.addCloud({ label: 'Groq', baseUrl: 'https://api.groq.com/openai/v1', key: 'k' })).toMatchObject({ ok: false });
    expect(clouds.validServiceUrl('http://localhost:1234/v1')).toBe(true);
  });

  it('can be removed, key and all - a built-in one cannot', async () => {
    routes['GET https://api.example.test/v1/models'] = { status: 200, body: { data: [{ id: 'm' }] } };
    routes['chat api.example.test m'] = OK;
    await clouds.addCloud({ label: 'Temp', baseUrl: 'https://api.example.test/v1', key: 'sk-x' });
    expect(clouds.removeCloud('temp')).toBe(true);
    expect(keys.has('CUSTOM_TEMP')).toBe(false);
    expect(settings.customClouds).toEqual([]);
    expect(clouds.removeCloud('groq')).toBe(false);
  });
});

describe('the race', () => {
  it('a hanging favourite costs one round, not one wait per model - and stops being the favourite', async () => {
    keys.set('NVIDIA_API_KEY', 'nv');
    routes['GET https://integrate.api.nvidia.com/v1/models'] = { status: 200, body: { data: [{ id: 'meta/llama-3.2-90b-vision-instruct' }, { id: 'nvidia/nemotron-3-super-120b-a12b' }, { id: 'nvidia/nemotron-3-ultra-550b-a55b' }] } };
    health().good.nvidia = 'meta/llama-3.2-90b-vision-instruct';
    routes['chat integrate.api.nvidia.com meta/llama-3.2-90b-vision-instruct'] = 'hang';
    routes['chat integrate.api.nvidia.com nvidia/nemotron-3-super-120b-a12b'] = OK;
    routes['chat integrate.api.nvidia.com nvidia/nemotron-3-ultra-550b-a55b'] = OK;
    const r = await clouds.verifyCloud('nvidia');
    expect(r.ok).toBe(true);
    expect(r.model).not.toBe('meta/llama-3.2-90b-vision-instruct');
    expect(health().good.nvidia).toBe(r.model);
    // All three asked at once, and nothing asked twice.
    expect(asked.filter((a) => a.startsWith('chat'))).toHaveLength(3);
    expect(clouds.chosenModel('nvidia')).not.toBe('meta/llama-3.2-90b-vision-instruct');
  });
});

describe('the free LLM API list (awesome-free-llm-apis)', () => {
  it('a keyless service is added with no key, sends no key, and uses only its free models', async () => {
    const seen: (string | null)[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: { body?: string; headers?: Record<string, string> }) => {
      seen.push(init?.headers?.Authorization ?? null);
      if (url.endsWith('/models')) return new Response(JSON.stringify({ data: [{ id: 'anthropic/claude-opus-5.5', isFree: false }, { id: 'nvidia/nemotron-3-super-120b-a12b:free', isFree: true }, { id: 'kilo-auto/free', isFree: true }] }), { status: 200 });
      const model = (JSON.parse(init!.body!) as { model: string }).model;
      return new Response(JSON.stringify(model.includes('claude') ? { error: { message: 'payment required', code: 402 } } : OK.body), { status: model.includes('claude') ? 402 : 200 });
    }));
    const r = await clouds.addCloud({ preset: 'kilo', key: '' });
    expect(r).toMatchObject({ ok: true, detail: expect.stringMatching(/Kilo Code added - using nvidia\/nemotron-3-super-120b-a12b:free/) });
    expect(seen.every((h) => h === null)).toBe(true);
    expect(keys.size).toBe(0);
    expect(clouds.cloudStatus().find((s) => s.id === 'kilo')).toMatchObject({ configured: true, valid: true });
    expect(clouds.cloudStatus().find((s) => s.id === 'kilo')!.models).not.toContain('anthropic/claude-opus-5.5');
  });

  it('a keyed preset still needs its key; a service with no model list uses its known model', async () => {
    expect(await clouds.addCloud({ preset: 'zai', key: '' })).toMatchObject({ ok: false, error: 'Paste the key.' });
    routes['chat api.z.ai glm-4.7-flash'] = OK;
    const r = await clouds.addCloud({ preset: 'zai', key: 'zai-test-key' });
    expect(r).toMatchObject({ ok: true, detail: expect.stringMatching(/using glm-4\.7-flash/) });
  });

  it('Cloudflare needs the account id in its address', async () => {
    expect(await clouds.addCloud({ preset: 'cloudflare', key: 'cf-token' })).toMatchObject({ ok: false, error: expect.stringMatching(/account ID/) });
    routes['chat api.cloudflare.com @cf/meta/llama-3.3-70b-instruct-fp8-fast'] = OK;
    const r = await clouds.addCloud({ preset: 'cloudflare', key: 'cf-token', accountId: '0123456789abcdef0123456789abcdef' });
    expect(r.ok).toBe(true);
    expect(settings.customClouds.find((c) => c.id === 'cloudflare')?.baseUrl).toBe('https://api.cloudflare.com/client/v4/accounts/0123456789abcdef0123456789abcdef/ai/v1');
  });

  it('knows a free model when a list says so', () => {
    expect(clouds.isFreeModel({ id: 'x', isFree: true })).toBe(true);
    expect(clouds.isFreeModel({ id: 'gpt-oss:20b', tier: 'turbo' })).toBe(true);
    expect(clouds.isFreeModel({ id: 'claude-opus-5-5', tier: 'pro' })).toBe(false);
    expect(clouds.isFreeModel({ id: 'm', pricing: { prompt: '0', completion: '0' } })).toBe(true);
    expect(clouds.isFreeModel({ id: 'm', pricing: { prompt: '0.000001', completion: '0' } })).toBe(false);
  });
});
