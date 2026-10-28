import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SleepEntry, TrainingEntry } from './store';

// The Health app's side of things: the log in memory, the PC tracker off, events captured.
const docs = new Map<string, unknown>();
vi.mock('../../store', () => ({
  readDoc: (n: string, f: unknown) => (docs.has(n) ? structuredClone(docs.get(n)) : f),
  writeDoc: (n: string, d: unknown) => { docs.set(n, structuredClone(d)); },
  getSettings: () => ({ trackers: { pcActivity: false } }),
}));
const events: string[] = [];
vi.mock('../../brain/events', () => ({ emit: (c: string) => { events.push(c); } }));

const store = await import('./store');
const api = await import('./api');
const { healthView, streakOf, bedMinutes } = await import('./view');
const w = await import('./workouts');
const foods = await import('./foods');
const nudge = await import('./nudge');

beforeEach(() => { docs.clear(); events.length = 0; });
const at = (iso: string, h = 9) => new Date(`${iso}T${String(h).padStart(2, '0')}:00:00`);

describe('the gym log', () => {
  it('reads sets the way people say them', () => {
    const ex = w.parseExercises('goblet squat 3x10 @ 12kg; push-ups 3 x 12, plank 3x30s\nRDL 3x8 at 20 lbs');
    expect(ex.map((e) => e.name)).toEqual(['goblet squat', 'push-ups', 'plank', 'RDL']);
    expect(ex[0].sets).toEqual([{ reps: 10, kg: 12 }, { reps: 10, kg: 12 }, { reps: 10, kg: 12 }]);
    expect(ex[2].sets[0]).toEqual({ secs: 30 });
    expect(ex[3].sets[0].kg).toBe(9); // 20 lb, to the nearest half kilo
    expect(w.parseExercises('felt good today')).toEqual([]);
  });

  it('keeps only sane numbers from whatever is sent', () => {
    const t = store.addTraining({ kind: 'gym', minutes: 45, effort: 6, exercises: [
      { name: 'Squat', sets: [{ reps: 10, kg: 20 }, { reps: -3 }, { reps: 9999, kg: 9999 }] },
      { name: '', sets: [{ reps: 5 }] },
      { name: 'Plank', sets: [{ secs: 30 }] },
    ] }, at('2026-10-09'));
    expect('error' in t).toBe(false);
    const e = (t as TrainingEntry).exercises!;
    expect(e.map((x) => x.name)).toEqual(['Squat', 'Plank']);
    expect(e[0].sets).toEqual([{ reps: 10, kg: 20 }, { reps: 200, kg: 300 }]);
  });

  it('finds last time and suggests a small step - never a max', () => {
    store.addTraining({ kind: 'gym', minutes: 45, effort: 6, exercises: [{ name: 'Goblet squat', sets: [{ reps: 12, kg: 12 }, { reps: 12, kg: 12 }, { reps: 12, kg: 12 }] }] }, at('2026-10-02'));
    store.addTraining({ kind: 'gym', minutes: 45, effort: 6, exercises: [{ name: 'goblet  squat', sets: [{ reps: 10, kg: 14 }, { reps: 9, kg: 14 }, { reps: 8, kg: 14 }] }] }, at('2026-10-06'));
    const lib = w.workoutById('legs-core')!.exercises[0];
    const last = w.lastTime(store.load().training, 'Goblet squat');
    expect(last?.date).toBe('2026-10-06');
    expect(w.setsText(last!.sets)).toBe('10, 9, 8 @ 14 kg');
    expect(w.setsText([{ reps: 10, kg: 12 }, { reps: 12 }])).toBe('10 @ 12 kg, 12');
    expect(w.nextTarget(lib, last)).toMatch(/Same 14 kg - beat your lowest set \(8\) by one rep/);
    expect(w.nextTarget(lib, { sets: [{ reps: 12, kg: 14 }, { reps: 12, kg: 14 }, { reps: 12, kg: 14 }] })).toMatch(/next dumbbell \(about \+1-2 kg\)/);
    expect(w.nextTarget(lib, null)).toMatch(/coach or adult/);
    for (const x of w.WORKOUTS.flatMap((wo) => wo.exercises)) expect(w.nextTarget(x, { sets: [{ reps: 20, kg: 50 }] })).not.toMatch(/max/i);
  });

  it('keeps every weighted library lift in sets of 8-12', () => {
    for (const x of w.WORKOUTS.flatMap((wo) => wo.exercises).filter((e) => e.load === 'dumbbells' && e.reps)) {
      expect(x.reps![0]).toBeGreaterThanOrEqual(8);
      expect(x.reps![1]).toBeLessThanOrEqual(12);
    }
    expect(w.targetText(w.workoutById('legs-core')!.exercises[5])).toBe('3 x 15 s each side');
  });
});

describe('editing, deleting and undo', () => {
  it('edits with the same checks, keeping the id and place', () => {
    const s = store.addSleep({ bed: '23:00', wake: '07:00' }, at('2026-10-09')) as SleepEntry;
    const e = store.editEntry('sleep', s.id, { bed: '22:00', wake: '07:00' });
    expect(e).toMatchObject({ id: s.id, at: s.at, hours: 9, date: '2026-10-09' });
    expect(store.editEntry('sleep', s.id, { bed: 'late', wake: '7' })).toHaveProperty('error');
    expect(store.load().sleep).toHaveLength(1);
  });

  it('deletes and puts back exactly', () => {
    const f = store.addFood({ text: '2 eggs', items: foods.estimate('2 eggs').items, unknown: [], source: 'app' }, at('2026-10-09'));
    const gone = api.remove('food', f.id);
    expect(gone.ok).toBe(true);
    expect(store.load().food).toHaveLength(0);
    expect(api.restore('food', (gone as { entry: unknown }).entry).ok).toBe(true);
    expect(store.load().food[0]).toEqual(f);
    expect(api.remove('food', 'nope').ok).toBe(false);
    expect(api.remove('passwords', f.id).ok).toBe(false);
  });

  it('tells the app every time the log changes', () => {
    store.addWater(250, undefined, at('2026-10-09'));
    expect(events).toContain('health:changed');
  });
});

describe('water and dates', () => {
  it('adds up, takes back a mis-tap, never below zero', () => {
    expect(store.addWater(500, '2026-10-09', at('2026-10-09'))).toEqual({ date: '2026-10-09', total: 500 });
    expect(store.addWater(-250, '2026-10-09', at('2026-10-09'))).toEqual({ date: '2026-10-09', total: 250 });
    expect(store.addWater(-1000, '2026-10-09', at('2026-10-09'))).toEqual({ date: '2026-10-09', total: 0 });
    expect(store.addWater(0)).toHaveProperty('error');
  });

  it('never files an entry far in the future (a typo, not a plan)', () => {
    const t = store.addTraining({ kind: 'soccer', minutes: 60, effort: 5, date: '2027-01-01' }, at('2026-10-09')) as TrainingEntry;
    expect(t.date).toBe('2026-10-09');
  });
});

describe('logging from the app', () => {
  it('estimates words and adds exact barcode items, marking unknown words', () => {
    const r = api.log('food', { text: '2 eggs, toast, mystery stew', exact: [{ name: 'Clif Bar', amount: '1 bar', nutrients: { protein_g: 10, iron_mg: 'x' }, exact: true }], meal: 'breakfast', date: '2026-10-09' });
    expect(r.ok).toBe(true);
    const e = store.load().food[0];
    expect(e.items.map((i) => i.name)).toEqual(['egg', 'toast', 'Clif Bar']);
    expect(e.items[2]).toMatchObject({ exact: true, nutrients: { protein_g: 10 } });
    expect(e.items[2].nutrients.iron_mg).toBeUndefined();
    expect(e.unknown).toEqual(['mystery stew']);
    expect(e.meal).toBe('breakfast');
  });

  it('logs a usual meal whole, and keeps estimates labelled as estimates', () => {
    expect(api.saveUsual('usual breakfast', { text: '2 eggs, glass of milk' }).ok).toBe(true);
    expect(store.load().usual[0].items.every((i) => i.exact === false)).toBe(true);
    expect(api.log('food', { usual: 'my usual breakfast' }).ok).toBe(true);
    expect(store.load().food[0].text).toBe('usual breakfast');
    expect(api.log('food', { usual: 'dinner of champions' }).ok).toBe(false);
  });

  it('says what the safety core requires the moment pain is logged', () => {
    const head = api.log('pain', { where: 'head', severity: 3, note: 'clashed heads at practice' });
    expect(head.ok && head.alerts?.join(' ')).toMatch(/tell a parent or your coach today/);
    const sharp = api.log('pain', { where: 'knee', side: 'left', severity: 4, feel: 'sharp' });
    expect(sharp.ok && sharp.alerts?.join(' ')).toMatch(/stop training on it/);
    const mild = api.log('pain', { where: 'calf', severity: 3, feel: 'tight' });
    expect(mild.ok && mild.alerts).toEqual([]);
    expect(api.log('pain', { where: '', severity: 3 }).ok).toBe(false);
  });

  it('refuses kinds it does not know', () => {
    expect(api.log('weight', { kg: 60 }).ok).toBe(false);
  });
});

describe('the day view', () => {
  it('builds a day: nights, streak, last sets, sore spots, guessed day type', () => {
    for (const [d, bed] of [['2026-10-07', '23:30'], ['2026-10-08', '22:00'], ['2026-10-09', '01:00']] as const) store.addSleep({ bed, wake: '07:00', date: d }, at(d));
    store.addTraining({ kind: 'gym', minutes: 40, effort: 6, exercises: [{ name: 'Push-up', sets: [{ reps: 12 }] }] }, at('2026-10-08'));
    store.addPain({ where: 'hamstring', side: 'left', severity: 5 }, at('2026-10-08'));
    store.addPain({ where: 'hamstring', side: 'left', severity: 2, status: 'better' }, at('2026-10-09'));
    store.addSchedule({ kind: 'game', day: 5, start: '10:00', minutes: 70 }); // Friday
    const v = healthView('2026-10-09', at('2026-10-09', 20));
    expect(v.sleep.nights.slice(-3).map((n) => n.hours)).toEqual([7.5, 9, 6]);
    expect(v.sleep.spread7).toBe(bedMinutes('01:00') - bedMinutes('22:00'));
    expect(v.streak).toMatchObject({ now: 3, loggedToday: true });
    expect(v.lastSets['push up'].sets).toEqual([{ reps: 12 }]);
    expect(v.pain.areas).toHaveLength(1);
    expect(v.pain.areas[0]).toMatchObject({ active: true, history: [{ severity: 5 }, { severity: 2 }] });
    expect(v.dayType).toEqual({ type: 'match', inferred: true });
    expect(v.fuelTips.join(' ')).toMatch(/3-4 hours before kick-off/);
    store.setDayType('2026-10-09', 'rest', at('2026-10-09'));
    expect(healthView('2026-10-09', at('2026-10-09', 20)).dayType).toEqual({ type: 'rest', inferred: false });
  });

  it('counts a streak back from yesterday when today is still empty', () => {
    const doc = { sleep: [{ date: '2026-10-08' }, { date: '2026-10-07' }], training: [], food: [], water: [], checkins: [] } as unknown as Parameters<typeof streakOf>[0];
    expect(streakOf(doc, '2026-10-09')).toMatchObject({ now: 2, loggedToday: false, best: 2 });
  });

  it('suggests foods to ask for from the week\'s shortfalls', () => {
    api.log('food', { text: 'chips, cookies', date: '2026-10-09' });
    const v = healthView('2026-10-09', at('2026-10-09', 20));
    expect(v.food.askFor.length).toBeGreaterThan(0);
    expect(v.food.askFor.flatMap((a) => a.foods).join(' ')).toMatch(/milk|eggs|beef|lentils/);
  });
});

describe('food search', () => {
  it('finds foods as he types, best match first', () => {
    expect(foods.searchFoods('pan').slice(0, 3).map((m) => m.name)).toEqual(expect.arrayContaining(['pancake', 'paneer']));
    expect(foods.searchFoods('milk')[0].name).toBe('milk');
    expect(foods.searchFoods('palak').map((m) => m.name)).toContain('palak paneer');
    expect(foods.searchFoods('x')).toEqual([]);
    expect(foods.itemFor('banana', 2)).toMatchObject({ name: 'banana', amount: '2 x 1 banana', exact: false });
  });

  it('knows the new everyday foods', () => {
    expect(foods.estimate('poutine, chicken biryani, raita').unknown).toEqual([]);
    expect(foods.lookupFood('a turkey sandwich')!.name).toBe('sandwich');
  });
});

describe("Hypnos' bedtime nudge", () => {
  const S = { bedtimeNudge: true, wake: '', hours: 9 };
  const empty = { sleep: [], schedule: [] };

  it('on a school night, half an hour before in bed by', () => {
    const p = nudge.tonightPlan(new Date('2026-10-11T19:00:00'), S, empty)!; // Sunday evening
    expect(p).toMatchObject({ wake: '07:00', bed: '21:45', remindAt: '21:15' });
    expect(new Date(p.at).toString()).toBe(new Date('2026-10-11T21:15:00').toString());
    expect(nudge.nudgeText(p, 9)).toMatch(/In bed by 21:45 gives you 9 hours before 07:00/);
  });

  it('stays quiet on Friday, unless something is on in the morning', () => {
    expect(nudge.tonightPlan(new Date('2026-10-09T19:00:00'), S, empty)).toBeNull();
    const game = { sleep: [], schedule: [{ id: 'g', kind: 'game' as const, sport: 'soccer', day: 6, start: '08:30', minutes: 70 }] };
    const p = nudge.tonightPlan(new Date('2026-10-09T19:00:00'), S, game)!;
    expect(p).toMatchObject({ wake: '07:00', why: ' - game (soccer) at 08:30' });
    const early = { sleep: [], schedule: [{ id: 'g', kind: 'game' as const, day: 6, start: '07:30', minutes: 70 }] };
    expect(nudge.tonightPlan(new Date('2026-10-09T19:00:00'), S, early)).toMatchObject({ wake: '06:00', bed: '20:45' });
  });

  it('uses his set wake time, or his usual weekday wake from the log', () => {
    expect(nudge.tonightPlan(new Date('2026-10-11T19:00:00'), { ...S, wake: '06:30', hours: 8 }, empty)).toMatchObject({ bed: '22:15', remindAt: '21:45' });
    const sleep = ['2026-10-05', '2026-10-06', '2026-10-07', '2026-10-10'].map((date, i) => ({ date, wake: ['06:40', '06:45', '06:50', '10:30'][i] }));
    expect(nudge.usualWake({ sleep } as never, new Date('2026-10-11T19:00:00'))).toBe('06:45');
  });
});
