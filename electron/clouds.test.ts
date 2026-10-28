import { describe, expect, it, vi } from 'vitest';

vi.mock('./secrets', () => ({ getSecret: () => '', hasSecret: () => false }));
vi.mock('./store', () => ({ getSettings: () => ({ clouds: {} }), readDoc: (_n: string, f: unknown) => f, writeDoc: () => {} }));

import { CLOUDS, bestModels, classifyFailure, cloudDef, rankModel } from './clouds';

describe('choosing a model from a service\'s own list', () => {
  it('ignores anything that is not a chat model', () => {
    for (const n of ['text-embedding-3-large', 'whisper-large-v3', 'tts-1', 'llama-guard-4-12b', 'dall-e-3', 'bge-reranker']) {
      expect(rankModel(n), n).toBeLessThan(0);
    }
    expect(bestModels(['text-embedding-3-large', 'whisper-large-v3'])).toEqual([]);
  });

  it('picks a capable model, not a tiny one, from a real Groq-style list', () => {
    const list = ['llama-3.1-8b-instant', 'llama-3.3-70b-versatile', 'whisper-large-v3', 'qwen3-32b', 'llama-guard-4-12b'];
    const best = bestModels(list);
    // Which of the two big ones wins is a toss-up; what matters is that a big one leads
    // and the small and non-chat ones do not.
    expect(['llama-3.3-70b-versatile', 'qwen3-32b']).toContain(best[0]);
    expect(best).not.toContain('whisper-large-v3');
    expect(best).not.toContain('llama-guard-4-12b');
    // The small model is still there, last, as a fallback when the big ones are out of quota.
    expect(best[best.length - 1]).toBe('llama-3.1-8b-instant');
  });

  it('prefers a big instruct model over a small one', () => {
    expect(rankModel('llama-3.3-70b-instruct')).toBeGreaterThan(rankModel('llama-3.2-3b-instruct'));
    expect(rankModel('gpt-5')).toBeGreaterThan(rankModel('gpt-5-nano'));
    // A big model from an older family beats a tiny one from a newer family.
    expect(rankModel('llama-3.3-70b-versatile')).toBeGreaterThan(rankModel('gpt-5-nano'));
  });

  it('prefers OpenRouter\'s free models, because those are the ones a free key can run', () => {
    expect(rankModel('deepseek/deepseek-r1:free')).toBeGreaterThan(rankModel('deepseek/deepseek-r1'));
  });

  it('still ranks a model it has never heard of, by size and build', () => {
    expect(rankModel('newthing-120b-instruct')).toBeGreaterThan(rankModel('newthing-7b'));
    expect(rankModel('newthing-120b-instruct')).toBeGreaterThan(0);
  });

  it('prefers a newer version of the same family, without being told about it', () => {
    // The point: a model released after this code was written still sorts above its predecessor.
    expect(rankModel('deepseek-ai/DeepSeek-V4.1')).toBeGreaterThan(rankModel('deepseek-ai/DeepSeek-V3'));
    expect(rankModel('zai-org/GLM-5.3')).toBeGreaterThan(rankModel('zai-org/GLM-4'));
  });

  it('picks sensibly from the real lists these services return', () => {
    // Taken from live /models responses on 5 Oct 2026.
    const sambanova = ['DeepSeek-V3.1', 'DeepSeek-V3.2', 'Meta-Llama-3.3-70B-Instruct', 'MiniMax-M3', 'gemma-4-31B-it'];
    expect(bestModels(sambanova)[0]).toBe('Meta-Llama-3.3-70B-Instruct');
    const hf = ['Qwen/Qwen3.8-27B', 'deepseek-ai/DeepSeek-V4.1-Flash', 'zai-org/GLM-5.3', 'meta-llama/Llama-3.1-8B-Instruct'];
    // The tiny 8B one must not lead.
    expect(bestModels(hf)[0]).not.toBe('meta-llama/Llama-3.1-8B-Instruct');
    const nvidia = ['adept/fuyu-8b', 'meta/llama-3.3-70b-instruct', 'deepseek-ai/deepseek-r1', 'bigcode/starcoder2-15b'];
    expect(['meta/llama-3.3-70b-instruct', 'deepseek-ai/deepseek-r1']).toContain(bestModels(nvidia)[0]);
  });

  it('keeps the list short and in order', () => {
    const many = Array.from({ length: 30 }, (_, i) => `model-${i}b-instruct`);
    const best = bestModels(many, 4);
    expect(best).toHaveLength(4);
    expect(rankModel(best[0])).toBeGreaterThanOrEqual(rankModel(best[3]));
  });
});

describe('the service catalog', () => {
  it('has a key name, address and sign-up page for each', () => {
    for (const c of CLOUDS) {
      expect(c.baseUrl, c.id).toMatch(/^https:\/\//);
      expect(c.signup, c.id).toMatch(/^https:\/\//);
      expect(c.secret, c.id).toMatch(/_(KEY|TOKEN)$/);
      expect(c.free.length, c.id).toBeGreaterThan(10);
    }
  });

  it('has no duplicate ids or keys', () => {
    expect(new Set(CLOUDS.map((c) => c.id)).size).toBe(CLOUDS.length);
    expect(new Set(CLOUDS.map((c) => c.secret)).size).toBe(CLOUDS.length);
  });

  it('finds a service by id', () => {
    expect(cloudDef('groq')?.label).toBe('Groq');
    expect(cloudDef('nvidia')?.label).toBe('NVIDIA');
    expect(cloudDef('nope')).toBeUndefined();
  });
});


describe('what a failing service is actually telling us', () => {
  // The bug this exists for: every one of these used to end up as "KEY REFUSED", so a
  // panel full of working keys read as broken and sent Shae hunting for new ones.
  it('calls it refused only when the service rejects the key itself', () => {
    expect(classifyFailure(401, 'Incorrect API key provided')).toBe('refused');
    expect(classifyFailure(403, 'forbidden')).toBe('refused');
  });

  it('knows spent free credits from a bad key', () => {
    // Hugging Face, word for word.
    expect(classifyFailure(402, '{"error":"You have no remaining credits. Purchase pre-paid credits to continue"}')).toBe('noCredits');
    // OpenAI-style: arrives as a 429, means the allowance is gone, not that the key is bad.
    expect(classifyFailure(429, 'You exceeded your current quota (insufficient_quota)')).toBe('noCredits');
  });

  it('keeps a plain rate limit separate from spent credits', () => {
    // Resting a whole service for a per-minute limit would throw away a good brain all day.
    expect(classifyFailure(429, 'Rate limit reached for requests per minute')).toBe('rateLimited');
  });

  it('treats a withdrawn model as a model problem, not a key problem', () => {
    // NVIDIA lists models it will not serve; both of these mean "try the next model".
    expect(classifyFailure(404, "Function 'b0fcd392': Not found for account")).toBe('deadModel');
    expect(classifyFailure(410, 'gone')).toBe('deadModel');
  });

  it('calls anything else a blip, so a good key is never branded bad by a bad moment', () => {
    for (const code of [500, 502, 503, 504, 0, 400]) expect(classifyFailure(code, 'oops')).toBe('hiccup');
  });

  it('does not let the word billing in a rejection message hide that the key was refused', () => {
    expect(classifyFailure(401, 'key invalid - check your billing page')).toBe('refused');
  });
});

describe('quick to answer (12 Oct 2026)', () => {
  it('knows which models think at length before their first word', async () => {
    const { isSlowThinker } = await import('./clouds');
    for (const n of ['deepseek/deepseek-r1:free', 'qwen/qwq-32b:free', 'qwen3-235b-a22b-thinking-2507', 'mistral/magistral-medium', 'deepseek-r1-distill-llama-70b']) expect(isSlowThinker(n), n).toBe(true);
    for (const n of ['llama-3.3-70b-versatile', 'deepseek/deepseek-chat-v3:free', 'gemma-3-27b-it', 'kimi-k2-instruct', 'openai/gpt-oss-120b']) expect(isSlowThinker(n), n).toBe(false);
  });
  it('puts a quick big model ahead of a slow-thinking one for everyday answers', () => {
    expect(bestModels(['deepseek/deepseek-r1:free', 'meta-llama/llama-3.3-70b-instruct:free'])[0]).toBe('meta-llama/llama-3.3-70b-instruct:free');
    expect(bestModels(['deepseek-r1-distill-llama-70b', 'llama-3.3-70b-versatile'])[0]).toBe('llama-3.3-70b-versatile');
  });
});
