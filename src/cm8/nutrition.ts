/**
 * CM8's nutrition engine, ported to TypeScript.
 *
 * The tables live in foods.ts (serialised from CM8's own runtime). This file is
 * the logic: how text becomes items, how items become a day, and how a day
 * becomes advice. Behaviour is deliberately identical to CM8 - including the
 * two rules that matter most:
 *
 *   1. A drink is never handed a meal verdict. Coffee is not a bad meal; it is
 *      not a meal at all.
 *   2. Advice is computed from the whole day, not the plate in front of it, so
 *      logging a coffee cannot reset what breakfast already covered.
 */
import { FOODS, type FoodRow, type FoodCat } from './foods';

export const CAT = {
  PRO: 'protein', CARB: 'carb', PROD: 'produce', DAIRY: 'dairy',
  FAT: 'fat', TREAT: 'treat', DRINK: 'drink',
} as const;

export interface ParsedItem {
  name: string;
  cat: FoodCat;
  unit: string;
  servings: number;
  kcal: number; p: number; c: number; f: number;
  fib: number; ca: number; fe: number; vc: number;
  caf: number; fluid: number;
}
export interface Parsed { items: ParsedItem[]; unknown: string[] }

export interface Totals {
  kcal: number; p: number; c: number; f: number;
  fib: number; ca: number; fe: number; vc: number;
  caf: number; fluid: number; treatKcal: number;
}

export interface Targets {
  kcal: number; p: number; c: number;
  fib: number; ca: number; fe: number; vc: number;
  fluid: number; cafMax: number;
}

export type TrainingLoad = 'rest' | 'light' | 'full' | 'match';
export type MealType = 'Breakfast' | 'Lunch' | 'Dinner' | 'Snack' | 'Post-training';
export type EntryKind = 'meal' | 'snack' | 'drink';

export interface Ctx {
  mealType: MealType;
  training: TrainingLoad;
  weightKg: number;
}

/* Longest names first so "chocolate milk" wins over "milk". */
const INDEX: { n: string; f: FoodRow }[] = [];
for (const f of FOODS) for (const n of f.names) INDEX.push({ n, f });
INDEX.sort((a, b) => b.n.length - a.n.length);

const WORD_NUM: Record<string, number> = {
  a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6,
  half: 0.5, couple: 2, few: 3,
};
const SIZERS: [RegExp, number][] = [
  [/\b(extra large|xl|huge|massive)\b/, 1.8],
  [/\b(large|big|double|loaded)\b/, 1.4],
  [/\b(medium|regular|normal)\b/, 1],
  [/\b(small|little|mini|half)\b/, 0.6],
  [/\b(bowl|plate) of\b/, 1.5],
  [/\b(handful|snack) of\b/, 0.6],
];
// "light" means milk in a coffee, not a smaller cup.
const LIGHT = /\blight\b/;

/** Split on the words people actually use to join foods. */
function segments(text: string): string[] {
  return String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9/.\s]/g, ' ')
    .split(/\s*(?:,|\band\b|\bwith\b|\bplus\b|\bside of\b|\btopped with\b|\bon\b)\s*/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function quantityIn(seg: string, food: FoodRow): { qty: number; mult: number } {
  let qty: number | null = null;
  let mult = 1;
  const frac = seg.match(/\b(\d+)\s*\/\s*(\d+)\b/);
  const num = seg.match(/\b(\d+(?:\.\d+)?)\b/);
  if (frac) qty = Number(frac[1]) / Number(frac[2]);
  else if (num) qty = Number(num[1]);
  else {
    for (const w of Object.keys(WORD_NUM)) {
      if (new RegExp('\\b' + w + '\\b').test(seg)) { qty = WORD_NUM[w]; break; }
    }
  }
  for (const [re, m] of SIZERS) if (re.test(seg)) { mult = m; break; }
  if (mult === 1 && LIGHT.test(seg) && food.cat !== CAT.DRINK) mult = 0.6;

  const grams = seg.match(/\b(\d+)\s*g\b/);
  if (grams && /100g|50g|30g/.test(food.unit)) qty = Number(grams[1]) / parseFloat(food.unit);
  return { qty: qty === null ? food.qty : qty, mult };
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function parse(text: string): Parsed {
  const items: ParsedItem[] = [];
  const unknown: string[] = [];
  for (const seg of segments(text)) {
    const hit = INDEX.find((x) => new RegExp('(^|\\s)' + escapeRe(x.n) + '(s|es)?(\\s|$)').test(seg));
    if (!hit) {
      const meaningful = seg
        .replace(/\b(some|a|an|the|of|my|for|had|ate|drank|bit|lot|today|then|later)\b/g, '')
        .trim();
      if (meaningful.length > 2) unknown.push(seg);
      continue;
    }
    const { qty, mult } = quantityIn(seg, hit.f);
    const servings = Math.max(0.25, Math.min(12, qty * mult));
    const f = hit.f;
    items.push({
      name: hit.n, cat: f.cat, unit: f.unit, servings,
      kcal: f.kcal * servings, p: f.p * servings, c: f.c * servings, f: f.f * servings,
      fib: f.fib * servings, ca: f.ca * servings, fe: f.fe * servings, vc: f.vc * servings,
      caf: f.caf * servings, fluid: f.fluid * servings,
    });
  }
  return { items, unknown };
}

const KEYS = ['kcal', 'p', 'c', 'f', 'fib', 'ca', 'fe', 'vc', 'caf', 'fluid', 'treatKcal'] as const;

export function sum(list: Array<Partial<Totals> & { cat?: FoodCat; kcal?: number }>): Totals {
  const t = {} as Totals;
  for (const k of KEYS) t[k] = 0;
  for (const i of list) {
    for (const k of KEYS) t[k] += Number(i[k] ?? 0);
    if (i.cat === CAT.TREAT) t.treatKcal += Number(i.kcal ?? 0);
  }
  for (const k of KEYS) t[k] = Math.round(t[k] * 10) / 10;
  return t;
}

/**
 * What a 14-year-old playing centre mid needs in a day. Protein and carbohydrate
 * scale with body mass and how hard the day is; calcium and iron are the
 * adolescent reference intakes, which matter more during a growth spurt than
 * anything else here.
 */
export function targets(ctx: Pick<Ctx, 'training' | 'weightKg'>): Targets {
  const kg = ctx.weightKg || 55;
  const load = ctx.training || 'full';
  const carbPerKg = load === 'match' ? 7 : load === 'full' ? 6 : load === 'light' ? 5 : 4;
  const activity = load === 'match' ? 1.95 : load === 'full' ? 1.85 : load === 'light' ? 1.65 : 1.5;
  const bmr = 17.7 * kg + 657; // Schofield, boys 10-17
  return {
    kcal: Math.round((bmr * activity) / 10) * 10,
    p: Math.round(1.6 * kg),
    c: Math.round(carbPerKg * kg),
    fib: 30, ca: 1300, fe: 11, vc: 75,
    fluid: 2500 + (load === 'rest' ? 0 : load === 'light' ? 500 : load === 'match' ? 1200 : 1000),
    cafMax: Math.round(2.5 * kg),
  };
}

export function classify(parsed: Parsed, mealType: MealType): EntryKind {
  const t = sum(parsed.items);
  const allDrink = parsed.items.length > 0 && parsed.items.every((i) => i.cat === CAT.DRINK);
  if (allDrink && t.kcal < 250) return 'drink';
  if (mealType === 'Snack' || (t.kcal > 0 && t.kcal < 250)) return 'snack';
  return 'meal';
}

const clamp = (x: number) => Math.max(0, Math.min(1, x));

/** A meal is scored against the share of the day it ought to carry. */
export function scoreMeal(t: Totals, tg: Targets): number {
  const share = 0.28;
  const pr = clamp(t.p / (share * tg.p));
  const cr = clamp(t.c / (share * tg.c));
  const prod = clamp((clamp(t.fib / 8) + clamp(t.vc / 30)) / 2);
  const treatShare = t.kcal > 0 ? clamp(t.treatKcal / t.kcal) : 0;
  return Math.round(Math.max(0, Math.min(100, 34 * pr + 30 * cr + 24 * prod + 12 * (1 - treatShare))));
}

/* ---------- the day, not the plate ---------- */

export const SUGGEST: Record<string, string[]> = {
  p: ['Greek yogurt tub — 17g', 'Two eggs — 13g', 'Glass of milk — 8g', 'Chicken in your next plate — 31g'],
  c: ['Bowl of rice or pasta', 'Two slices of toast', 'A banana', 'Bagel with peanut butter'],
  ca: ['Glass of milk — 300mg', 'Greek yogurt', '30g of cheese'],
  fe: ['Red meat at dinner', 'Lentils or beans', 'Fortified cereal with orange juice — the vitamin C roughly doubles how much iron you absorb'],
  vc: ['An orange', 'A cup of berries', 'Peppers in your wrap'],
  fib: ['A cup of berries', 'Beans or lentils', 'Leave the skin on the potato'],
  fluid: ['500ml of water now', 'Fill a bottle and keep it on your desk'],
};
const LABEL: Record<string, string> = {
  kcal: 'energy', p: 'protein', c: 'carbs', fib: 'fibre',
  ca: 'calcium', fe: 'iron', vc: 'vitamin C', fluid: 'fluid',
};
const UNIT: Record<string, string> = {
  kcal: 'kcal', p: 'g', c: 'g', fib: 'g', ca: 'mg', fe: 'mg', vc: 'mg', fluid: 'ml',
};

export interface Gap {
  key: string; label: string; unit: string;
  have: number; target: number; left: number; pct: number;
}

export interface DayEntryLike { n?: Partial<Totals>; kind?: EntryKind }

export interface DayRead {
  totals: Totals;
  targets: Targets;
  pct: Record<string, number>;
  gaps: Gap[];
  mealsLogged: number;
  caffeine: number;
  cutoff: number;
}

/**
 * Bedtime drives the caffeine cutoff. Supplied by the caller (the planner knows
 * the real wake target) so the two features agree instead of guessing apart.
 */
export function defaultBedtime(wakeTarget?: string): number {
  if (wakeTarget) {
    const [h, m] = wakeTarget.split(':').map(Number);
    if (!Number.isNaN(h) && !Number.isNaN(m)) {
      return (((h * 60 + m - (15 + 6 * 90)) % 1440) + 1440) % 1440;
    }
  }
  return 21 * 60 + 45;
}

export function dayRead(entries: DayEntryLike[], ctx: Ctx, wakeTarget?: string): DayRead {
  const tg = targets(ctx);
  const t = sum((entries || []).map((e) => e.n || {}));
  const pct: Record<string, number> = {};
  for (const k of ['kcal', 'p', 'c', 'fib', 'ca', 'fe', 'vc', 'fluid'] as const) {
    pct[k] = tg[k] ? Math.round((100 * t[k]) / tg[k]) : 0;
  }
  const gaps: Gap[] = (['p', 'c', 'ca', 'fe', 'vc', 'fib', 'fluid'] as const)
    .map((k) => ({
      key: k, label: LABEL[k], unit: UNIT[k],
      have: t[k], target: tg[k],
      left: Math.max(0, Math.round(tg[k] - t[k])),
      pct: pct[k],
    }))
    .filter((g) => g.pct < 100)
    .sort((a, b) => a.pct - b.pct);

  return {
    totals: t, targets: tg, pct, gaps,
    mealsLogged: (entries || []).filter((e) => e.kind !== 'drink').length,
    caffeine: t.caf,
    cutoff: defaultBedtime(wakeTarget) - 360,
  };
}

export interface EntryRead {
  kind: EntryKind;
  totals: Totals;
  unknown: string[];
  items: ParsedItem[];
  before: DayRead;
  after: DayRead;
  notes: string[];
  score: number | null;
  headline: string;
  body: string;
  verdictClass?: 'good' | 'mid' | 'low';
  verdictWord?: string;
  caffeineCutoff?: number;
}

export function readEntry(parsed: Parsed, ctx: Ctx, prior: DayEntryLike[], wakeTarget?: string): EntryRead {
  const t = sum(parsed.items);
  const kind = classify(parsed, ctx.mealType);
  const before = dayRead(prior, ctx, wakeTarget);
  const after = dayRead((prior || []).concat([{ n: t, kind }]), ctx, wakeTarget);

  const out: EntryRead = {
    kind, totals: t, unknown: parsed.unknown, items: parsed.items,
    before, after, notes: [], score: null, headline: '', body: '',
  };

  if (kind === 'drink') {
    out.headline = t.caf > 0 ? 'Logged as a drink — no meal verdict needed' : 'Logged as a drink';
    out.body = 'This is a drink, not a plate, so it does not count against your meal quality. '
      + 'What it does count towards is your fluid, and anything else it carries.';
    if (t.fluid) {
      out.notes.push('Adds ' + Math.round(t.fluid) + 'ml of fluid — you are at '
        + Math.round(after.totals.fluid) + 'ml of ' + after.targets.fluid + 'ml today.');
    }
    if (t.caf > 0) {
      out.notes.push('Caffeine: about ' + Math.round(t.caf) + 'mg. Day total '
        + Math.round(after.caffeine) + 'mg of a sensible ceiling of ' + after.targets.cafMax + 'mg for your size.');
      out.caffeineCutoff = after.cutoff;
    }
    if (t.c >= 25 && t.fib < 1) {
      out.notes.push('That is a sugary drink. Fine occasionally, but it is fuel without anything attached to it.');
    }
  } else {
    const s = scoreMeal(t, targets(ctx));
    out.score = s;
    out.verdictClass = s >= 70 ? 'good' : s >= 45 ? 'mid' : 'low';
    out.verdictWord = s >= 80 ? 'Properly fuelled' : s >= 70 ? 'Strong plate' : s >= 45 ? 'Half a meal' : 'Underfuelled';
    out.headline = out.verdictWord;
    out.body = s >= 70 ? "That is the shape a centre mid's plate should have."
      : s >= 45 ? 'Something real is missing here — it will not carry a full session on its own.'
        : 'This will not hold up for the running you do in the middle of the park.';
    if (kind === 'snack') out.body = 'Logged as a snack, and judged as one — it only has to do part of the job.';
  }
  return out;
}

export interface NextMove { nextLabel: string; headline: string; body: string; ideas: string[] }

/** What to eat next, chosen from what the DAY is short of. */
export function nextMove(read: EntryRead, ctx: Ctx): NextMove {
  const gaps = read.after.gaps.filter((g) => g.key !== 'fluid');
  const byMeal: Record<string, string> = {
    Breakfast: 'lunch',
    Lunch: ctx.training === 'rest' ? 'dinner' : 'your pre-training snack',
    Dinner: 'an evening snack',
    'Post-training': 'dinner',
    Snack: 'your next meal',
  };
  const nextLabel = byMeal[ctx.mealType] || 'your next meal';

  if (!gaps.length) {
    return {
      nextLabel,
      headline: 'You are on target for the day',
      body: 'Everything that matters is covered. Eat normally from here and keep the water going.',
      ideas: ['Water with every meal', 'Normal dinner, nothing special needed'],
    };
  }
  const top = gaps.slice(0, 2);
  // The day's remaining gap is not one meal's job. Ask the next meal for a
  // realistic share of it, or the number reads as impossible and gets ignored.
  const SHARE = 0.4;
  const perMeal = (g: Gap) => Math.max(1, Math.round(g.left * SHARE));
  return {
    nextLabel,
    headline: 'Aim ' + nextLabel + ' at ' + top.map((g) => g.label).join(' and '),
    body: 'For the day you are at '
      + top.map((g) => Math.round(g.have) + ' of ' + g.target + g.unit + ' ' + g.label).join(' and ')
      + '. Make ' + nextLabel + ' carry about '
      + top.map((g) => perMeal(g) + g.unit + ' of ' + g.label).join(' and ')
      + ' and the rest follows across the day — this is the gap continuing, not a fresh start.',
    ideas: (SUGGEST[top[0].key] || []).slice(0, 3),
  };
}
