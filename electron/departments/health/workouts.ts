import type { GymExercise, GymSet, TrainingEntry, TrainingKind } from './store';

/*
 * Heracles' and Achilles' workout library: sessions built for a 14-year-old soccer player
 * (with a badminton block for the winter). Pure data and maths, no model - the Health app
 * shows it, the gym logger follows it, and "last time" plus the next target come from his
 * own log.
 *
 * The rules that shape it (the safety core's gym rule, and the evidence for young players):
 *  - technique before weight; weighted sets of 8-12, never a one-rep max;
 *  - any new lift tried with a coach or an adult there;
 *  - the injury-prevention work that has the best evidence in youth soccer is in here on
 *    purpose: Nordic hamstring lowers, Copenhagen planks and a FIFA 11+ style warm-up;
 *  - progress in small steps - a rep or two, or the next dumbbell up - only once every set
 *    hit the top of the range.
 */

export interface LibExercise {
  name: string;
  sets: number;
  /** A rep range, e.g. [8, 12] - or a fixed number as [n, n]. */
  reps?: [number, number];
  /** A hold or a timed drill, in seconds. */
  secs?: number;
  /** For runs and carries: shown as written. */
  dist?: string;
  perSide?: boolean;
  /** Rest after each set, seconds. */
  rest: number;
  load: 'bodyweight' | 'dumbbells' | 'partner' | 'ball' | 'rope' | 'none';
  cue: string;
  why?: string;
  /** A main lift of a program: it gets the extra set in the Grow and Shape phases (program.ts). */
  key?: boolean;
}

export interface Workout {
  id: string;
  name: string;
  /** Part of a program (program.ts) - started from the program card, not the general library. */
  program?: 'fight-club';
  by: 'Heracles' | 'Achilles';
  where: 'gym' | 'home' | 'field' | 'court';
  kind: TrainingKind;
  /** About how long, start to finish. */
  minutes: number;
  /** About how hard it should feel, 1-10 - what to log if it went to plan. */
  effort: number;
  focus: string;
  when: string;
  exercises: LibExercise[];
}

export const GYM_RULES = [
  'Warm up first (5 minutes of easy movement). Technique before weight, every set.',
  'Weighted sets of 8-12 with 2-3 reps left in the tank. Never a one-rep max.',
  'Trying a lift for the first time: do it with a coach or an adult there.',
  'Sharp pain means stop - not "push through". Tell a parent or your coach.',
];

export const WORKOUTS: Workout[] = [
  {
    id: 'legs-core', name: 'Legs & core strength', by: 'Heracles', where: 'gym', kind: 'gym', minutes: 45, effort: 6,
    focus: 'Leg strength for shooting, sprinting and duels, plus the two exercises that protect hamstrings and groins.',
    when: 'Up to twice a week. Not the day before a game.',
    exercises: [
      { name: 'Goblet squat', sets: 3, reps: [8, 12], rest: 90, load: 'dumbbells', cue: 'Hold one dumbbell at your chest. Sit down between your heels, knees follow your toes, chest up.' },
      { name: 'Dumbbell Romanian deadlift', sets: 3, reps: [8, 12], rest: 90, load: 'dumbbells', cue: 'Soft knees, push your hips back, back flat. The weights slide down your thighs to just below the knee.' },
      { name: 'Rear-foot-elevated split squat', sets: 3, reps: [8, 10], perSide: true, rest: 60, load: 'bodyweight', cue: 'Back foot on a bench. Go straight down; front knee stays over the middle of your foot. Add dumbbells only when 10 is easy.' },
      { name: 'Glute bridge', sets: 3, reps: [10, 12], rest: 60, load: 'bodyweight', cue: 'Feet flat, drive through your heels, squeeze at the top for a second. Ribs down.' },
      { name: 'Nordic hamstring lower', sets: 3, reps: [3, 5], rest: 90, load: 'partner', cue: 'Someone holds your ankles. Lower yourself as slowly as you can and catch yourself with your hands. Only the lowering counts.', why: 'In studies of soccer players it cuts hamstring injuries by about half.' },
      { name: 'Copenhagen plank (short)', sets: 3, secs: 15, perSide: true, rest: 45, load: 'bodyweight', cue: 'Side plank with your top knee on a bench, bottom leg hanging. Hips up in a straight line.', why: 'Strengthens the groin - one of the most common soccer strains.' },
      { name: 'Dead bug', sets: 3, reps: [8, 8], perSide: true, rest: 45, load: 'bodyweight', cue: 'Lower back pressed into the floor the whole time. Slow: opposite arm and leg out, back in.' },
    ],
  },
  {
    id: 'speed-agility', name: 'Speed & agility', by: 'Achilles', where: 'field', kind: 'run', minutes: 40, effort: 7,
    focus: 'First-step speed, cutting and stopping - where games are won and most knee injuries happen.',
    when: 'On fresh legs: early in the week, never right after a hard practice.',
    exercises: [
      { name: 'A-skips', sets: 2, dist: '20 m', rest: 30, load: 'none', cue: 'Tall, quick feet, opposite arm to leg. This is the warm-up - stay relaxed.' },
      { name: 'Acceleration sprint', sets: 6, dist: '15 m', rest: 75, load: 'none', cue: 'Lean from the ankles, push the ground back, first three steps short and hard. Walk back and rest fully - speed is trained fresh.' },
      { name: '5-10-5 shuttle', sets: 4, rest: 90, reps: [1, 1], load: 'none', cue: 'Hips low at each turn, plant the outside foot, push off hard.' },
      { name: 'Lateral bound', sets: 3, reps: [5, 5], perSide: true, rest: 60, load: 'bodyweight', cue: 'Jump sideways, land soft on one leg and hold it for a second - knee over toes.' },
      { name: 'Pogo hops', sets: 3, reps: [15, 15], rest: 45, load: 'bodyweight', cue: 'Stiff ankles, bounce quickly off the balls of your feet.' },
      { name: 'Sprint and stop', sets: 4, dist: '10 m', rest: 60, load: 'none', cue: 'Sprint, then stop within three steps: sink your hips, short choppy steps.', why: 'Most non-contact knee injuries happen when stopping or cutting - practising it makes it safer.' },
    ],
  },
  {
    id: 'prehab', name: 'Injury-prevention warm-up (FIFA 11+ style)', by: 'Achilles', where: 'field', kind: 'other', minutes: 20, effort: 3,
    focus: 'The warm-up with the best evidence in youth soccer: balance, landing, hamstrings, core.',
    when: 'Before practice, at least twice a week.',
    exercises: [
      { name: 'Jog with hip in and out', sets: 2, dist: '20 m', rest: 15, load: 'none', cue: 'Easy jog; every few steps lift a knee and open the hip out, then in.' },
      { name: 'Plank', sets: 3, secs: 20, rest: 20, load: 'bodyweight', cue: 'Elbows under shoulders, straight line, breathe.' },
      { name: 'Side plank', sets: 2, secs: 20, perSide: true, rest: 20, load: 'bodyweight', cue: 'Hips up, body straight.' },
      { name: 'Nordic hamstring lower', sets: 1, reps: [3, 5], rest: 60, load: 'partner', cue: 'Slow lowering, catch yourself.' },
      { name: 'Single-leg balance with a ball', sets: 2, secs: 30, perSide: true, rest: 15, load: 'ball', cue: 'Stand on one leg, slightly bent knee; pass a ball around your waist or with a partner.' },
      { name: 'Squat with heel raise', sets: 2, reps: [10, 10], rest: 30, load: 'bodyweight', cue: 'Squat down, stand up onto your toes, lower slowly.' },
      { name: 'Jump and land', sets: 2, reps: [8, 8], rest: 30, load: 'bodyweight', cue: 'Jump straight up, land soft and quiet, knees over toes - never caving in.' },
    ],
  },
  {
    id: 'upper-core', name: 'Upper body & core', by: 'Heracles', where: 'gym', kind: 'gym', minutes: 35, effort: 5,
    focus: 'Holding off defenders and staying strong in the air - balanced pushing and pulling.',
    when: 'Any non-game day. Fine the day after a hard leg session.',
    exercises: [
      { name: 'Push-up', sets: 3, reps: [8, 15], rest: 60, load: 'bodyweight', cue: 'Straight line head to heels, chest down to a fist off the floor, elbows at about 45 degrees.' },
      { name: 'One-arm dumbbell row', sets: 3, reps: [8, 12], perSide: true, rest: 60, load: 'dumbbells', cue: 'Hand and knee on a bench, flat back, pull the dumbbell to your hip.' },
      { name: 'Seated dumbbell shoulder press', sets: 3, reps: [8, 12], rest: 75, load: 'dumbbells', cue: 'Ribs down, press straight up, don\'t lean back.' },
      { name: 'Inverted row', sets: 3, reps: [6, 12], rest: 60, load: 'bodyweight', cue: 'Under a sturdy bar or table, body straight, pull your chest up to it.' },
      { name: 'Plank', sets: 3, secs: 30, rest: 45, load: 'bodyweight', cue: 'Straight line, squeeze your glutes, breathe.' },
      { name: 'Side plank', sets: 3, secs: 20, perSide: true, rest: 30, load: 'bodyweight', cue: 'Hips up, body straight.' },
      { name: 'Farmer carry', sets: 3, dist: '30 m', rest: 60, load: 'dumbbells', cue: 'Heavy-ish dumbbells, stand tall, shoulders back, slow steps.' },
    ],
  },
  {
    id: 'ball-mastery', name: 'Ball mastery', by: 'Achilles', where: 'home', kind: 'soccer', minutes: 25, effort: 4,
    focus: 'Touches - the cheapest way to get better on the ball. Both feet, every drill.',
    when: 'Any day, even rest days - it is light on the legs.',
    exercises: [
      { name: 'Toe taps', sets: 4, secs: 30, rest: 20, load: 'ball', cue: 'Light, quick taps on top of the ball, alternating feet. Eyes up when you can.' },
      { name: 'Sole rolls', sets: 3, secs: 30, rest: 20, load: 'ball', cue: 'Roll the ball side to side under one sole, then switch feet.' },
      { name: 'Inside-outside', sets: 3, secs: 30, perSide: true, rest: 20, load: 'ball', cue: 'One foot: push with the inside, catch with the outside. Keep it close.' },
      { name: 'V-pulls', sets: 3, secs: 30, perSide: true, rest: 20, load: 'ball', cue: 'Pull the ball back with the sole, push it out with the inside - a V shape.' },
      { name: 'Wall passes (one touch)', sets: 3, reps: [40, 50], perSide: true, rest: 30, load: 'ball', cue: 'Inside of the foot, one touch, weight on the balls of your feet.' },
      { name: 'Juggling', sets: 3, secs: 120, rest: 30, load: 'ball', cue: 'Count your best run. Weak foot every fifth touch.' },
    ],
  },
  {
    id: 'engine', name: 'Engine (conditioning)', by: 'Achilles', where: 'field', kind: 'run', minutes: 30, effort: 7,
    focus: 'Repeat sprints and recovering between them - what a full 90 minutes asks of you.',
    when: 'Once a week in pre-season. In season, practice covers most of this.',
    exercises: [
      { name: '15/15 runs', sets: 2, reps: [8, 8], rest: 180, load: 'none', cue: '15 seconds fast (not flat out), 15 seconds walk - that is one rep.' },
      { name: 'Box-to-box tempo run', sets: 6, dist: '70 m', rest: 45, load: 'none', cue: 'About 70% speed, relaxed and tall. Walk back as the rest.' },
      { name: '5-10-15-20 shuttle', sets: 3, reps: [1, 1], rest: 120, load: 'none', cue: 'Touch the 5, 10, 15 and 20 m lines, back to the start each time.' },
    ],
  },
  {
    id: 'badminton', name: 'Badminton footwork', by: 'Achilles', where: 'court', kind: 'badminton', minutes: 30, effort: 6,
    focus: 'Split step, lunges to the corners and calves that last - the build-up for February tryouts.',
    when: 'From December, twice a week alongside soccer.',
    exercises: [
      { name: 'Skipping rope', sets: 3, secs: 60, rest: 30, load: 'rope', cue: 'Light on the balls of your feet. Mix two feet and single leg.' },
      { name: 'Shadow footwork to six corners', sets: 6, secs: 30, rest: 30, load: 'none', cue: 'Split step, move to a corner, lunge and recover to the middle. Racket hand up.' },
      { name: 'Lateral shuffle', sets: 3, secs: 20, rest: 30, load: 'none', cue: 'Low, quick, feet never cross.' },
      { name: 'Alternating forward lunge', sets: 3, reps: [8, 8], perSide: true, rest: 45, load: 'bodyweight', cue: 'Long step, front knee over the foot, push back up.' },
      { name: 'Single-leg calf raise', sets: 3, reps: [12, 12], perSide: true, rest: 30, load: 'bodyweight', cue: 'All the way up, slow down. Hold a wall for balance.' },
    ],
  },

  /*
   * The Fight Club build (12 Oct 2026): five sessions a week for the lean, athletic, defined look - broad
   * shoulders, a full chest, a wide back, arms and abs. Built for a skinny 14-year-old soccer player (about
   * 110 lb): the upper body gets the volume (that is the look), legs stay soccer-strength with the injury-
   * prevention work kept in, and no exercise needs a barbell or a max. Sets change with the phase (program.ts).
   */
  {
    id: 'fc-push', program: 'fight-club', name: 'Day 1 - Chest, shoulders & triceps', by: 'Heracles', where: 'gym', kind: 'gym', minutes: 50, effort: 6,
    focus: 'A full chest and wide shoulders - the top half of the look.',
    when: 'Any day. Fine after a practice.',
    exercises: [
      { name: 'Dumbbell bench press', sets: 3, reps: [8, 12], rest: 90, load: 'dumbbells', key: true, cue: 'Feet flat, shoulder blades squeezed back. Lower to the sides of your chest, elbows at about 45 degrees, press up.' },
      { name: 'Incline dumbbell press', sets: 3, reps: [8, 12], rest: 90, load: 'dumbbells', key: true, cue: 'Bench at about 30 degrees. Lower to your upper chest, press up and slightly in.', why: 'The upper chest is what makes a chest look full.' },
      { name: 'Seated dumbbell shoulder press', sets: 3, reps: [8, 12], rest: 75, load: 'dumbbells', cue: 'Ribs down, press straight up, don\'t lean back.' },
      { name: 'Dumbbell lateral raise', sets: 3, reps: [10, 12], rest: 45, load: 'dumbbells', key: true, cue: 'Light weights. Lead with your elbows, raise to shoulder height, lower slowly - no swinging.', why: 'Wider shoulders make your waist look narrower: the V shape.' },
      { name: 'Overhead dumbbell triceps extension', sets: 3, reps: [10, 12], rest: 60, load: 'dumbbells', cue: 'One dumbbell in both hands behind your head, elbows pointing up and in, straighten your arms.' },
      { name: 'Push-up', sets: 2, reps: [8, 15], rest: 60, load: 'bodyweight', cue: 'Straight line head to heels, chest to a fist off the floor. Stop with two left in the tank.' },
      { name: 'Hanging knee raise', sets: 3, reps: [8, 12], rest: 45, load: 'bodyweight', cue: 'Hang from a bar without swinging, curl your knees up to your chest, lower slowly.' },
    ],
  },
  {
    id: 'fc-legs', program: 'fight-club', name: 'Day 2 - Legs & core', by: 'Heracles', where: 'gym', kind: 'gym', minutes: 45, effort: 6,
    focus: 'Soccer-strong legs and the hamstring and groin work that keeps you playing.',
    when: 'Never the day before a game - the program moves it for you.',
    exercises: [
      { name: 'Goblet squat', sets: 3, reps: [8, 12], rest: 90, load: 'dumbbells', cue: 'Hold one dumbbell at your chest. Sit down between your heels, knees follow your toes, chest up.' },
      { name: 'Dumbbell Romanian deadlift', sets: 3, reps: [8, 12], rest: 90, load: 'dumbbells', cue: 'Soft knees, push your hips back, back flat. The weights slide down your thighs to just below the knee.' },
      { name: 'Rear-foot-elevated split squat', sets: 3, reps: [8, 10], perSide: true, rest: 60, load: 'bodyweight', cue: 'Back foot on a bench. Go straight down; front knee over the middle of your foot. Add dumbbells only when 10 is easy.' },
      { name: 'Nordic hamstring lower', sets: 3, reps: [3, 5], rest: 90, load: 'partner', cue: 'Someone holds your ankles. Lower yourself as slowly as you can and catch yourself with your hands.', why: 'In studies of soccer players it cuts hamstring injuries by about half.' },
      { name: 'Copenhagen plank (short)', sets: 3, secs: 15, perSide: true, rest: 45, load: 'bodyweight', cue: 'Side plank with your top knee on a bench, bottom leg hanging. Hips up in a straight line.', why: 'Strengthens the groin - one of the most common soccer strains.' },
      { name: 'Standing calf raise', sets: 3, reps: [12, 15], rest: 45, load: 'bodyweight', cue: 'On a step: heels all the way down, up onto your toes, hold a second at the top.' },
      { name: 'Dead bug', sets: 3, reps: [8, 8], perSide: true, rest: 45, load: 'bodyweight', cue: 'Lower back pressed into the floor the whole time. Slow: opposite arm and leg out, back in.' },
    ],
  },
  {
    id: 'fc-pull', program: 'fight-club', name: 'Day 3 - Back & biceps', by: 'Heracles', where: 'gym', kind: 'gym', minutes: 50, effort: 6,
    focus: 'A wide back and arms - the other half of the V.',
    when: 'Any day.',
    exercises: [
      { name: 'Pull-up', sets: 3, reps: [4, 10], rest: 120, load: 'bodyweight', key: true, cue: 'Full hang to chin over the bar, no kicking. Can\'t do 4 yet? Jump up and lower yourself as slowly as you can, 3-5 times.', why: 'Back width is half of the Fight Club look.' },
      { name: 'One-arm dumbbell row', sets: 3, reps: [8, 12], perSide: true, rest: 60, load: 'dumbbells', key: true, cue: 'Hand and knee on a bench, flat back, pull the dumbbell to your hip.' },
      { name: 'Inverted row', sets: 3, reps: [8, 12], rest: 60, load: 'bodyweight', cue: 'Under a sturdy bar, body straight, pull your chest up to it.' },
      { name: 'Bent-over reverse fly', sets: 3, reps: [10, 12], rest: 45, load: 'dumbbells', cue: 'Hinge forward with a flat back, light dumbbells, open your arms wide and squeeze your shoulder blades.', why: 'The back of the shoulders: posture, and shoulders that look round from every side.' },
      { name: 'Dumbbell curl', sets: 3, reps: [10, 12], rest: 60, load: 'dumbbells', key: true, cue: 'Elbows pinned to your sides, curl up, lower slowly - no swinging.' },
      { name: 'Hammer curl', sets: 2, reps: [10, 12], rest: 60, load: 'dumbbells', cue: 'Palms facing each other, the same strict curl.' },
      { name: 'Side plank', sets: 3, secs: 25, perSide: true, rest: 30, load: 'bodyweight', cue: 'Hips up, body straight.' },
    ],
  },
  {
    id: 'fc-upper', program: 'fight-club', name: 'Day 4 - Upper body (the V-taper day)', by: 'Heracles', where: 'gym', kind: 'gym', minutes: 50, effort: 6,
    focus: 'Upper chest, back width, side shoulders and arms - the details of the look.',
    when: 'Any day. A good pick the day before a game: no legs in it.',
    exercises: [
      { name: 'Incline dumbbell press', sets: 3, reps: [8, 12], rest: 90, load: 'dumbbells', key: true, cue: 'Bench at about 30 degrees. Lower to your upper chest, press up and slightly in.' },
      { name: 'Chin-up', sets: 3, reps: [4, 10], rest: 120, load: 'bodyweight', key: true, cue: 'Palms facing you, shoulder width. Chest up to the bar, lower all the way. Slow lowering only if you can\'t do 4 yet.' },
      { name: 'Dumbbell lateral raise', sets: 4, reps: [10, 12], rest: 45, load: 'dumbbells', key: true, cue: 'Light weights. Lead with your elbows to shoulder height, lower slowly.' },
      { name: 'Dumbbell pullover', sets: 3, reps: [10, 12], rest: 60, load: 'dumbbells', cue: 'Lie across a bench, one dumbbell over your chest with nearly straight arms, lower it behind your head slowly, pull it back over.' },
      { name: 'Close-grip push-up', sets: 3, reps: [8, 15], rest: 60, load: 'bodyweight', cue: 'Hands under your shoulders, elbows brushing your sides - this one is for the triceps.' },
      { name: 'Incline dumbbell curl', sets: 3, reps: [10, 12], rest: 60, load: 'dumbbells', cue: 'Lean back on an incline bench, arms hanging, curl without bringing your elbows forward.' },
      { name: 'Band pull-apart', sets: 3, reps: [15, 15], rest: 30, load: 'none', cue: 'A light resistance band at chest height, arms straight, pull it apart until it touches your chest.', why: 'Keeps shoulders healthy when you press a lot.' },
    ],
  },
  {
    id: 'fc-athletic', program: 'fight-club', name: 'Day 5 - Athletic legs, abs & carries', by: 'Heracles', where: 'gym', kind: 'gym', minutes: 40, effort: 5,
    focus: 'Abs you can see, single-leg strength for soccer, and a grip and core that hold it all together.',
    when: 'Lighter on the legs, but still not the day before a game.',
    exercises: [
      { name: 'Hanging leg raise', sets: 3, reps: [6, 12], rest: 60, load: 'bodyweight', key: true, cue: 'From a still hang, raise your legs to hip height without swinging. Too hard? Bend your knees.', why: 'Abs show when they are strong and you are lean - you are already lean, so this is the part to build.' },
      { name: 'Ab wheel rollout (from knees)', sets: 3, reps: [6, 10], rest: 60, load: 'bodyweight', key: true, cue: 'Roll out only as far as your lower back stays flat, pull back with your abs. No wheel? Slow plank walk-outs.' },
      { name: 'Dumbbell step-up', sets: 3, reps: [8, 8], perSide: true, rest: 60, load: 'dumbbells', cue: 'Whole foot on a knee-high box, drive up through that heel, step down slowly.' },
      { name: 'Single-leg Romanian deadlift', sets: 3, reps: [8, 8], perSide: true, rest: 60, load: 'dumbbells', cue: 'Light dumbbell in the opposite hand, hinge on one leg with a flat back, hips square.' },
      { name: 'Plank', sets: 3, secs: 40, rest: 45, load: 'bodyweight', cue: 'Straight line, squeeze your glutes, breathe.' },
      { name: 'Farmer carry', sets: 3, dist: '30 m', rest: 60, load: 'dumbbells', cue: 'Heavy-ish dumbbells, stand tall, shoulders back, slow steps.' },
    ],
  },
];

export const workoutById = (id: string) => WORKOUTS.find((w) => w.id === id);

/** One target line, the way a coach writes it: "3 x 8-12", "3 x 15 s each side", "6 x 15 m". */
export function targetText(e: LibExercise): string {
  const each = e.perSide ? ' each side' : '';
  if (e.secs) return `${e.sets} x ${e.secs >= 60 && e.secs % 60 === 0 ? `${e.secs / 60} min` : `${e.secs} s`}${each}`;
  if (e.dist) return `${e.sets} x ${e.dist}`;
  if (e.reps) return `${e.sets} x ${e.reps[0] === e.reps[1] ? e.reps[0] : `${e.reps[0]}-${e.reps[1]}`}${each}`;
  return `${e.sets} sets`;
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/** The last time this exercise was logged (newest first), from his training log. */
export function lastTime(training: TrainingEntry[], name: string, beforeId?: string): { date: string; sets: GymSet[] } | null {
  const want = norm(name);
  const sorted = [...training].filter((t) => t.exercises?.length && t.id !== beforeId).sort((a, b) => b.date.localeCompare(a.date) || b.at - a.at);
  for (const t of sorted) {
    const ex = t.exercises!.find((x) => norm(x.name) === want);
    if (ex) return { date: t.date, sets: ex.sets };
  }
  return null;
}

/** "3 x 10 @ 12 kg", "8, 8, 6", "3 x 20 s". */
export function setsText(sets: GymSet[]): string {
  if (!sets.length) return '';
  const same = sets.every((s) => s.reps === sets[0].reps && s.kg === sets[0].kg && s.secs === sets[0].secs);
  const one = (s: GymSet) => (s.secs ? `${s.secs} s` : `${s.reps ?? 0}`);
  const kg = sets.every((s) => s.kg === sets[0].kg) && sets[0].kg ? ` @ ${sets[0].kg} kg` : '';
  if (same) return `${sets.length} x ${one(sets[0])}${kg}`;
  if (kg) return sets.map(one).join(', ') + kg;
  return sets.map((s) => `${one(s)}${s.kg ? ` @ ${s.kg} kg` : ''}`).join(', ');
}

/**
 * What to aim for today, from last time. Small steps only: when every set reached the top of
 * the range, a rep or two more (bodyweight) or the next dumbbell up (about 1-2 kg); otherwise
 * the same weight and one more rep. Never a max.
 */
export function nextTarget(e: LibExercise | undefined, last: { sets: GymSet[] } | null): string {
  if (!last || !last.sets.length) {
    return e?.load === 'dumbbells'
      ? 'First time: pick a weight you could lift 3-4 more times than the target. Technique first - and with a coach or adult there.'
      : 'First time: smooth and controlled, stop with a rep or two left.';
  }
  const sets = last.sets;
  if (e?.secs || sets.every((s) => s.secs && !s.reps)) {
    const best = Math.max(...sets.map((s) => s.secs ?? 0));
    return `Last time up to ${best} s. If it felt solid, add 5 s to each hold.`;
  }
  const top = e?.reps?.[1];
  const kg = sets.find((s) => s.kg)?.kg;
  const allTop = top !== undefined && sets.length >= (e?.sets ?? 1) && sets.every((s) => (s.reps ?? 0) >= top);
  if (allTop && kg) return `Every set hit ${top} at ${kg} kg. Go up a little: the next dumbbell (about +1-2 kg), back to the bottom of the range.`;
  if (allTop) return `Every set hit ${top}. Add a rep or two, or slow down the lowering.`;
  const least = Math.min(...sets.map((s) => s.reps ?? 0));
  return kg ? `Same ${kg} kg - beat your lowest set (${least}) by one rep.` : `Beat your lowest set (${least}) by one rep.`;
}

/** Sets and reps in a session, for the summary line. */
export function sessionTotals(exercises: GymExercise[] = []): { exercises: number; sets: number; reps: number } {
  let sets = 0;
  let reps = 0;
  for (const e of exercises) for (const s of e.sets) { sets++; reps += s.reps ?? 0; }
  return { exercises: exercises.length, sets, reps };
}

/**
 * Gym detail the way people say it, into sets: "goblet squat 3x10 @ 12kg; push-ups 3 x 12,
 * plank 3x30s". One exercise per ";", "," or line. Anything without sets in it is skipped.
 */
export function parseExercises(text: string): GymExercise[] {
  const out: GymExercise[] = [];
  for (const raw of String(text ?? '').split(/;|\n|,(?![^(]*\))/)) {
    const part = raw.trim();
    const m = /^(.*?)\s*(\d{1,2})\s*[x×*]\s*(\d{1,3})\s*(s|sec|secs|seconds)?\b(?:\s*(?:@|at)\s*(\d{1,3}(?:\.\d+)?)\s*(kg|kgs|lb|lbs)?)?/i.exec(part);
    if (!m || !m[1].trim()) continue;
    const sets = Math.min(12, Number(m[2]));
    const n = Number(m[3]);
    const timed = Boolean(m[4]);
    let kg = m[5] ? Number(m[5]) : undefined;
    if (kg !== undefined && /lb/i.test(m[6] ?? '')) kg = Math.round(kg * 0.4536 * 2) / 2;
    const one: GymSet = timed ? { secs: n } : { reps: n, ...(kg ? { kg } : {}) };
    out.push({ name: m[1].trim().replace(/^[-*\d.)\s]+/, '').slice(0, 60), sets: Array.from({ length: sets }, () => ({ ...one })) });
  }
  return out.filter((e) => e.name);
}
