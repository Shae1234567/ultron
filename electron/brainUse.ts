import { readDoc, writeDoc } from './store';

/*
 * Which brain actually answered, and how often today - so Settings can show what Ultron is
 * really using, not just which keys are saved. One count per brain (each free service, Gemini,
 * the local model), reset each day, plus when and with which model it last answered. Local.
 */

const DOC = 'brain-usage.json';
export interface Usage { date: string; count: Record<string, number>; last: Record<string, { at: number; model: string }> }

const today = (t = Date.now()) => new Date(t).toDateString();
let mem: Usage | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;

export function usage(now = Date.now()): Usage {
  if (!mem) {
    const d = readDoc<Partial<Usage>>(DOC, {});
    mem = { date: typeof d.date === 'string' ? d.date : today(now), count: d.count && typeof d.count === 'object' ? d.count : {}, last: d.last && typeof d.last === 'object' ? d.last : {} };
  }
  // A new day: counts start again; "last answered" is kept.
  if (mem.date !== today(now)) mem = { date: today(now), count: {}, last: mem.last };
  return mem;
}

/** One answer from a brain: "groq", "kilo", "gemini", "ollama"... */
export function noteAnswer(id: string, model: string, now = Date.now()): void {
  const u = usage(now);
  u.count[id] = (u.count[id] ?? 0) + 1;
  u.last[id] = { at: now, model };
  if (!timer) timer = setTimeout(() => { timer = null; if (mem) writeDoc(DOC, mem); }, 5000);
}

/** On quit: write the last few seconds' answers now rather than lose them. */
export function flushUsage(): void {
  if (timer) clearTimeout(timer);
  timer = null;
  if (mem) writeDoc(DOC, mem);
}

/** For tests. */
export function resetUsage(): void {
  if (timer) clearTimeout(timer);
  timer = null;
  mem = null;
}
