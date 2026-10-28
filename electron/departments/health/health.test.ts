import { beforeEach, describe, expect, it, vi } from 'vitest';

// The department's log lives in one JSON doc - an in-memory one here.
const docs = new Map<string, unknown>();
vi.mock('../../store', () => ({
  readDoc: (n: string, f: unknown) => (docs.has(n) ? structuredClone(docs.get(n)) : f),
  writeDoc: (n: string, d: unknown) => { docs.set(n, structuredClone(d)); },
}));

const store = await import('./store');
const { flags, healthNumber, readiness, weeklyLoads } = await import('./load');
const foods = await import('./foods');
const { snapshot, snapshotText } = await import('./summary');
const { enforceHealthSafety, triggeredRules } = await import('../../brain/safety/health');
const { departmentFor } = await import('../route');

beforeEach(() => docs.clear());
const day = (iso: string, h = 9) => new Date(`${iso}T${String(h).padStart(2, '0')}:00:00`);

describe('logging sleep', () => {
  it('reads times the way people say them', () => {
    expect(store.parseClock('11:30pm', 'bed')).toBe('23:30');
    expect(store.parseClock('10:30', 'bed')).toBe('22:30');
    expect(store.parseClock('1', 'bed')).toBe('01:00');
    // "slept 12 to 8": midnight, not noon (it logged 20 hours on 12 Oct 2026). Waking at 12 is still noon.
    expect(store.parseClock('12', 'bed')).toBe('00:00');
    expect(store.parseClock('12:30', 'bed')).toBe('00:30');
    expect(store.parseClock('12pm', 'bed')).toBe('12:00');
    expect(store.parseClock('12', 'wake')).toBe('12:00');
    expect(store.parseClock('7', 'wake')).toBe('07:00');
    expect(store.parseClock('6:45am')).toBe('06:45');
    expect(store.parseClock('25:00')).toBeNull();
  });

  it('works out the hours across midnight, and a correction replaces the night', () => {
    const a = store.addSleep({ bed: '11:30pm', wake: '7:00' }, day('2026-10-09'));
    expect(a).toMatchObject({ date: '2026-10-09', bed: '23:30', wake: '07:00', hours: 7.5 });
    store.addSleep({ bed: '22:45', wake: '7:00' }, day('2026-10-09'));
    expect(store.load().sleep).toHaveLength(1);
    expect(store.load().sleep[0].hours).toBe(8.25);
  });

  it('refuses times that make no sense', () => {
    expect(store.addSleep({ bed: 'late', wake: '7' })).toHaveProperty('error');
  });
});

describe('training load and its flags', () => {
  const train = (date: string, minutes: number, effort: number, kind = 'soccer') => store.addTraining({ kind, minutes, effort, date }, day(date));

  it('is minutes x effort, in weekly blocks', () => {
    train('2026-10-09', 90, 7);
    train('2026-10-01', 60, 5);
    expect(weeklyLoads(store.load().training, '2026-10-09')).toEqual([0, 0, 300, 630]);
  });

  it('flags a big jump, stacked hard days and short sleep before a hard day', () => {
    for (const d of ['2026-09-14', '2026-09-21', '2026-09-28']) train(d, 60, 5); // 300 a week
    for (const d of ['2026-10-07', '2026-10-08', '2026-10-09']) train(d, 90, 8); // 2160 this week
    store.addSleep({ bed: '1', wake: '7', date: '2026-10-08' });
    const doc = store.load();
    const f = flags(doc.training, doc.sleep, doc.pain, '2026-10-09').map((x) => x.kind);
    expect(f).toEqual(expect.arrayContaining(['jump', 'stacked', 'shortSleep']));
  });

  it('puts a logged head knock first', () => {
    store.addPain({ where: 'head', severity: 3, note: 'clashed heads at practice', date: '2026-10-08' });
    const doc = store.load();
    expect(flags(doc.training, doc.sleep, doc.pain, '2026-10-09')[0].kind).toBe('head');
  });
});

describe("Health's number: nights over 8 hours", () => {
  it('counts the last 7 nights and gives the chart', () => {
    store.addSleep({ bed: '22:00', wake: '7:00', date: '2026-10-09' });
    store.addSleep({ bed: '23:30', wake: '7:00', date: '2026-10-08' });
    store.addSleep({ bed: '22:30', wake: '7:00', date: '2026-10-01' }); // older than a week
    const n = healthNumber([], store.load().sleep, '2026-10-09');
    expect(n).toMatchObject({ nightsOver8: 1, nightsLogged: 2 });
    expect(n.nights).toEqual([null, null, null, null, null, 7.5, 9]);
  });

  it('readiness: short sleep or very sore means an easy day', () => {
    expect(readiness({ hours: 5.5 } as never, undefined).level).toBe('rest');
    expect(readiness({ hours: 7.5 } as never, { soreness: 2, energy: 4 } as never).level).toBe('easy');
    expect(readiness({ hours: 9 } as never, { energy: 4 } as never).level).toBe('good');
    expect(readiness(undefined, undefined).level).toBe('unknown');
  });
});

describe('food', () => {
  it('estimates from words, with amounts, and never invents what it does not know', () => {
    const r = foods.estimate('2 eggs, toast, glass of milk and a dragonfruit smoothie bowl thing');
    expect(r.items.map((i) => i.name)).toEqual(['egg', 'toast', 'milk', 'smoothie']);
    expect(r.items[0].nutrients.protein_g).toBeCloseTo(12.6);
    expect(foods.estimate('quinoa-kale fusion').unknown).toEqual(['quinoa-kale fusion']);
  });

  it('prefers the longer name ("chicken wrap" is not just chicken)', () => {
    expect(foods.lookupFood('a chicken wrap')?.name).toBe('chicken wrap');
    expect(foods.lookupFood('chocolate milk')?.name).toBe('chocolate milk');
  });

  it('knows the home cooking too', () => {
    expect(foods.estimate('dal, rice, 2 roti, sabzi').unknown).toEqual([]);
  });

  it('measures a day against the targets for boys 14-18, never calories', () => {
    const t = foods.totals([{ items: foods.estimate('2 eggs, toast, banana').items }]);
    expect(t).not.toHaveProperty('kcal');
    const short = foods.shortfalls(t).map((s) => s.key);
    expect(short).toEqual(expect.arrayContaining(['calcium_mg', 'vitd_ug']));
  });

  it('checks a barcode before asking anyone about it', () => {
    expect(foods.validBarcode('4006381333931')).toBe(true);
    expect(foods.validBarcode('4006381333932')).toBe(false);
    expect(foods.validBarcode('036000291452')).toBe(true); // UPC-A
  });

  it("turns Open Food Facts' grams into mg and ug, per serving", () => {
    const item = foods.fromOpenFoodFacts({ product_name: 'Yogurt', brands: 'Example', serving_size: '175 g', nutriments: { proteins_serving: 8, iron_serving: 0.0002, calcium_serving: 0.25, 'vitamin-d_serving': 0.0000025 } });
    expect(item).toMatchObject({ name: 'Example Yogurt', exact: true, nutrients: { protein_g: 8, iron_mg: 0.2, calcium_mg: 250, vitd_ug: 2.5 } });
  });

  it('a usual meal is saved once and found by how he says it', () => {
    store.saveUsual('usual breakfast', foods.estimate('2 eggs, toast').items);
    expect(store.findUsual('my usual breakfast')?.name).toBe('usual breakfast');
  });
});

describe('what a Health agent reads first', () => {
  it('says plainly when nothing is logged', () => {
    expect(snapshotText(snapshot(day('2026-10-09')))).toMatch(/nothing logged before this message/);
  });

  it('gives the week from real logs', () => {
    store.addSleep({ bed: '22:00', wake: '7:00' }, day('2026-10-09'));
    store.addTraining({ kind: 'soccer', minutes: 90, effort: 7 }, day('2026-10-09'));
    const text = snapshotText(snapshot(day('2026-10-09')));
    expect(text).toContain('1 of 1 logged nights had 8+ hours');
    expect(text).toContain('1 session logged, load 630');
  });
});

describe('the hard rules, in code', () => {
  it('cut calories to lose weight -> fuel, not diet', () => {
    const r = enforceHealthSafety('how do I cut calories to lose weight fast', 'Eat 1200 calories a day.');
    expect(r.applied).toContain('diet');
    expect(r.text).toMatch(/^I won't help with cutting calories/);
  });

  it('my knee is swollen -> stop and tell an adult', () => {
    expect(enforceHealthSafety('my knee is swollen after the game', 'Ice it.').text).toMatch(/tell a parent, your coach or a physio/);
  });

  it('a head knock -> tell an adult today', () => {
    expect(triggeredRules('I hit my head on the post at practice').map((r) => r.id)).toContain('head');
    expect(triggeredRules('I scored a header').map((r) => r.id)).not.toContain('head');
  });

  it('pre-workout, creatine and energy drinks -> no', () => {
    for (const ask of ['should I take pre-workout', 'is creatine good for soccer', 'can I have a red bull before the game']) {
      expect(enforceHealthSafety(ask, 'Sure.').applied).toContain('supplements');
    }
  });

  it('chest pain -> an adult right now', () => {
    expect(enforceHealthSafety('I get chest pain when I sprint', 'Warm up more.').text).toMatch(/^Chest pain, fainting or trouble breathing/);
  });

  it('no one-rep max', () => {
    expect(enforceHealthSafety('how do I test my 1RM on squat', 'Load the bar.').applied).toContain('maxLift');
  });

  it('an answer that already says it is not repeated, and ordinary questions are left alone', () => {
    expect(enforceHealthSafety('my ankle is swollen', 'Stop and tell your coach or a parent today.').applied).toEqual([]);
    expect(enforceHealthSafety('what is the capital of peru', 'Lima.').text).toBe('Lima.');
    expect(enforceHealthSafety('it is -10 celsius out, what should I wear to practice', 'Layers.').applied).toEqual([]);
  });
});

describe('routing', () => {
  it('sends something unmistakably for Health straight there', async () => {
    const { clearlyFor } = await import('../route');
    for (const t of ['I slept from 10:30 last night to 7 this morning', 'practice was 90 min, effort 8', 'I had a chicken wrap for lunch', 'my knee is sore after the game', 'how did I sleep this week?', 'Asclepius, should I train today?']) expect(clearlyFor(t), t).toBe('health');
    for (const t of ['I am training a model in python', 'that bug is a pain point', 'what food is Calgary known for', 'should I go to the game tonight']) expect(clearlyFor(t), t).toBeNull();
  });

  it('sends health talk to Health, and leaves the rest', () => {
    for (const t of ['slept 11:30 to 7', 'practice was brutal, legs sore', 'what should I eat before a game', 'my knee hurts']) expect(departmentFor(t), t).toBe('health');
    for (const t of ['what is the capital of peru', 'make me a google doc about volcanoes', 'who won the flames game']) expect(departmentFor(t), t).toBeNull();
  });
});
