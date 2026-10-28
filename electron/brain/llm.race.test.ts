import { afterEach, describe, expect, it, vi } from 'vitest';
import { LlmError, type ChatRequest } from './types';

/*
 * 12 Oct 2026: racing a slow free service. His real runs spent 30-150 s "thinking" while a service
 * sat on a call; now a second service starts after a few seconds and the first to answer wins.
 */

vi.mock('../store', () => ({
  getSettings: () => ({ brain: 'cloud', thinking: 'deep', gemini: { model: '' }, clouds: {}, ollama: { host: 'http://127.0.0.1:11434', model: 'x', numCtx: 8192 } }),
  saveSettings: () => {},
  readDoc: (_n: string, f: unknown) => f,
  writeDoc: () => {},
}));
vi.mock('../secrets', () => ({ getSecret: () => 'k', hasSecret: () => true }));
vi.mock('../ollama', () => ({ status: async () => ({ running: false, modelInstalled: false }) }));
vi.mock('./providers/ollama', () => ({ ollamaChat: async () => { throw new Error('not here'); } }));
vi.mock('./providers/gemini', () => ({ listGeminiModels: async () => null, geminiChat: async () => { throw new Error('not here'); } }));
vi.mock('../clouds', () => ({
  baseUrlOf: (id: string) => `https://${id}.example/v1`,
  keyOf: () => 'k',
  rememberGood: vi.fn(),
  readyClouds: () => [],
  chosenModel: () => null,
  cloudStatus: () => [],
}));
vi.mock('../brainUse', () => ({ noteAnswer: vi.fn(), usage: () => ({ count: {}, last: {} }) }));

/** How each fake service behaves: ms until its first word (null = never), then its words, or a failure. */
const plan = new Map<string, { aliveAfter: number | null; words?: string[]; failAfter?: number; fail?: LlmError }>();
const aborted = new Set<string>();
vi.mock('./providers/openaiCompat', () => ({
  openaiChat: (t: { baseUrl: string; model: string }, req: ChatRequest) => new Promise((resolve, reject) => {
    const id = /https:\/\/(\w+)\./.exec(t.baseUrl)![1];
    const p = plan.get(id)!;
    const timers: ReturnType<typeof setTimeout>[] = [];
    req.signal?.addEventListener('abort', () => { aborted.add(id); timers.forEach(clearTimeout); reject(new LlmError('The AI service stopped responding.', 'network')); });
    if (p.fail) { timers.push(setTimeout(() => reject(p.fail), p.failAfter ?? 0)); return; }
    if (p.aliveAfter === null) return; // sits on the call forever
    timers.push(setTimeout(() => {
      req.onAlive?.();
      for (const w of p.words ?? []) req.onToken?.(w);
      resolve({ text: (p.words ?? []).join(''), toolCalls: [], provider: 'cloud', model: t.model });
    }, p.aliveAfter));
  }),
}));

const { raceClouds } = await import('./llm');

const svc = (id: string) => ({ id, label: id.toUpperCase(), model: `${id}-70b` });
const run = (first: string, rest: string[], hedgeMs = 40) => {
  const queue = [...rest];
  const tokens: string[] = [];
  const failed: string[] = [];
  const slow: string[] = [];
  const started: string[] = [first];
  const p = raceClouds(svc(first), () => { const n = queue.shift(); if (n) started.push(n); return n ? svc(n) : null; },
    { system: '', messages: [], onToken: (t) => tokens.push(t) }, async (who) => { failed.push(who.id); }, hedgeMs, (who) => slow.push(who.id));
  return { p, tokens, failed, started, slow };
};

afterEach(() => { plan.clear(); aborted.clear(); });

describe('raceClouds', () => {
  it('a service that answers quickly is never raced', async () => {
    plan.set('groq', { aliveAfter: 5, words: ['Hi', ' Shae'] });
    plan.set('kilo', { aliveAfter: 5, words: ['nope'] });
    const r = run('groq', ['kilo']);
    expect((await r.p).text).toBe('Hi Shae');
    expect(r.started).toEqual(['groq']);
    expect(r.tokens.join('')).toBe('Hi Shae');
  });

  it('a stalled service is beaten by the next one, which alone reaches the screen', async () => {
    plan.set('slow', { aliveAfter: null });
    plan.set('fast', { aliveAfter: 10, words: ['Answer'] });
    const r = run('slow', ['fast']);
    const out = await r.p;
    expect(out.text).toBe('Answer');
    expect(r.started).toEqual(['slow', 'fast']);
    expect(r.tokens).toEqual(['Answer']);
    // The slow one is cancelled - not marked broken, just sat out for a while so the next message skips the wait.
    expect(aborted.has('slow')).toBe(true);
    expect(r.failed).toEqual([]);
    expect(r.slow).toEqual(['slow']);
  });

  it('if the first wakes up first after all, it wins and the second is cancelled', async () => {
    plan.set('first', { aliveAfter: 60, words: ['First'] });
    plan.set('second', { aliveAfter: 500, words: ['Second'] });
    const r = run('first', ['second']);
    expect((await r.p).text).toBe('First');
    expect(aborted.has('second')).toBe(true);
    expect(r.tokens).toEqual(['First']);
    // The second was only just started - it is not to blame for anything.
    expect(r.slow).toEqual([]);
  });

  it('a quick failure is reported, so the rotation can move on', async () => {
    plan.set('bad', { aliveAfter: null, fail: new LlmError('Rate limited: slow down', 'rate', 3000), failAfter: 5 });
    const r = run('bad', []);
    await expect(r.p).rejects.toMatchObject({ kind: 'rate' });
    expect(r.failed).toEqual(['bad']);
  });

  it('if the racer fails, the first is still waited for', async () => {
    plan.set('steady', { aliveAfter: 120, words: ['Steady answer'] });
    plan.set('flaky', { aliveAfter: null, fail: new LlmError('overloaded (503)', 'network'), failAfter: 10 });
    const r = run('steady', ['flaky']);
    expect((await r.p).text).toBe('Steady answer');
    expect(r.failed).toEqual(['flaky']);
  });

  it('cancelling the request cancels every racer', async () => {
    plan.set('a', { aliveAfter: null });
    plan.set('b', { aliveAfter: null });
    const ctrl = new AbortController();
    const queue = ['b'];
    const p = raceClouds(svc('a'), () => { const n = queue.shift(); return n ? svc(n) : null; }, { system: '', messages: [], signal: ctrl.signal }, async () => {}, 20);
    setTimeout(() => ctrl.abort(), 60);
    await expect(p).rejects.toMatchObject({ kind: 'aborted' });
    expect(aborted).toEqual(new Set(['a', 'b']));
  });
});
