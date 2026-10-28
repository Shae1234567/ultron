import { once } from './brain/team';
import * as learn from './learn';
import { emit } from './brain/events';

/**
 * Ultron's own scoreboard.
 *
 * Questions it already answered correctly - with the answer worked out by the
 * code sandbox, so the right answer is known for certain - become a small set
 * of tests. Re-running them shows whether a change (a different model, a
 * different service, a new workflow) actually helped or quietly made things
 * worse.
 *
 * Deliberately measures the BRAIN ON ITS OWN: each question is re-asked with
 * no tools and no team. That is the honest way to compare one model against
 * another, and it is what the score is labelled as in the HUD. It is not a
 * measure of the whole team's ability.
 */

const SYSTEM = [
  'Answer the question as briefly as possible - the final answer only, no working, no units unless they are the answer.',
  'If you are not certain, give your best single answer anyway.',
].join('\n');

/** Loose match: the expected answer has to appear, ignoring case, spaces, commas and trailing zeros. */
export function matches(expected: string, answer: string): boolean {
  const norm = (s: string) => s.toLowerCase().replace(/[,\s]/g, '').replace(/\.0+\b/g, '');
  const want = norm(expected);
  const got = norm(answer);
  if (!want) return false;
  // A number has to stand on its own: a plain substring check would pass "7" against
  // "1700" and score a wrong answer as right, which would make the whole board useless.
  if (/^-?\d+(\.\d+)?$/.test(want)) {
    return new RegExp(`(^|[^\\d.])${want.replace('.', '\\.')}([^\\d]|$)`).test(got);
  }
  return got.includes(want);
}

export interface TestRun {
  total: number;
  passed: number;
  results: { question: string; expect: string; answer: string; ok: boolean }[];
  skipped?: string;
}

/** Re-asks the saved questions and records the score. */
export async function runSelfTest(max = 12): Promise<TestRun> {
  const tests = learn.load().tests.slice(-max);
  if (tests.length < 3) {
    return { total: tests.length, passed: 0, results: [], skipped: 'Not enough saved questions yet - Ultron saves one whenever it works an answer out with code.' };
  }
  const results: TestRun['results'] = [];
  for (const t of tests) {
    const answer = await once({ system: SYSTEM, user: t.question, tier: 'main', temperature: 0 }).catch(() => '');
    results.push({ question: t.question, expect: t.expect, answer: answer.slice(0, 200), ok: matches(t.expect, answer) });
  }
  const passed = results.filter((r) => r.ok).length;
  learn.recordScore(passed, results.length);
  emit('learn:updated', learn.summary());
  return { total: results.length, passed, results };
}

/**
 * Worth keeping as a test? Only a short, definite answer that was computed
 * rather than recalled - a date, a number, a name. Anything long or vague
 * cannot be marked automatically, so it is not saved.
 */
export function worthSaving(question: string, value: string): boolean {
  const q = question.trim();
  const v = value.trim();
  if (q.length < 12 || q.length > 240 || v.length < 1 || v.length > 40) return false;
  // Something that changes with the day would fail tomorrow for the wrong reason.
  if (/\b(today|tomorrow|yesterday|right now|currently|this (week|month|year)|next (week|month)|weather)\b/i.test(q)) return false;
  return true;
}
