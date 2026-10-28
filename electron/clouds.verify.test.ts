import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Every service has a key; none of them is real. The network below plays the services.
vi.mock('./secrets', () => ({ getSecret: (n: string) => `key-for-${n}`, hasSecret: () => true }));
const settings: { clouds: Record<string, { baseUrl?: string }> } = { clouds: {} };
vi.mock('./store', () => ({ getSettings: () => settings, readDoc: (_n: string, f: unknown) => f, writeDoc: () => {} }));

import { cloudStatus, confirmRefused, refreshCloud, resetClouds, verifyCloud } from './clouds';
import { health } from './cloudHealth';

/* ── A fake network that answers the way the real services did on 9 Oct 2026 ── */

type Answer = { status: number; body?: unknown } | 'hang';
let routes: Record<string, Answer> = {};
let asked: string[] = [];

const BEST = 'alpha-70b-instruct:free';   // ranks first
const NEXT = 'beta-32b-instruct:free';    // ranks second
const OK = { status: 200, body: { choices: [{ message: { role: 'assistant', content: 'hi' } }] } };

beforeEach(() => {
  resetClouds();
  settings.clouds = {};
  asked = [];
  routes = {
    'GET /models': { status: 200, body: { data: [{ id: BEST }, { id: NEXT }] } },
  };
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: { method?: string; body?: string }) => {
    const model = init?.body ? (JSON.parse(init.body) as { model: string }).model : '';
    const key = url.includes('/chat/completions') ? `chat ${model}` : url.endsWith('/models') ? 'GET /models' : `GET ${url}`;
    asked.push(key);
    const a = routes[key] ?? { status: 404, body: { error: { message: 'no such route', code: 404 } } };
    if (a === 'hang') throw Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' });
    return new Response(JSON.stringify(a.body ?? {}), { status: a.status });
  }));
});
afterEach(() => vi.unstubAllGlobals());

const status = (id: string) => cloudStatus().find((c) => c.id === id)!;

describe('a refused key is only ever called refused after a second opinion', () => {
  it('OpenRouter: one model saying 403 is that model, when OpenRouter vouches for the key', async () => {
    routes[`chat ${BEST}`] = { status: 403, body: { error: { message: 'This model is not enabled for your account', code: 403 } } };
    routes['GET https://openrouter.ai/api/v1/key'] = { status: 200, body: { data: { label: 'sk-or-...' } } };
    routes[`chat ${NEXT}`] = OK;
    const r = await verifyCloud('openrouter');
    expect(r.ok).toBe(true);
    expect(r.model).toBe(NEXT);
    expect(status('openrouter').valid).not.toBe(false);
    expect(health().verdict.openrouter.state).toBe('ready');
  });

  it('NVIDIA has no key check, so it asks a second model before deciding', async () => {
    routes[`chat ${BEST}`] = { status: 403, body: { status: 403, title: 'Forbidden' } };
    routes[`chat ${NEXT}`] = OK;
    const r = await verifyCloud('nvidia');
    expect(r).toMatchObject({ ok: true, model: NEXT });
    expect(status('nvidia').valid).toBe(true);
    // ...and never asked a public key endpoint that doesn't exist for NVIDIA.
    expect(asked.some((a) => a.startsWith('GET http'))).toBe(false);
  });

  it('two refusals in a row: the key really is refused, and it says what the service said', async () => {
    routes[`chat ${BEST}`] = { status: 401, body: { error: { message: 'Authentication failed', code: 401 } } };
    routes[`chat ${NEXT}`] = { status: 401, body: { error: { message: 'Authentication failed', code: 401 } } };
    const r = await verifyCloud('nvidia');
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/refused the key: "Authentication failed"/);
    expect(status('nvidia').valid).toBe(false);
    expect(health().verdict.nvidia).toMatchObject({ state: 'refused', reason: 'Authentication failed' });
  });

  it("OpenRouter's own key check saying no is final", async () => {
    routes[`chat ${BEST}`] = { status: 401, body: { error: { message: 'User not found.', code: 401 } } };
    routes['GET https://openrouter.ai/api/v1/key'] = { status: 401, body: { error: { message: 'User not found.', code: 401 } } };
    const r = await verifyCloud('openrouter');
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/User not found/);
  });

  it('pointed at a custom address, it never asks the public key check about the wrong server', async () => {
    settings.clouds.openrouter = { baseUrl: 'http://127.0.0.1:9/v1' };
    routes[`chat ${BEST}`] = { status: 403, body: { error: { message: 'nope', code: 403 } } };
    routes[`chat ${NEXT}`] = OK;
    await refreshCloud('openrouter', true);
    const c = await confirmRefused('openrouter', BEST, 'nope');
    expect(c.refused).toBe(false);
    expect(asked).not.toContain('GET https://openrouter.ai/api/v1/key');
  });
});

describe('DeepSeek, the paid brain (added 9 Oct 2026)', () => {
  it('starts on its cheaper Flash model, not the biggest one it lists', async () => {
    routes['GET /models'] = { status: 200, body: { data: [{ id: 'deepseek-v4-pro' }, { id: 'deepseek-flash' }] } };
    await refreshCloud('deepseek', true);
    expect(status('deepseek').model).toBe('deepseek-flash');
  });

  it('asks DeepSeek about the key itself (its balance page) before calling it refused', async () => {
    routes['GET /models'] = { status: 200, body: { data: [{ id: 'deepseek-flash' }, { id: 'deepseek-v4-pro' }] } };
    routes['chat deepseek-flash'] = { status: 401, body: { error: { message: 'Authentication Fails', code: 401 } } };
    routes['GET https://api.deepseek.com/user/balance'] = { status: 200, body: { is_available: true } };
    routes['chat deepseek-v4-pro'] = OK;
    await refreshCloud('deepseek', true);
    expect(await confirmRefused('deepseek', 'deepseek-flash', 'Authentication Fails')).toMatchObject({ refused: false });
    expect(asked).toContain('GET https://api.deepseek.com/user/balance');
  });
});

describe('a model problem is never mistaken for a key problem', () => {
  it('a 200 with an error inside is not a success, and is not remembered as the good model', async () => {
    // OpenRouter and NVIDIA both did this today: "Service temporarily overloaded", with status 200.
    routes[`chat ${BEST}`] = { status: 200, body: { error: { message: 'Upstream error from Nvidia: Service temporarily overloaded', code: 503 } } };
    routes[`chat ${NEXT}`] = OK;
    const r = await verifyCloud('openrouter');
    expect(r).toMatchObject({ ok: true, model: NEXT });
    expect(health().good.openrouter).toBe(NEXT);
  });

  it('a model that hangs is skipped, not blamed on the key', async () => {
    // NVIDIA's remembered model did exactly this: no answer at all.
    routes[`chat ${BEST}`] = 'hang';
    routes[`chat ${NEXT}`] = OK;
    const r = await verifyCloud('nvidia');
    expect(r).toMatchObject({ ok: true, model: NEXT });
  });

  it('a hung model stops being the first pick', async () => {
    health().good.nvidia = BEST;
    routes[`chat ${BEST}`] = 'hang';
    routes[`chat ${NEXT}`] = OK;
    await verifyCloud('nvidia');
    expect(health().good.nvidia).toBe(NEXT);
  });

  it('a free model that is rate-limited hands over to the next one on the same service', async () => {
    routes[`chat ${BEST}`] = { status: 429, body: { error: { message: 'Provider returned error: temporarily rate-limited upstream', code: 429 } } };
    routes[`chat ${NEXT}`] = OK;
    expect(await verifyCloud('openrouter')).toMatchObject({ ok: true, model: NEXT });
  });

  it('a retired model (404/410) is dropped for good and the next one used', async () => {
    routes[`chat ${BEST}`] = { status: 410, body: { title: 'Gone', detail: 'reached its end of life' } };
    routes[`chat ${NEXT}`] = OK;
    expect(await verifyCloud('nvidia')).toMatchObject({ ok: true, model: NEXT });
    expect(health().dead).toContain(`nvidia:${BEST}`);
  });

  it('when nothing answers, it says so honestly - without a word about the key being bad', async () => {
    routes[`chat ${BEST}`] = 'hang';
    routes[`chat ${NEXT}`] = { status: 503, body: { error: { message: 'Service temporarily overloaded', code: 503 } } };
    const r = await verifyCloud('nvidia');
    expect(r.ok).toBe(false);
    expect(r.error).not.toMatch(/refus|reject/i);
    expect(r.error).toMatch(/Nothing points at the key/);
    expect(status('nvidia').valid).not.toBe(false);
  });

  it('when every model is just busy, the key still counts as working', async () => {
    routes[`chat ${BEST}`] = { status: 429, body: { error: { message: 'rate-limited upstream', code: 429 } } };
    routes[`chat ${NEXT}`] = { status: 429, body: { error: { message: 'rate-limited upstream', code: 429 } } };
    const r = await verifyCloud('openrouter');
    expect(r.ok).toBe(true);
    expect(status('openrouter').valid).toBe(true);
  });
});
