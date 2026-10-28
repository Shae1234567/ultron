import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LlmError } from './types';

/* On the local brain, maths and hard reasoning go to DeepSeek-R1; everything else stays on the main model. */

const settings = {
  brain: 'ollama', thinking: 'deep', gemini: { model: '' }, clouds: {}, privacy: { trusted: [] },
  ollama: { host: 'http://127.0.0.1:11434', model: 'qwen3.5:4b', numCtx: 8192, reasoningModel: 'deepseek-r1:8b' },
};
vi.mock('../store', () => ({ getSettings: () => settings, saveSettings: () => {}, readDoc: (_n: string, f: unknown) => f, writeDoc: () => {} }));
vi.mock('../secrets', () => ({ getSecret: () => '', hasSecret: () => false }));
vi.mock('../ollama', () => ({ status: async () => ({ running: true, modelInstalled: true, models: ['qwen3.5:4b', 'deepseek-r1:8b'] }) }));
vi.mock('./providers/gemini', () => ({ listGeminiModels: async () => null, geminiChat: async () => { throw new Error('no Gemini'); } }));
vi.mock('./providers/openaiCompat', () => ({ openaiChat: async () => { throw new Error('no clouds'); } }));
const used: string[] = [];
const keep: (string | undefined)[] = [];
let missing = '';
vi.mock('./providers/ollama', () => ({
  ollamaChat: async (t: { model: string; keepAlive?: string }) => {
    used.push(t.model);
    keep.push(t.keepAlive);
    if (t.model === missing) throw new LlmError(`Ollama model "${t.model}" is not installed. Run: ollama pull ${t.model}`, 'model');
    return { text: `answered by ${t.model}`, toolCalls: [], provider: 'ollama', model: t.model };
  },
}));

const { chat } = await import('./llm');
const ask = (reason: boolean) => chat({ system: '', messages: [{ role: 'user', content: 'x' }], reason });

beforeEach(() => { used.length = 0; keep.length = 0; missing = ''; settings.ollama.reasoningModel = 'deepseek-r1:8b'; });

describe('the reasoning model on the local brain', () => {
  it('takes maths and hard reasoning - and lets go of the GPU a minute later (it shares 6 GB with his games)', async () => {
    expect((await ask(true)).text).toBe('answered by deepseek-r1:8b');
    expect(keep).toEqual(['1m']);
  });

  it('leaves everything else on the main local model', async () => {
    expect((await ask(false)).text).toBe('answered by qwen3.5:4b');
  });

  it("falls back to the main model when it isn't downloaded", async () => {
    missing = 'deepseek-r1:8b';
    expect((await ask(true)).text).toBe('answered by qwen3.5:4b');
    expect(used).toEqual(['deepseek-r1:8b', 'qwen3.5:4b']);
  });

  it('can be switched off', async () => {
    settings.ollama.reasoningModel = '';
    expect((await ask(true)).text).toBe('answered by qwen3.5:4b');
  });
});
