import { beforeEach, describe, expect, it, vi } from 'vitest';

const saved: Record<string, unknown> = {};
vi.mock('./store', () => ({
  readDoc: (n: string, f: unknown) => saved[n] ?? f,
  writeDoc: (n: string, v: unknown) => { saved[n] = JSON.parse(JSON.stringify(v)); },
}));

const { noteAnswer, usage, resetUsage } = await import('./brainUse');

const morning = Date.parse('2026-10-10T08:00:00');
const evening = Date.parse('2026-10-10T21:30:00');
const nextDay = Date.parse('2026-10-11T09:00:00');

describe('brain usage counter', () => {
  beforeEach(() => {
    for (const k of Object.keys(saved)) delete saved[k];
    resetUsage();
  });

  it('counts answers per brain and remembers the last one', () => {
    noteAnswer('groq', 'llama-3.3-70b', morning);
    noteAnswer('groq', 'llama-3.3-70b', evening);
    noteAnswer('ollama', 'qwen3:4b', morning);
    const u = usage(evening);
    expect(u.count).toEqual({ groq: 2, ollama: 1 });
    expect(u.last.groq).toEqual({ at: evening, model: 'llama-3.3-70b' });
  });

  it('starts the counts again each day but keeps when each brain last answered', () => {
    noteAnswer('kilo', 'some-free-model', evening);
    const u = usage(nextDay);
    expect(u.count).toEqual({});
    expect(u.last.kilo?.at).toBe(evening);
  });

  it('survives a restart through the saved file', async () => {
    vi.useFakeTimers();
    noteAnswer('gemini', 'gemini-2.5-flash', morning);
    vi.advanceTimersByTime(6000);
    vi.useRealTimers();
    resetUsage();
    expect(usage(evening).count.gemini).toBe(1);
  });
});
