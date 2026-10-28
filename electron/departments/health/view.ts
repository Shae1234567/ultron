import { flags, healthNumber, readiness, sessionLoad, TEEN_SLEEP, weeklyLoads, type Flag, type HealthNumber } from './load';
import { ASK_FOR, FUEL_TIPS, LABELS, shortfalls, TARGETS, targetsFor, totals, WATER_TARGET_ML } from './foods';
import { GROW_FOOD, HONEST, PHASES, PROGRAM, programStatus, type ProgramStatus } from './program';
import {
  isoDay, load, type CheckIn, type DayType, type FoodEntry, type GymSet, type HealthDoc, type Meal, type PainEntry,
  type ScheduleItem, type SleepEntry, type TrainingEntry, type UsualMeal, type WaterEntry,
} from './store';
import { lastNight, load as loadSpans, on as pcTrackerOn } from './pcActivity';
import { settings as nudgeSettings, tonightPlan, usualWake, type NudgeSettings, type TonightPlan } from './nudge';

/*
 * Everything the Health app shows for one day, worked out here from the log so the screen
 * only draws: readiness, the flags, sleep (with the PC's guess for last night), training
 * load, food against the targets, water, pain by body part, the logging streak, and the
 * last time each gym exercise was done. Pure apart from reading the log.
 */

const DAY = 86_400_000;
const shift = (iso: string, n: number) => isoDay(new Date(Date.parse(`${iso}T12:00:00`) + n * DAY));
const daysEnding = (end: string, n: number) => Array.from({ length: n }, (_, i) => shift(end, i - n + 1));
const round1 = (n: number) => Math.round(n * 10) / 10;

export interface NightPoint { date: string; hours: number | null; bed?: string; wake?: string; quality?: number }
export interface LoadPoint { date: string; load: number; minutes: number; hard: boolean; kinds: string[] }
export interface PainArea { key: string; where: string; side?: string; latest: PainEntry; history: { date: string; severity: number }[]; active: boolean }

export interface HealthView {
  today: string;
  date: string;
  empty: boolean;
  number: HealthNumber;
  flags: Flag[];
  readiness: ReturnType<typeof readiness>;
  checkin?: CheckIn;
  dayType: { type: DayType; inferred: boolean };
  fuelTips: string[];
  /** His 12-month gym program (null when switched off), and the roadmap for the program card. */
  program: (ProgramStatus & { name: string; goal: string; phases: typeof PHASES; honest: string[]; growFood: string[]; proteinG: number }) | null;
  sleep: {
    entry?: SleepEntry;
    nights: NightPoint[];
    avg7: number | null;
    /** How much bedtimes moved around over the last 7 logged nights, in minutes. */
    spread7: number | null;
    /** Hours short of 8 across the last 7 nights. */
    short7: number;
    guess: { bed: string; wake: string; pcOff: string; pcOn: string } | null;
    pcTracker: boolean;
    /** Tonight's wind-down reminder (null on a free night) and its settings. */
    tonight: TonightPlan | null;
    nudge: NudgeSettings & { usualWake: string };
  };
  training: {
    day: TrainingEntry[];
    days: LoadPoint[];
    weeks: number[];
    ratio: number | null;
    sessions7: number;
    minutes7: number;
  };
  lastSets: Record<string, { date: string; sets: GymSet[] }>;
  food: {
    day: FoodEntry[];
    totals: ReturnType<typeof totals>;
    short: ReturnType<typeof shortfalls>;
    week: { days: number; perDay: Record<string, number>; short: ReturnType<typeof shortfalls> } | null;
    askFor: { label: string; foods: string[] }[];
    usual: UsualMeal[];
    recent: { text: string; meal?: Meal; count: number }[];
  };
  water: { ml: number; target: number; days: { date: string; ml: number }[]; entries: WaterEntry[] };
  pain: { recent: PainEntry[]; areas: PainArea[] };
  schedule: { all: ScheduleItem[]; today: ScheduleItem[] };
  streak: { now: number; best: number; loggedToday: boolean };
  targets: typeof TARGETS;
  labels: typeof LABELS;
  /** The raw log for the last 35 days, for the history list and editing. */
  recent: Pick<HealthDoc, 'sleep' | 'training' | 'food' | 'water' | 'pain' | 'checkins'>;
}

const hhmm = (t: number) => {
  const d = new Date(t);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};
/** A time rounded to the nearest 5 minutes - a guess shouldn't look more precise than it is. */
const round5 = (t: number) => Math.round(t / 300_000) * 300_000;

/** Minutes after noon, so 23:30 and 00:30 sit an hour apart rather than 23 hours. */
export function bedMinutes(bed: string): number {
  const [h, m] = bed.split(':').map(Number);
  const mins = h * 60 + m;
  return mins < 12 * 60 ? mins + 24 * 60 : mins;
}

/** Consecutive days with anything logged, ending today (or yesterday, if today is still empty). */
export function streakOf(doc: Pick<HealthDoc, 'sleep' | 'training' | 'food' | 'water' | 'checkins'>, today: string): { now: number; best: number; loggedToday: boolean } {
  const days = new Set<string>([...doc.sleep, ...doc.training, ...doc.food, ...doc.water, ...doc.checkins].map((e) => e.date));
  const loggedToday = days.has(today);
  let now = 0;
  for (let d = loggedToday ? today : shift(today, -1); days.has(d); d = shift(d, -1)) now++;
  let best = 0;
  let run = 0;
  for (const d of daysEnding(today, 180)) { run = days.has(d) ? run + 1 : 0; best = Math.max(best, run); }
  return { now, best, loggedToday };
}

/** Training day, game day or rest day: what he set, or a guess from the schedule and the log. */
function dayTypeOf(doc: HealthDoc, date: string): { type: DayType; inferred: boolean } {
  const set = doc.dayTypes[date];
  if (set) return { type: set, inferred: false };
  const weekday = new Date(`${date}T12:00:00`).getDay();
  const planned = doc.schedule.filter((s) => s.day === weekday);
  if (planned.some((s) => s.kind === 'game')) return { type: 'match', inferred: true };
  if (planned.length || doc.training.some((t) => t.date === date)) return { type: 'training', inferred: true };
  return { type: 'rest', inferred: true };
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

export function healthView(date?: string, now = new Date(), doc: HealthDoc = load()): HealthView {
  const today = isoDay(now);
  const day = date && /^\d{4}-\d{2}-\d{2}$/.test(date) && date <= today ? date : today;
  const week = daysEnding(day, 7);
  const since = shift(today, -34);

  // Sleep
  const byNight = new Map(doc.sleep.map((s) => [s.date, s]));
  const nights: NightPoint[] = daysEnding(day, 14).map((d) => {
    const s = byNight.get(d);
    return s ? { date: d, hours: s.hours, bed: s.bed, wake: s.wake, quality: s.quality } : { date: d, hours: null };
  });
  const last7 = nights.slice(-7).filter((n) => n.hours !== null);
  const beds = last7.map((n) => bedMinutes(n.bed!));
  const pc = pcTrackerOn();
  let guess: HealthView['sleep']['guess'] = null;
  if (pc && day === today) {
    const n = lastNight(loadSpans(), now);
    if (n) guess = { bed: hhmm(round5(n.offAt + 5 * 60_000)), wake: hhmm(Math.floor(n.onAt / 300_000) * 300_000), pcOff: n.pcOff, pcOn: n.pcOn };
  }

  // Training
  const days: LoadPoint[] = daysEnding(day, 14).map((d) => {
    const ts = doc.training.filter((t) => t.date === d);
    return { date: d, load: ts.reduce((n, t) => n + sessionLoad(t), 0), minutes: ts.reduce((n, t) => n + t.minutes, 0), hard: ts.some((t) => t.effort >= 7), kinds: [...new Set(ts.map((t) => t.kind))] };
  });
  const weeks = weeklyLoads(doc.training, day);
  const before = (weeks[0] + weeks[1] + weeks[2]) / 3;
  const inWeek = doc.training.filter((t) => week.includes(t.date));

  const lastSets: HealthView['lastSets'] = {};
  for (const t of [...doc.training].sort((a, b) => a.date.localeCompare(b.date) || a.at - b.at)) {
    for (const e of t.exercises ?? []) lastSets[norm(e.name)] = { date: t.date, sets: e.sets };
  }

  // Food
  const dayFood = doc.food.filter((f) => f.date === day).sort((a, b) => a.at - b.at);
  const dayTotals = totals(dayFood);
  const weekFood = doc.food.filter((f) => week.includes(f.date));
  const foodDays = new Set(weekFood.map((f) => f.date)).size;
  let weekView: HealthView['food']['week'] = null;
  if (foodDays) {
    const sum = totals(weekFood);
    const perDay = Object.fromEntries((Object.keys(TARGETS) as (keyof typeof TARGETS)[]).map((k) => [k, round1((sum[k] ?? 0) / foodDays)]));
    weekView = { days: foodDays, perDay, short: shortfalls(perDay, targetsFor(!doc.program?.off)) };
  }
  const counts = new Map<string, { text: string; meal?: Meal; count: number; at: number }>();
  for (const f of doc.food.filter((x) => x.date >= shift(today, -30))) {
    const k = f.text.toLowerCase().trim();
    const c = counts.get(k);
    counts.set(k, { text: f.text, meal: f.meal, count: (c?.count ?? 0) + 1, at: Math.max(c?.at ?? 0, f.at) });
  }
  const recentFoods = [...counts.values()].sort((a, b) => b.count - a.count || b.at - a.at).slice(0, 10).map(({ text, meal, count }) => ({ text, meal, count }));

  // Water
  const water = doc.water.filter((w) => w.date === day);
  const waterDays = daysEnding(day, 7).map((d) => ({ date: d, ml: doc.water.filter((w) => w.date === d).reduce((n, w) => n + w.ml, 0) }));

  // Pain, by body part: the newest entry for each spot says whether it is still a problem.
  const recentPain = doc.pain.filter((p) => p.date >= shift(day, -27) && p.date <= day).sort((a, b) => b.at - a.at);
  const areas = new Map<string, PainArea>();
  for (const p of [...recentPain].reverse()) {
    const key = `${norm(p.where)}|${p.side ?? ''}`;
    const a = areas.get(key);
    if (a) { a.latest = p; a.history.push({ date: p.date, severity: p.severity }); }
    else areas.set(key, { key, where: p.where, side: p.side, latest: p, history: [{ date: p.date, severity: p.severity }], active: true });
  }
  for (const a of areas.values()) a.active = a.latest.status !== 'gone' && a.latest.date >= shift(day, -13);

  const dt = dayTypeOf(doc, day);
  const prog = programStatus(doc, day);
  const targets = targetsFor(prog.on);
  const weekday = new Date(`${day}T12:00:00`).getDay();

  return {
    today,
    date: day,
    empty: !doc.sleep.length && !doc.training.length && !doc.food.length && !doc.pain.length && !doc.checkins.length && !doc.water.length,
    number: healthNumber(doc.training, doc.sleep, day),
    flags: flags(doc.training, doc.sleep, doc.pain, day),
    readiness: readiness(byNight.get(day), doc.checkins.find((c) => c.date === day)),
    checkin: doc.checkins.find((c) => c.date === day),
    dayType: dt,
    fuelTips: FUEL_TIPS[dt.type],
    program: prog.on ? { ...prog, name: PROGRAM.name, goal: PROGRAM.goal, phases: PHASES, honest: HONEST, growFood: GROW_FOOD, proteinG: PROGRAM.proteinG } : null,
    sleep: {
      entry: byNight.get(day),
      nights,
      avg7: last7.length ? round1(last7.reduce((n, x) => n + (x.hours ?? 0), 0) / last7.length) : null,
      spread7: beds.length >= 3 ? Math.max(...beds) - Math.min(...beds) : null,
      short7: round1(last7.reduce((n, x) => n + Math.max(0, TEEN_SLEEP.min - (x.hours ?? 0)), 0)),
      guess,
      pcTracker: pc,
      tonight: tonightPlan(now, nudgeSettings(), doc),
      nudge: { ...nudgeSettings(), usualWake: usualWake(doc, now) },
    },
    training: {
      day: doc.training.filter((t) => t.date === day).sort((a, b) => a.at - b.at),
      days,
      weeks,
      ratio: before > 0 ? Math.round((weeks[3] / before) * 100) / 100 : null,
      sessions7: inWeek.length,
      minutes7: inWeek.reduce((n, t) => n + t.minutes, 0),
    },
    lastSets,
    food: {
      day: dayFood,
      totals: dayTotals,
      short: shortfalls(dayTotals, targets),
      week: weekView,
      askFor: (weekView?.short ?? []).slice(0, 3).map((s) => ({ label: s.label, foods: ASK_FOR[s.key] })),
      usual: doc.usual,
      recent: recentFoods,
    },
    water: { ml: water.reduce((n, w) => n + w.ml, 0), target: WATER_TARGET_ML, days: waterDays, entries: water },
    pain: { recent: recentPain, areas: [...areas.values()].sort((a, b) => Number(b.active) - Number(a.active) || b.latest.at - a.latest.at) },
    schedule: { all: [...doc.schedule].sort((a, b) => a.day - b.day || a.start.localeCompare(b.start)), today: doc.schedule.filter((s) => s.day === weekday).sort((a, b) => a.start.localeCompare(b.start)) },
    streak: streakOf(doc, today),
    targets,
    labels: LABELS,
    recent: {
      sleep: doc.sleep.filter((x) => x.date >= since),
      training: doc.training.filter((x) => x.date >= since),
      food: doc.food.filter((x) => x.date >= since),
      water: doc.water.filter((x) => x.date >= since),
      pain: doc.pain.filter((x) => x.date >= since),
      checkins: doc.checkins.filter((x) => x.date >= since),
    },
  };
}
