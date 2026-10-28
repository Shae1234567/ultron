import { beforeEach, describe, expect, it, vi } from 'vitest';

// The department's log lives in one JSON doc - an in-memory one here.
const docs = new Map<string, unknown>();
vi.mock('../../store', () => ({
  readDoc: (n: string, f: unknown) => (docs.has(n) ? structuredClone(docs.get(n)) : f),
  writeDoc: (n: string, d: unknown) => { docs.set(n, structuredClone(d)); },
}));
vi.mock('../../brain/events', () => ({ emit: () => {} }));

const store = await import('./store');
const { forWeek, isDeload, phaseOf, phaseSets, PROGRAM, programStatus, programText, PHASES } = await import('./program');
const { WORKOUTS, workoutById } = await import('./workouts');
const { targetsFor, TARGETS } = await import('./foods');
const { snapshot, snapshotText } = await import('./summary');

beforeEach(() => docs.clear());
const day = (iso: string, h = 18) => new Date(`${iso}T${String(h).padStart(2, '0')}:00:00`);
const session = (id: string, iso: string) => store.addTraining({ kind: 'gym', what: id, minutes: 50, effort: 6, workout: id, source: 'app' }, day(iso));

describe('the Fight Club build - the program itself', () => {
  it('has five real sessions, each built from the library and safe for a teen', () => {
    expect(PROGRAM.sessions).toHaveLength(5);
    for (const id of PROGRAM.sessions) {
      const w = workoutById(id)!;
      expect(w.program).toBe('fight-club');
      expect(w.exercises.length).toBeGreaterThanOrEqual(6);
      // The safety core's gym rule: sets of 8-12 at most heavy, never a max - no rep range below 3.
      for (const e of w.exercises) if (e.reps) expect(e.reps[0]).toBeGreaterThanOrEqual(3);
    }
    // Soccer's injury prevention stays in: Nordic lowers and Copenhagen planks on legs day.
    const legs = workoutById('fc-legs')!.exercises.map((e) => e.name);
    expect(legs).toEqual(expect.arrayContaining(['Nordic hamstring lower', 'Copenhagen plank (short)']));
    // Every program exercise has a form cue.
    expect(WORKOUTS.filter((w) => w.program).flatMap((w) => w.exercises).every((e) => e.cue.length > 20)).toBe(true);
  });

  it('runs 12 months in five phases, with a lighter week every sixth', () => {
    expect(PHASES[0].from).toBe(1);
    expect(PHASES[PHASES.length - 1].to).toBe(52);
    for (let i = 1; i < PHASES.length; i++) expect(PHASES[i].from).toBe(PHASES[i - 1].to + 1);
    expect(phaseOf(1).id).toBe('foundation');
    expect(phaseOf(20).id).toBe('grow');
    expect(phaseOf(60).id).toBe('sharpen');
    expect([1, 4, 6, 7, 12, 18].map(isDeload)).toEqual([false, false, true, false, true, true]);
  });

  it('sets follow the phase: 2 while learning, half in a lighter week, one more on key lifts in Grow', () => {
    const bench = { sets: 3, key: true };
    const fly = { sets: 3 };
    expect(phaseSets(bench, 2)).toBe(2);
    expect(phaseSets(bench, 8)).toBe(3);
    expect(phaseSets(bench, 12)).toBe(2); // lighter week
    expect(phaseSets(bench, 20)).toBe(4);
    expect(phaseSets(fly, 20)).toBe(3);
    const w = forWeek(workoutById('fc-push')!, 2);
    expect(w.exercises.every((e) => e.sets <= 2)).toBe(true);
    // The library copy is untouched.
    expect(workoutById('fc-push')!.exercises[0].sets).toBe(3);
  });
});

describe('where he is, and what is next', () => {
  it('starts at week 1 with Day 1 next, and the first session starts the 12 months', () => {
    const s0 = programStatus(store.load(), '2026-10-13');
    expect(s0.on).toBe(true);
    expect(s0.started).toBeUndefined();
    expect(s0.next?.id).toBe('fc-push');
    session('fc-push', '2026-10-13');
    expect(store.load().program?.started).toBe('2026-10-13');
    const s1 = programStatus(store.load(), '2026-10-13');
    expect(s1.doneThisWeek).toBe(1);
    expect(s1.next?.id).toBe('fc-legs');
    expect(s1.note).toMatch(/Done for today/);
  });

  it('counts weeks from the start, and rotates through the five', () => {
    session('fc-push', '2026-10-13');
    session('fc-legs', '2026-10-14');
    session('fc-pull', '2026-10-15');
    const s = programStatus(store.load(), '2026-10-16');
    expect(s.week).toBe(1);
    expect(s.next?.id).toBe('fc-upper');
    expect(programStatus(store.load(), '2026-10-20').week).toBe(2);
    expect(programStatus(store.load(), '2027-01-05').phase.id).toBe('build');
  });

  it('never puts legs the day before a game - it moves an upper session up instead', () => {
    session('fc-push', '2026-10-12');
    // Day 2 (legs) is next, but there is a game tomorrow (Saturday 17 Oct).
    store.addSchedule({ kind: 'game', day: 6, start: '10:00', minutes: 70, sport: 'soccer' });
    const s = programStatus(store.load(), '2026-10-16');
    expect(s.next?.legs).toBe(false);
    expect(s.next?.id).toBe('fc-pull');
    expect(s.note).toMatch(/Game tomorrow/);
    // On game day itself: no gym.
    expect(programStatus(store.load(), '2026-10-17').note).toMatch(/Game day/);
  });

  it('says rest once all five are done this week', () => {
    ['fc-push', 'fc-legs', 'fc-pull', 'fc-upper', 'fc-athletic'].forEach((id, i) => session(id, `2026-10-1${3 + i}`));
    const s = programStatus(store.load(), '2026-10-18');
    expect(s.doneThisWeek).toBe(5);
    expect(s.next).toBeNull();
    expect(s.note).toMatch(/All five done/);
  });

  it('can be paused, resumed and restarted', () => {
    session('fc-push', '2026-10-13');
    store.setProgram('off');
    expect(programStatus(store.load(), '2026-10-14').on).toBe(false);
    store.setProgram('on');
    expect(programStatus(store.load(), '2026-10-14').started).toBe('2026-10-13');
    store.setProgram('restart');
    expect(store.load().program?.started).toBeUndefined();
    session('fc-legs', '2026-11-02');
    expect(store.load().program?.started).toBe('2026-11-02');
  });
});

describe('all of Health points at the goal', () => {
  it('raises protein to what growing needs while the program is on - and never adds a calorie target', () => {
    expect(targetsFor(true).protein_g).toBe(PROGRAM.proteinG);
    expect(targetsFor(false).protein_g).toBe(TARGETS.protein_g);
    expect(Object.keys(targetsFor(true))).not.toContain('calories');
  });

  it('puts the goal at the top of what every Health agent reads, as more food - never a diet', () => {
    const text = snapshotText(snapshot(day('2026-10-13')));
    expect(text).toMatch(/^GOAL/);
    expect(text).toMatch(/MORE food/);
    expect(text).toMatch(/never a diet/);
    expect(text).not.toMatch(/deficit|lose weight|cut/i);
    store.setProgram('off');
    expect(snapshotText(snapshot(day('2026-10-13')))).not.toMatch(/GOAL/);
  });

  it('describes the program week for the agents', () => {
    session('fc-push', '2026-10-13');
    const t = programText(programStatus(store.load(), '2026-10-13'));
    expect(t).toMatch(/week 1 of 52 \(Foundation phase\)/);
    expect(t).toMatch(/1 of 5 done/);
  });
});
