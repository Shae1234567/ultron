import type { HealthDoc, TrainingEntry } from './store';
import { PROGRAM_PROTEIN_G } from './foods';
import { WORKOUTS, workoutById, type LibExercise, type Workout } from './workouts';

/*
 * The Fight Club build (12 Oct 2026): his goal for Health - the lean, athletic, defined look (Brad Pitt in
 * Fight Club) inside 12 months. He is 14, about 110 lb and skinny, so the look comes from ADDING muscle
 * while staying lean: five gym sessions a week (Heracles), eating enough to grow (Demeter), 9+ hours of
 * sleep (Hypnos). Never from dieting - the safety core's "fuel, not diet" rule stands, and this goal is the
 * opposite of a diet anyway. Soccer and badminton stay; the program works around them.
 *
 * Pure data and maths: the week he is in, the phase, the sets for this week, and which session is next.
 */

export const PROGRAM = {
  id: 'fight-club' as const,
  name: 'The Fight Club build',
  by: 'Heracles' as const,
  weeks: 52,
  goal: 'Lean, athletic and defined - broad shoulders, a full chest, a wide back, arms and abs you can see - by adding muscle, not by dieting.',
  /** The five sessions, in the order they rotate. */
  sessions: ['fc-push', 'fc-legs', 'fc-pull', 'fc-upper', 'fc-athletic'] as const,
  /** Sessions that work the legs: never the day before a game. */
  legs: ['fc-legs', 'fc-athletic'] as readonly string[],
  /** Eating for this goal: about 1.6 g of protein per kg at his size (110 lb, about 50 kg); it rises as he grows. */
  proteinG: PROGRAM_PROTEIN_G,
  sleepHours: 9,
};

export type PhaseId = 'foundation' | 'build' | 'grow' | 'shape' | 'sharpen';

export interface Phase { id: PhaseId; name: string; from: number; to: number; months: string; what: string }

export const PHASES: Phase[] = [
  { id: 'foundation', name: 'Foundation', from: 1, to: 4, months: 'Month 1', what: 'Learn every lift with perfect form: 2 sets each, light weights, stop with 3-4 reps left. Any lift you have never done: the first time with a coach or an adult there.' },
  { id: 'build', name: 'Build', from: 5, to: 16, months: 'Months 2-4', what: 'Full sets. When every set reaches the top of the range, add a rep or the next dumbbell up. Every 6th week is lighter (half the sets) so your body catches up.' },
  { id: 'grow', name: 'Grow', from: 17, to: 32, months: 'Months 5-8', what: 'One extra set on the key lifts (presses, pull-ups, rows, lateral raises, curls, abs). This is where most of the new muscle comes from - eat and sleep like it.' },
  { id: 'shape', name: 'Shape', from: 33, to: 44, months: 'Months 9-11', what: 'Keep the extra sets and keep your numbers climbing; the shoulders, arms and abs fill in the details of the look.' },
  { id: 'sharpen', name: 'Sharpen', from: 45, to: 52, months: 'Month 12', what: 'Keep everything you built. No dieting: the definition comes from muscle plus staying lean - which you already are.' },
];

/** What 12 months can really do - said once, plainly, so the goal stays a good one. */
export const HONEST = [
  'Brad Pitt was 35 for Fight Club, with years of training behind him - and film lighting. You are 14 and still growing, which works in your favour.',
  'Five sessions a week, enough food and 9 hours of sleep for 12 months: clearly more muscle, broader shoulders and abs you can see - that look, at your age. The full adult version keeps coming as you finish growing.',
  'Track your strength (it is logged every session), not the mirror every day: the numbers going up is the muscle coming.',
];

/** Eat to grow (Demeter): skinny guys stay skinny by under-eating, not by lifting wrong. */
export const GROW_FOOD = [
  'Three meals and two or three snacks every day - never skip breakfast or lunch.',
  `Protein at every meal and snack - eggs, milk, Greek yogurt, chicken, fish, beans, peanut butter. About ${PROGRAM.proteinG} g a day.`,
  'Carbs are fuel, not the enemy: rice, pasta, potatoes, bread, oats - a big serving on gym and practice days.',
  'Within an hour after the gym: milk and a sandwich, yogurt and fruit, or leftovers.',
  'Before bed: a glass of milk or a bowl of Greek yogurt.',
  'No dieting and no supplements or protein powder - this goal needs more real food, not less.',
];

const DAY = 86_400_000;
const at = (iso: string) => Date.parse(`${iso}T12:00:00`);
const shift = (iso: string, n: number) => {
  const d = new Date(at(iso) + n * DAY);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/** The program week (1-52, and on past 52) - week 1 until the first session starts the clock. */
export function programWeek(started: string | undefined, today: string): number {
  if (!started || today < started) return 1;
  return Math.floor((at(today) - at(started)) / (7 * DAY)) + 1;
}

export function phaseOf(week: number): Phase {
  return PHASES.find((p) => week >= p.from && week <= p.to) ?? PHASES[PHASES.length - 1];
}

/** Every 6th week is a lighter one (weeks 6, 12, 18...). Never in month 1. */
export function isDeload(week: number): boolean {
  return week >= 6 && week % 6 === 0;
}

/** Sets for one exercise this week: 2 while learning, half in a lighter week, one more on key lifts in Grow and Shape. */
export function phaseSets(e: Pick<LibExercise, 'sets' | 'key'>, week: number): number {
  const p = phaseOf(week).id;
  if (p === 'foundation') return Math.min(e.sets, 2);
  if (isDeload(week)) return Math.max(1, Math.ceil(e.sets / 2));
  if ((p === 'grow' || p === 'shape') && e.key) return e.sets + 1;
  return e.sets;
}

/** A program session with this week's sets - what the gym logger follows. */
export function forWeek(w: Workout, week: number): Workout {
  if (!w.program) return w;
  return { ...w, exercises: w.exercises.map((e) => ({ ...e, sets: phaseSets(e, week) })) };
}

export interface ProgramSession { id: string; name: string; focus: string; minutes: number; legs: boolean; sets: number; done: boolean }

export interface ProgramStatus {
  on: boolean;
  started?: string;
  week: number;
  phase: Phase;
  deload: boolean;
  /** This program week's five sessions, with the ones already done. */
  sessions: ProgramSession[];
  doneThisWeek: number;
  /** The session to do next - null once all five are done this week. */
  next: ProgramSession | null;
  /** Why "next" is what it is, when it isn't simply the next in line (a game tomorrow, game day, done today). */
  note?: string;
  doneToday: boolean;
  finished: boolean;
}

const isProgram = (t: TrainingEntry) => Boolean(t.workout && (PROGRAM.sessions as readonly string[]).includes(t.workout));

function gameOn(doc: Pick<HealthDoc, 'schedule' | 'dayTypes'>, date: string): boolean {
  if (doc.dayTypes[date] === 'match') return true;
  if (doc.dayTypes[date]) return false;
  const weekday = new Date(at(date)).getDay();
  return doc.schedule.some((s) => s.day === weekday && s.kind === 'game');
}

export function programStatus(doc: Pick<HealthDoc, 'training' | 'schedule' | 'dayTypes' | 'program'>, today: string): ProgramStatus {
  const state = doc.program ?? {};
  const week = programWeek(state.started, today);
  const weekStart = state.started && today >= state.started ? shift(state.started, (week - 1) * 7) : today;
  const done = doc.training.filter((t) => isProgram(t) && t.date >= weekStart && t.date <= today && (!state.started || t.date >= state.started));
  const doneIds = new Set(done.map((t) => t.workout!));
  const sessions: ProgramSession[] = PROGRAM.sessions.map((id) => {
    const w = forWeek(workoutById(id)!, week);
    return { id, name: w.name, focus: w.focus, minutes: w.minutes, legs: PROGRAM.legs.includes(id), sets: w.exercises.reduce((n, e) => n + e.sets, 0), done: doneIds.has(id) };
  });

  // Next in the rotation after the last program session he did; skip any already done this week.
  const last = [...doc.training].filter(isProgram).sort((a, b) => b.date.localeCompare(a.date) || b.at - a.at)[0];
  const from = last ? (PROGRAM.sessions.indexOf(last.workout as typeof PROGRAM.sessions[number]) + 1) % 5 : 0;
  const order = Array.from({ length: 5 }, (_, i) => sessions[(from + i) % 5]).filter((s) => !s.done);
  let next: ProgramSession | null = order[0] ?? null;
  let note: string | undefined;
  const doneToday = done.some((t) => t.date === today);

  if (next && gameOn(doc, today)) {
    note = 'Game day - no gym today. Play, eat well, sleep.';
  } else if (next?.legs && gameOn(doc, shift(today, 1))) {
    const swap = order.find((s) => !s.legs);
    note = swap ? `Game tomorrow, so no legs today: ${swap.name.split(' - ')[0]} instead.` : 'Game tomorrow and only leg sessions are left this week - take today off.';
    next = swap ?? null;
  } else if (doneToday && next) {
    note = 'Done for today - the next one is ready when you are.';
  }
  return {
    on: !state.off,
    started: state.started,
    week,
    phase: phaseOf(week),
    deload: isDeload(week),
    sessions,
    doneThisWeek: doneIds.size,
    next,
    note: next ? note : note ?? 'All five done this week - rest, eat and sleep. That is when the muscle grows.',
    doneToday,
    finished: week > PROGRAM.weeks,
  };
}

/** The program as lines for the Health agents' prompt. */
export function programText(s: ProgramStatus): string {
  if (!s.on) return '';
  const head = s.started
    ? `week ${Math.min(s.week, PROGRAM.weeks)} of ${PROGRAM.weeks} (${s.phase.name} phase${s.deload ? ', a lighter week' : ''})`
    : 'not started yet - week 1 begins with his first program session';
  return [
    `GOAL (his choice, the focus of all of Health): ${PROGRAM.name} - ${PROGRAM.goal} He is 14, about 110 lb and skinny: the goal needs MORE food and more muscle, never a diet.`,
    `- Gym: Heracles' 5-day program, ${head}. This week ${s.doneThisWeek} of 5 done${s.next ? `; next: ${s.next.name}` : ''}${s.note ? ` (${s.note})` : ''}.`,
    `- Food: eat to grow - 3 meals and 2-3 snacks, protein at every one (about ${PROGRAM.proteinG} g a day), carbs around training. No calorie counting, no supplements.`,
    `- Sleep: ${PROGRAM.sleepHours}+ hours - muscle is built while he sleeps.`,
    '- Soccer and badminton stay: legs never the day before a game; if the load warning shows, Day 5 is the one to drop that week.',
  ].join('\n');
}

export const PROGRAM_WORKOUTS = WORKOUTS.filter((w) => w.program === PROGRAM.id);
