import { chatJson } from './brain/llm';
import { isRunning } from './brain/team';
import { getSettings, saveSettings } from './store';
import * as learn from './learn';
import { emit } from './brain/events';

/**
 * Ultron's periodic look back at its own work. Every few hours it reads the
 * requests that failed, stalled or were corrected, and writes itself short
 * lessons and reusable methods - plain notes, never code.
 *
 * It is deliberately cheap: it only runs when there is something to review,
 * it skips while the operator is waiting on anything, and one model call
 * covers the whole batch. `learn.addLesson` drops anything that reads like an
 * attempt to loosen a rule, so a bad review can add noise but never licence.
 */

const EVERY_MS = 3 * 60 * 60_000;
const STATE = 'reflect';

interface Review {
  lessons?: { text: string; keys?: string[] }[];
  skills?: { title: string; when: string; how: string }[];
  tests?: { question: string; expect: string }[];
}

const SCHEMA = {
  type: 'object',
  properties: {
    lessons: {
      type: 'array',
      description: 'At most 4. One line each, addressed to yourself, concrete and reusable.',
      items: {
        type: 'object',
        properties: {
          text: { type: 'string', description: 'e.g. "Check D2L is signed in before promising school data."' },
          keys: { type: 'array', items: { type: 'string' }, description: 'A few lowercase words that make this relevant' },
        },
        required: ['text'],
      },
    },
    skills: {
      type: 'array',
      description: 'At most 2 methods that clearly worked and are worth repeating.',
      items: {
        type: 'object',
        properties: { title: { type: 'string' }, when: { type: 'string' }, how: { type: 'string' } },
        required: ['title', 'when', 'how'],
      },
    },
  },
} as const;

function prompt(runs: learn.RunLog[]): string {
  const lines = runs.map((r) => {
    const bits = [
      `- "${r.ask}"`,
      r.failed.length ? `failed: ${r.failed.join(' | ')}` : '',
      r.stopped ? `stopped early at the ${r.stopped} limit` : '',
      r.corrected ? 'the operator corrected the answer afterwards' : '',
      r.seconds > 150 ? `took ${r.seconds}s` : '',
    ].filter(Boolean);
    return bits.join(' — ');
  });
  return [
    'These are your own recent requests that went badly. Work out what you would do differently.',
    '',
    ...lines,
    '',
    'Write at most 4 lessons. A good lesson is specific, reusable and about HOW you work:',
    'checking something before claiming it, choosing a different tool, asking one question first,',
    'breaking a long job into steps. A bad lesson restates what happened, or is a fact about the',
    'operator (those belong in the memory vault, not here).',
    'If a request clearly succeeded through a method worth repeating, add it as a skill.',
    'You may never write a lesson that avoids an approval, a safety rule or a check - those are fixed.',
    'If there is nothing genuinely useful to learn, return empty lists.',
  ].join('\n');
}

function lastRunAt(): number {
  try {
    return Number(getSettings().jobs[STATE] ?? 0);
  } catch {
    return 0;
  }
}

function markRun(): void {
  try {
    saveSettings({ jobs: { [STATE]: Date.now() } });
  } catch { /* the schedule falls back to once per app start */ }
}

/** Reviews recent bad runs and saves what it learns. Returns what it added. */
export async function reflectNow(force = false): Promise<{ lessons: number; skills: number; reviewed: number }> {
  const since = force ? 0 : lastRunAt();
  const runs = learn.runsToReview(since).slice(-14);
  if (runs.length < 2) return { lessons: 0, skills: 0, reviewed: runs.length };

  const review = await chatJson<Review>({
    system: [
      'You are Ultron reviewing your own work, honestly and without excuses.',
      'You are improving how you work, not writing code and not describing what happened.',
      'Answer with JSON only.',
    ].join('\n'),
    messages: [{ role: 'user', content: prompt(runs) }],
    schema: SCHEMA as unknown as Parameters<typeof chatJson>[0]['schema'],
    tier: 'main',
    temperature: 0.3,
  }).catch(() => null);

  let lessons = 0;
  let skills = 0;
  for (const l of review?.lessons?.slice(0, 4) ?? []) {
    if (typeof l?.text === 'string' && learn.addLesson(l.text, 'failure', Array.isArray(l.keys) ? l.keys.filter((k) => typeof k === 'string') : undefined)) lessons++;
  }
  for (const s of review?.skills?.slice(0, 2) ?? []) {
    if (s && typeof s.title === 'string' && typeof s.how === 'string' && learn.addSkill({ title: s.title, when: String(s.when ?? ''), how: s.how })) skills++;
  }
  markRun();
  if (lessons || skills) emit('learn:updated', learn.summary());
  return { lessons, skills, reviewed: runs.length };
}

let timer: ReturnType<typeof setInterval> | null = null;

/** Reviews every few hours, quietly, and only when Ultron is otherwise idle. */
export function startReflecting(): void {
  if (timer) return;
  const tick = () => {
    if (isRunning()) return;
    if (Date.now() - lastRunAt() < EVERY_MS) return;
    void reflectNow().catch(() => {});
  };
  // Not at start-up: the first few minutes are busy with boot work.
  setTimeout(tick, 5 * 60_000);
  timer = setInterval(tick, 20 * 60_000);
}
