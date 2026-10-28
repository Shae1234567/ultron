import type { CheckIn, PainEntry, SleepEntry, TrainingEntry } from './store';

/*
 * Training load and the flags that come from it - pure maths, no model.
 * Load of a session = minutes x effort (1-10), the session-RPE method coaches use.
 * The flags are information, not orders: a big jump in weekly load, hard days stacked
 * back to back, and short sleep before a hard day.
 */

export const TEEN_SLEEP = { min: 8, max: 10 };
const HARD = 7;

const DAY = 86_400_000;
const dayNum = (iso: string) => Math.floor(Date.parse(`${iso}T12:00:00`) / DAY);
const isoOf = (n: number) => new Date(n * DAY).toISOString().slice(0, 10);

export const sessionLoad = (t: Pick<TrainingEntry, 'minutes' | 'effort'>) => t.minutes * t.effort;

/** The 7 days ending on `end` (inclusive), as YYYY-MM-DD, oldest first. */
export function weekDays(end: string): string[] {
  const e = dayNum(end);
  return Array.from({ length: 7 }, (_, i) => isoOf(e - 6 + i));
}

/** Load per 7-day block, newest last: [3 weeks ago, 2 weeks ago, last week, this week]. */
export function weeklyLoads(training: TrainingEntry[], end: string, weeks = 4): number[] {
  const e = dayNum(end);
  const out = Array.from({ length: weeks }, () => 0);
  for (const t of training) {
    const back = e - dayNum(t.date);
    if (back < 0) continue;
    const w = Math.floor(back / 7);
    if (w < weeks) out[weeks - 1 - w] += sessionLoad(t);
  }
  return out;
}

export interface Flag { kind: 'jump' | 'stacked' | 'shortSleep' | 'pain' | 'head'; text: string }

export function flags(training: TrainingEntry[], sleep: SleepEntry[], pain: PainEntry[], today: string): Flag[] {
  const out: Flag[] = [];
  // 1. A big jump: this week against the average of the three before it (acute vs chronic).
  const loads = weeklyLoads(training, today);
  const now = loads[3];
  const before = (loads[0] + loads[1] + loads[2]) / 3;
  if (before > 0 && now / before >= 1.5) {
    out.push({ kind: 'jump', text: `This week's training load is ${Math.round((now / before - 1) * 100)}% above your usual. A jump that size is when injuries happen - keep the next few days lighter.` });
  }
  // 2. Hard days stacked: three or more days in a row with a hard session (effort 7+).
  const hardDays = new Set(training.filter((t) => t.effort >= HARD).map((t) => dayNum(t.date)));
  const week = weekDays(today).map(dayNum);
  let run = 0;
  let worst = 0;
  for (const d of week) { run = hardDays.has(d) ? run + 1 : 0; worst = Math.max(worst, run); }
  if (worst >= 3) out.push({ kind: 'stacked', text: `${worst} hard days in a row this week. Your body gets stronger on the easy days between - put one in.` });
  // 3. Short sleep the night before a hard session.
  const slept = new Map(sleep.map((s) => [s.date, s.hours]));
  for (const t of training.filter((x) => x.effort >= HARD && week.includes(dayNum(x.date)))) {
    const h = slept.get(t.date);
    if (h !== undefined && h < 7) {
      out.push({ kind: 'shortSleep', text: `${h} hours of sleep before a hard ${t.kind === 'other' ? 'session' : t.kind} on ${t.date}. Short sleep before hard days is the most common setup for an injury.` });
      break;
    }
  }
  // 4. Pain: anything logged this week. A head knock always comes first.
  const recentPain = pain.filter((p) => week.includes(dayNum(p.date)));
  if (recentPain.some((p) => p.head)) out.unshift({ kind: 'head', text: 'A head knock is logged this week. Has an adult (a parent or your coach) been told? Head injuries need one to check.' });
  const sore = recentPain.filter((p) => !p.head && p.severity >= 5);
  if (sore.length) out.push({ kind: 'pain', text: `${sore[0].where} pain at ${sore[0].severity}/10 this week. If it is not getting better, tell a parent, your coach or a physio.` });
  return out;
}

export interface HealthNumber {
  /** Nights in the last 7 with 8+ hours. */
  nightsOver8: number;
  nightsLogged: number;
  /** The last 7 nights' hours, oldest first (null = not logged) - the chamber's sleep chart. */
  nights: (number | null)[];
  sessions: number;
  load: number;
}

/** Health's "is it helping?" number. */
export function healthNumber(training: TrainingEntry[], sleep: SleepEntry[], today: string): HealthNumber {
  const days = weekDays(today);
  const byDate = new Map(sleep.map((s) => [s.date, s.hours]));
  const nights = days.map((d) => byDate.get(d) ?? null);
  const inWeek = training.filter((t) => days.includes(t.date));
  return {
    nightsOver8: nights.filter((h) => h !== null && h >= TEEN_SLEEP.min).length,
    nightsLogged: nights.filter((h) => h !== null).length,
    nights,
    sessions: inWeek.length,
    load: inWeek.reduce((n, t) => n + sessionLoad(t), 0),
  };
}

/** A readiness read for today from last night's sleep, energy and soreness - a suggestion, not a rule. */
export function readiness(sleep: SleepEntry | undefined, check: CheckIn | undefined): { level: 'good' | 'easy' | 'rest' | 'unknown'; why: string } {
  if (!sleep && !check) return { level: 'unknown', why: 'nothing logged for last night yet' };
  const h = sleep?.hours;
  const sore = check?.soreness ?? 0;
  const energy = check?.energy ?? 3;
  if ((h !== undefined && h < 6) || sore >= 5 || energy <= 1) return { level: 'rest', why: [h !== undefined && h < 6 ? `${h} h sleep` : '', sore >= 5 ? 'very sore' : '', energy <= 1 ? 'no energy' : ''].filter(Boolean).join(', ') };
  if ((h !== undefined && h < TEEN_SLEEP.min) || sore >= 4 || energy <= 2) return { level: 'easy', why: [h !== undefined && h < TEEN_SLEEP.min ? `${h} h sleep` : '', sore >= 4 ? 'sore' : '', energy <= 2 ? 'low energy' : ''].filter(Boolean).join(', ') };
  return { level: 'good', why: [h !== undefined ? `${h} h sleep` : '', check?.energy ? `energy ${check.energy}/5` : ''].filter(Boolean).join(', ') };
}
