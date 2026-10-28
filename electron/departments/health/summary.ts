import { flags, healthNumber, readiness, TEEN_SLEEP, weekDays, type Flag, type HealthNumber } from './load';
import { shortfalls, targetsFor, totals, TARGETS } from './foods';
import { programStatus, programText, type ProgramStatus } from './program';
import { isoDay, load, type CheckIn, type HealthDoc, type ScheduleItem, type TrainingEntry } from './store';
import { setsText } from './workouts';

/*
 * What the Health department knows right now, in a few lines - put in every Health agent's
 * prompt, so a simple question ("how did I sleep this week?") is answered in one call from
 * real data, with no tool and no plan (the fast path).
 */

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export interface HealthSnapshot {
  today: string;
  number: HealthNumber;
  flags: Flag[];
  readiness: ReturnType<typeof readiness>;
  todaySchedule: ScheduleItem[];
  food: { days: number; perDay: ReturnType<typeof totals>; short: ReturnType<typeof shortfalls> } | null;
  painThisWeek: number;
  /** Today's water (ml) and check-in. */
  water: number;
  checkin?: CheckIn;
  /** The latest gym or drills session with sets logged. */
  lastGym?: TrainingEntry;
  /** His gym program and goal (program.ts) - the focus of all of Health while it is on. */
  program: ProgramStatus;
  empty: boolean;
}

export function snapshot(now = new Date(), doc: HealthDoc = load()): HealthSnapshot {
  const today = isoDay(now);
  const days = weekDays(today);
  const foodDays = [...new Set(doc.food.filter((f) => days.includes(f.date)).map((f) => f.date))];
  const weekFood = doc.food.filter((f) => days.includes(f.date));
  const sum = totals(weekFood);
  const perDay = foodDays.length
    ? { ...sum, ...Object.fromEntries((Object.keys(TARGETS) as (keyof typeof TARGETS)[]).map((k) => [k, Math.round(((sum[k] ?? 0) / foodDays.length) * 10) / 10])) }
    : sum;
  return {
    today,
    number: healthNumber(doc.training, doc.sleep, today),
    flags: flags(doc.training, doc.sleep, doc.pain, today),
    readiness: readiness(doc.sleep.find((s) => s.date === today), doc.checkins.find((c) => c.date === today)),
    todaySchedule: doc.schedule.filter((s) => s.day === now.getDay()).sort((a, b) => a.start.localeCompare(b.start)),
    food: foodDays.length ? { days: foodDays.length, perDay, short: shortfalls(perDay, targetsFor(!doc.program?.off)) } : null,
    painThisWeek: doc.pain.filter((p) => days.includes(p.date)).length,
    water: (doc.water ?? []).filter((w) => w.date === today).reduce((n, w) => n + w.ml, 0),
    checkin: doc.checkins.find((c) => c.date === today),
    program: programStatus(doc, today),
    lastGym: [...doc.training].filter((t) => t.exercises?.length).sort((a, b) => b.date.localeCompare(a.date) || b.at - a.at)[0],
    empty: !doc.sleep.length && !doc.training.length && !doc.food.length && !doc.pain.length && !doc.checkins.length,
  };
}

/** The snapshot as the lines a Health agent reads. Says plainly what has not been logged. */
export function snapshotText(s: HealthSnapshot = snapshot()): string {
  const goal = programText(s.program);
  const withGoal = (text: string) => (goal ? `${goal}\n\n${text}` : text);
  if (s.empty) {
    // 12 Oct 2026: "...and ask for the first log" here made the local model answer "slept 12 to 8" with "what time
    // did you go to bed?" - it obeyed this line over the message itself. What they just said comes first.
    return withGoal('HEALTH DATA: nothing logged before this message - no sleep, training or food on record. If their message gives something to log, log it now with your tool. If they ask about data that is not there, say so plainly and say what to tell you. Never invent numbers.');
  }
  const n = s.number;
  const nightLine = n.nights.map((h, i) => `${weekDays(s.today)[i].slice(5)} ${h === null ? '-' : `${h}h`}`).join(', ');
  const lines = [
    `HEALTH DATA (today ${s.today}, the last 7 days):`,
    `- Sleep: ${n.nightsLogged ? `${n.nightsOver8} of ${n.nightsLogged} logged nights had ${TEEN_SLEEP.min}+ hours (${nightLine})` : 'no nights logged this week'}.`,
    `- Training: ${n.sessions} session${n.sessions === 1 ? '' : 's'} logged, load ${n.load} (minutes x effort).`,
    `- Today's readiness: ${s.readiness.level}${s.readiness.why ? ` (${s.readiness.why})` : ''}.`,
    s.todaySchedule.length ? `- On today (${DAYS[new Date(`${s.today}T12:00:00`).getDay()]}): ${s.todaySchedule.map((x) => `${x.kind}${x.sport ? ` (${x.sport})` : ''} at ${x.start}, ${x.minutes} min`).join('; ')}.` : '',
    s.food
      ? `- Food (${s.food.days} day${s.food.days === 1 ? '' : 's'} logged, mostly estimates): ${s.food.short.length ? `short on ${s.food.short.slice(0, 3).map((x) => `${x.label} ${Math.round(x.share * 100)}% of target`).join(', ')}` : 'on track for protein, iron, calcium, vitamin D, fibre and fruit/veg'}.`
      : '- Food: nothing logged this week.',
    s.painThisWeek ? `- Pain logged this week: ${s.painThisWeek}.` : '',
    s.checkin ? `- Today's check-in: energy ${s.checkin.energy ?? '-'}/5, soreness ${s.checkin.soreness ?? '-'}/5${s.checkin.note ? ` (${s.checkin.note})` : ''}.` : '',
    s.water ? `- Water today: ${s.water} ml of about 2500.` : '',
    s.lastGym ? `- Last gym session (${s.lastGym.date}, ${s.lastGym.what ?? s.lastGym.kind}): ${s.lastGym.exercises!.slice(0, 6).map((e) => `${e.name} ${setsText(e.sets)}`).join('; ')}.` : '',
    ...s.flags.map((f) => `- FLAG: ${f.text}`),
  ];
  return withGoal(lines.filter(Boolean).join('\n'));
}
