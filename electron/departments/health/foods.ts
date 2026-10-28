import type { FoodEntry, FoodItem, Nutrients } from './store';

/*
 * Food, for fuelling and micronutrients - never calories or weight (the "fuel, not diet" rule).
 * Three ways in, from rough to exact:
 *  - words ("chicken wrap, apple") estimated from the common-food table below;
 *  - a nutrition label read from a photo, or a barcode looked up on Open Food Facts (free, no key);
 *  - a "usual meal" saved once with real amounts.
 * Estimates are for patterns across a week, and are always labelled as estimates. A word the
 * table does not know is kept as unknown - never given made-up numbers.
 */

type Row = [names: string[], serving: string, protein: number, carbs: number, fibre: number, iron: number, calcium: number, vitd: number, fruitveg: number];

// Per typical serving. Approximate values (USDA FoodData Central / Canadian Nutrient File), rounded.
const TABLE: Row[] = [
  // Breakfast
  [['egg', 'eggs', 'boiled egg', 'scrambled eggs', 'fried egg', 'omelette', 'omelet'], '1 egg', 6.3, 0.4, 0, 0.9, 28, 1.1, 0],
  [['toast', 'whole wheat bread', 'brown bread'], '1 slice', 4, 12, 2, 0.8, 50, 0, 0],
  [['bread', 'white bread', 'white toast'], '1 slice', 2.6, 13, 0.8, 0.9, 40, 0, 0],
  [['bagel'], '1 bagel', 10, 55, 2.3, 3.5, 20, 0, 0],
  [['cereal', 'cheerios', 'corn flakes', 'frosted flakes', 'bran flakes', 'muesli'], '1 cup', 3, 22, 3, 4, 20, 0, 0],
  [['oatmeal', 'oats', 'porridge'], '1 cup cooked', 6, 27, 4, 2.1, 21, 0, 0],
  [['granola'], '1/2 cup', 6, 32, 4, 1.8, 40, 0, 0],
  [['pancake', 'pancakes'], '2 pancakes', 5, 30, 1, 1.5, 100, 0, 0],
  [['waffle', 'waffles'], '1 waffle', 3, 15, 0.7, 1.4, 100, 0, 0],
  [['peanut butter'], '2 tbsp', 7, 7, 2, 0.6, 15, 0, 0],
  // Dairy
  [['milk', 'glass of milk'], '1 cup (250 ml)', 8.5, 12, 0, 0.1, 300, 2.5, 0],
  [['chocolate milk'], '1 cup', 8, 26, 1, 0.6, 290, 2.5, 0],
  [['yogurt', 'yoghurt'], '175 g', 8, 16, 0, 0.1, 250, 0, 0],
  [['greek yogurt', 'greek yoghurt'], '175 g', 15, 7, 0, 0.1, 170, 0, 0],
  [['cheese', 'cheddar'], '30 g', 7, 0.4, 0, 0.2, 200, 0.2, 0],
  [['paneer'], '100 g', 18, 3, 0, 0.2, 200, 0, 0],
  [['ice cream'], '1/2 cup', 2.3, 16, 0.5, 0.1, 85, 0.1, 0],
  // Fruit
  [['banana'], '1 banana', 1.3, 27, 3.1, 0.3, 6, 0, 1],
  [['apple'], '1 apple', 0.5, 25, 4.4, 0.2, 11, 0, 1],
  [['orange', 'clementine', 'mandarin'], '1 orange', 1.2, 15, 3, 0.1, 52, 0, 1],
  [['berries', 'strawberries', 'blueberries', 'raspberries'], '1 cup', 1, 14, 3, 0.5, 20, 0, 1],
  [['grapes'], '1 cup', 1.1, 27, 1.4, 0.5, 15, 0, 1],
  [['orange juice', 'juice', 'apple juice'], '1 cup', 1.7, 26, 0.5, 0.5, 27, 0, 1],
  [['smoothie'], '1 glass', 6, 40, 3, 0.6, 150, 0, 1.5],
  [['fruit'], '1 piece', 1, 20, 3, 0.3, 20, 0, 1],
  // Vegetables
  [['broccoli'], '1 cup', 2.6, 6, 2.4, 0.7, 43, 0, 1],
  [['spinach'], '1/2 cup cooked', 2.7, 3.4, 2.2, 3.2, 122, 0, 1],
  [['salad', 'greens', 'lettuce'], '2 cups', 2, 7, 2.5, 1, 40, 0, 1],
  [['carrots', 'carrot', 'baby carrots'], '1 cup', 0.6, 8, 2.3, 0.2, 25, 0, 1],
  [['corn'], '1 cob', 3.5, 19, 2, 0.5, 3, 0, 1],
  [['peas'], '1/2 cup', 4, 11, 4, 1.2, 20, 0, 1],
  [['potato', 'baked potato', 'mashed potatoes'], '1 medium', 4.3, 37, 4, 1.9, 26, 0, 1],
  [['sweet potato'], '1 medium', 2, 24, 3.8, 0.8, 43, 0, 1],
  [['vegetables', 'veggies', 'veg', 'mixed vegetables'], '1/2 cup', 1.5, 6, 2, 0.5, 25, 0, 1],
  [['sabzi', 'vegetable curry', 'veg curry'], '1 cup', 3, 15, 4, 1.5, 60, 0, 1.5],
  // Grains and mains
  [['rice', 'white rice'], '1 cup cooked', 4.3, 45, 0.6, 0.8, 16, 0, 0],
  [['brown rice'], '1 cup cooked', 5, 45, 3.5, 0.8, 20, 0, 0],
  [['pasta', 'spaghetti', 'noodles', 'macaroni'], '1 cup cooked', 8, 43, 2.5, 1.8, 10, 0, 0],
  [['spaghetti and meat sauce', 'spaghetti bolognese', 'bolognese', 'lasagna'], '1 plate', 25, 70, 6, 4.5, 80, 0, 1],
  [['mac and cheese', 'mac n cheese', 'kraft dinner'], '1 cup', 13, 47, 2, 1.8, 250, 0, 0],
  [['ramen', 'instant noodles', 'cup noodles'], '1 pack', 9, 52, 2, 4, 20, 0, 0],
  [['chicken', 'chicken breast', 'grilled chicken', 'roast chicken'], '100 g', 31, 0, 0, 1, 15, 0.1, 0],
  [['chicken wrap', 'wrap'], '1 wrap', 25, 40, 3, 2.5, 100, 0.1, 0.5],
  [['sandwich', 'sub', 'ham sandwich', 'turkey sandwich', 'grilled cheese'], '1 sandwich', 15, 35, 3, 2.5, 100, 0.2, 0.5],
  [['burger', 'hamburger', 'cheeseburger'], '1 burger', 25, 33, 2, 3.5, 100, 0.2, 0],
  [['steak', 'beef', 'ground beef'], '100 g', 26, 0, 0, 2.6, 18, 0.1, 0],
  [['pork', 'pork chop'], '100 g', 27, 0, 0, 0.8, 20, 0.6, 0],
  [['salmon'], '100 g', 25, 0, 0, 0.5, 12, 11, 0],
  [['tuna'], '1/2 can', 20, 0, 0, 1.3, 10, 1, 0],
  [['fish'], '100 g', 22, 0, 0, 0.5, 20, 3, 0],
  [['shrimp', 'prawns'], '100 g', 24, 0, 0, 0.5, 70, 0, 0],
  [['tofu'], '100 g', 15, 3, 2, 2.7, 350, 0, 0],
  [['pizza', 'pepperoni pizza', 'cheese pizza'], '1 slice', 12, 36, 2.5, 2.6, 190, 0.1, 0],
  [['tacos', 'taco'], '2 tacos', 18, 30, 4, 2.5, 150, 0.1, 0.5],
  [['burrito'], '1 burrito', 22, 70, 9, 4, 200, 0.1, 0.5],
  [['sushi'], '8 pieces', 12, 50, 2, 1, 30, 1, 0],
  [['stir fry', 'stir-fry'], '1 plate', 30, 60, 4, 3, 80, 0.1, 1.5],
  [['curry', 'butter chicken', 'chicken curry'], '1 cup', 25, 10, 2, 2, 80, 0.2, 0.5],
  [['soup', 'chicken noodle soup'], '1 bowl', 6, 15, 1, 1.2, 15, 0, 0.5],
  [['hot dog'], '1 hot dog', 11, 24, 1, 2, 60, 0.2, 0],
  [['chicken nuggets', 'nuggets'], '6 pieces', 15, 16, 1, 0.8, 10, 0, 0],
  [['fries', 'french fries'], 'medium', 4, 48, 4.5, 1, 18, 0, 0],
  [['dal', 'daal', 'lentils', 'lentil soup'], '1 cup', 18, 40, 16, 6.6, 38, 0, 0],
  [['rajma', 'kidney beans'], '1 cup', 15, 40, 12, 4, 60, 0, 0],
  [['chole', 'chana', 'chickpeas', 'chickpea curry'], '1 cup', 13, 42, 11, 4.5, 80, 0, 0],
  [['beans', 'black beans', 'baked beans'], '1 cup', 15, 41, 15, 3.6, 46, 0, 0],
  [['hummus'], '1/4 cup', 5, 9, 3.5, 1.5, 30, 0, 0],
  [['roti', 'chapati'], '1 roti', 3, 18, 3, 1, 10, 0, 0],
  [['naan'], '1 naan', 9, 50, 2, 3, 80, 0, 0],
  [['paratha'], '1 paratha', 5, 30, 4, 1.5, 20, 0, 0],
  [['dosa'], '1 dosa', 4, 30, 1, 1, 20, 0, 0],
  [['idli'], '2 idli', 4, 24, 1.5, 0.8, 10, 0, 0],
  [['poha'], '1 cup', 4, 40, 2, 2.5, 15, 0, 0.5],
  [['upma'], '1 cup', 5, 35, 3, 1.5, 20, 0, 0.5],
  // Snacks
  [['almonds', 'nuts', 'trail mix'], '1/4 cup', 7, 7, 4, 1.3, 96, 0, 0],
  [['granola bar'], '1 bar', 2, 19, 1.5, 0.7, 15, 0, 0],
  [['crackers'], '1 serving', 2, 20, 1, 1.2, 20, 0, 0],
  [['chips', 'crisps'], '1 small bag', 2, 15, 1, 0.4, 7, 0, 0],
  [['cookies', 'cookie'], '2 cookies', 1.5, 20, 0.6, 0.8, 10, 0, 0],
  [['chocolate', 'chocolate bar'], '1 bar', 3, 30, 2, 1.5, 50, 0, 0],
  [['popcorn'], '3 cups', 3, 19, 3.5, 0.9, 2, 0, 0],
  [['muffin'], '1 muffin', 5, 50, 1.5, 1.5, 50, 0, 0],
  [['string cheese', 'cheese stick'], '1 stick', 7, 1, 0, 0, 200, 0, 0],
  [['cottage cheese'], '1/2 cup', 12, 4, 0, 0.1, 70, 0, 0],
  [['edamame'], '1/2 cup', 9, 7, 4, 1.8, 50, 0, 1],
  [['avocado', 'guacamole'], '1/2 avocado', 2, 9, 7, 0.6, 12, 0, 1],
  // More fruit and veg
  [['mango'], '1 cup', 1.4, 25, 2.6, 0.3, 18, 0, 1],
  [['watermelon', 'melon', 'cantaloupe'], '2 cups', 1.8, 23, 1.2, 0.7, 21, 0, 1],
  [['pear'], '1 pear', 0.6, 27, 5.5, 0.3, 15, 0, 1],
  [['kiwi'], '2 kiwis', 2, 20, 4, 0.4, 46, 0, 1],
  [['tomato', 'tomatoes', 'cucumber', 'peppers', 'bell pepper'], '1 cup', 1, 5, 1.5, 0.4, 14, 0, 1],
  // More mains
  [['turkey', 'ham', 'deli meat'], '50 g', 9, 1, 0, 0.5, 5, 0, 0],
  [['bacon'], '3 slices', 9, 0.3, 0, 0.3, 4, 0.2, 0],
  [['sausage', 'sausages'], '2 links', 10, 1, 0, 0.6, 10, 0.3, 0],
  [['chicken wings', 'wings'], '6 wings', 30, 2, 0, 1.5, 30, 0.2, 0],
  [['chicken caesar salad', 'caesar salad'], '1 bowl', 25, 12, 3, 2, 150, 0.2, 1],
  [['peanut butter sandwich', 'pb and j', 'peanut butter and jelly'], '1 sandwich', 12, 45, 4, 2.5, 80, 0, 0.3],
  [['shawarma', 'donair', 'gyro'], '1 wrap', 28, 45, 3, 3, 80, 0.1, 0.5],
  [['poutine'], '1 regular', 15, 70, 6, 2.5, 250, 0.2, 0],
  [['fried rice'], '1 cup', 7, 40, 1.5, 1.5, 30, 0.2, 0.3],
  [['pho'], '1 bowl', 30, 60, 2, 4, 60, 0, 0.5],
  [['spring rolls', 'spring roll', 'egg rolls'], '2 rolls', 6, 30, 2, 1, 20, 0, 0.5],
  [['quinoa'], '1 cup cooked', 8, 39, 5, 2.8, 31, 0, 0],
  [['soy milk', 'fortified soy milk', 'oat milk', 'almond milk'], '1 cup', 7, 4, 1, 1, 300, 2.5, 0],
  // More Indian dishes
  [['biryani', 'chicken biryani'], '1 plate', 25, 70, 3, 2.5, 60, 0.1, 0.5],
  [['chicken tikka', 'tandoori chicken', 'tikka'], '100 g', 27, 3, 0.5, 1.2, 40, 0.1, 0],
  [['palak paneer', 'saag paneer', 'saag'], '1 cup', 14, 12, 4, 3.5, 350, 0, 1],
  [['aloo gobi', 'aloo sabzi', 'bhindi'], '1 cup', 4, 22, 5, 1.2, 40, 0, 1.5],
  [['pav bhaji'], '1 plate', 9, 65, 7, 3, 80, 0, 1.5],
  [['khichdi'], '1 cup', 9, 40, 5, 2, 40, 0, 0.3],
  [['raita'], '1/2 cup', 4, 5, 0.5, 0.1, 140, 0, 0.3],
  [['lassi', 'mango lassi'], '1 glass', 8, 30, 0, 0.1, 280, 0.5, 0],
  [['samosa', 'samosas'], '1 samosa', 4, 24, 2, 1.2, 20, 0, 0.3],
];

const WORD_NUMS: Record<string, number> = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, half: 0.5, couple: 2, few: 3 };

export interface TableMatch { name: string; serving: string; nutrients: Nutrients }

const nutrientsOf = (r: Row, q = 1): Nutrients => ({
  protein_g: r[2] * q, carbs_g: r[3] * q, fibre_g: r[4] * q, iron_mg: r[5] * q, calcium_mg: r[6] * q, vitd_ug: r[7] * q, fruitveg: r[8] * q,
});

/** The longest table name inside a piece of text ("chicken wrap" beats "chicken"). */
export function lookupFood(text: string): TableMatch | null {
  const t = ` ${text.toLowerCase().replace(/[^a-z\s-]/g, ' ').replace(/\s+/g, ' ')} `;
  let best: { row: Row; len: number } | null = null;
  for (const row of TABLE) {
    for (const n of row[0]) {
      if (t.includes(` ${n} `) && (!best || n.length > best.len)) best = { row, len: n.length };
    }
  }
  return best ? { name: best.row[0][0], serving: best.row[1], nutrients: nutrientsOf(best.row) } : null;
}

/** "2 eggs", "two slices of toast", "half a bagel" - how many servings. */
export function quantityOf(part: string): number {
  const m = /^\s*(\d+(?:\.\d+)?|a|an|one|two|three|four|five|six|half|couple|few)\b/i.exec(part);
  if (!m) return 1;
  const n = Number(m[1]);
  const q = Number.isFinite(n) ? n : WORD_NUMS[m[1].toLowerCase()] ?? 1;
  return Math.min(6, Math.max(0.25, q));
}

/** Table foods matching what he is typing - names that start with it first, then ones that contain it. */
export function searchFoods(q: string, limit = 8): TableMatch[] {
  const want = q.toLowerCase().replace(/[^a-z\s&-]/g, ' ').replace(/\s+/g, ' ').trim();
  if (want.length < 2) return [];
  const hits: { m: TableMatch; score: number }[] = [];
  for (const row of TABLE) {
    let best = -1;
    let alias = row[0][0];
    for (const n of row[0]) {
      const score = n === want ? 3 : n.startsWith(want) ? 2 : n.includes(` ${want}`) || n.includes(want) ? 1 : -1;
      if (score > best) { best = score; alias = n; }
    }
    if (best >= 0) hits.push({ m: { name: alias, serving: row[1], nutrients: nutrientsOf(row) }, score: best * 100 - alias.length });
  }
  return hits.sort((a, b) => b.score - a.score).slice(0, limit).map((h) => h.m);
}

/** One table food at a number of servings, as a logged item. */
export function itemFor(name: string, servings = 1): FoodItem | null {
  const hit = lookupFood(name);
  if (!hit) return null;
  const q = Math.min(6, Math.max(0.25, Math.round(servings * 4) / 4));
  const nutrients = Object.fromEntries(Object.entries(hit.nutrients).map(([k, v]) => [k, Math.round((v as number) * q * 10) / 10])) as Nutrients;
  return { name: hit.name, amount: q === 1 ? hit.serving : `${q} x ${hit.serving}`, nutrients, exact: false };
}

/** Words to estimated items. Anything the table doesn't know comes back in `unknown`. */
export function estimate(text: string): { items: FoodItem[]; unknown: string[] } {
  const parts = text.split(/,|;|\+|&|\n|\band\b|\bwith\b|\bthen\b/i).map((p) => p.trim()).filter((p) => p.length > 1);
  const items: FoodItem[] = [];
  const unknown: string[] = [];
  for (const p of parts) {
    const hit = lookupFood(p);
    if (!hit) { unknown.push(p); continue; }
    const q = quantityOf(p);
    const scaled = Object.fromEntries(Object.entries(hit.nutrients).map(([k, v]) => [k, Math.round((v as number) * q * 10) / 10])) as Nutrients;
    items.push({ name: hit.name, amount: q === 1 ? hit.serving : `${q} x ${hit.serving}`, nutrients: scaled, exact: false });
  }
  return { items, unknown };
}

/*
 * Daily targets for boys 14-18 (Dietary Reference Intakes, used by Health Canada): protein
 * 52 g, iron 11 mg, calcium 1300 mg, vitamin D 15 ug (600 IU), fibre 38 g. Fruit and veg:
 * about 8 servings (Canada's Food Guide for teen boys). Calgary gets almost no vitamin-D
 * sunlight from October to March, so food (milk, salmon, eggs) carries it then.
 */
export const TARGETS: Required<Omit<Nutrients, 'carbs_g'>> = {
  protein_g: 52, iron_mg: 11, calcium_mg: 1300, vitd_ug: 15, fibre_g: 38, fruitveg: 8,
};

export const LABELS: Record<keyof typeof TARGETS, string> = {
  protein_g: 'protein (g)', iron_mg: 'iron (mg)', calcium_mg: 'calcium (mg)', vitd_ug: 'vitamin D (ug)', fibre_g: 'fibre (g)', fruitveg: 'fruit and veg (servings)',
};

export function totals(entries: Pick<FoodEntry, 'items'>[]): Nutrients & { exactShare: number } {
  const sum: Required<Nutrients> = { protein_g: 0, carbs_g: 0, fibre_g: 0, iron_mg: 0, calcium_mg: 0, vitd_ug: 0, fruitveg: 0 };
  let items = 0;
  let exact = 0;
  for (const e of entries) {
    for (const it of e.items) {
      items++;
      if (it.exact) exact++;
      for (const k of Object.keys(sum) as (keyof Nutrients)[]) sum[k] += it.nutrients[k] ?? 0;
    }
  }
  const round = (n: number) => Math.round(n * 10) / 10;
  return { ...Object.fromEntries(Object.entries(sum).map(([k, v]) => [k, round(v)])) as Required<Nutrients>, exactShare: items ? exact / items : 0 };
}

/** Which targets a day (or a week's average day) falls short on, worst first. */
/** The day's targets: with his muscle-building program on, protein goes up to what growing needs (program.ts). */
export function targetsFor(program: boolean): typeof TARGETS {
  return program ? { ...TARGETS, protein_g: PROGRAM_PROTEIN_G } : TARGETS;
}
/** About 1.6 g per kg at his size (110 lb) - the same number as PROGRAM.proteinG. */
export const PROGRAM_PROTEIN_G = 80;

export function shortfalls(day: Nutrients, targets: typeof TARGETS = TARGETS): { key: keyof typeof TARGETS; label: string; have: number; target: number; share: number }[] {
  return (Object.keys(targets) as (keyof typeof TARGETS)[])
    .map((key) => ({ key, label: LABELS[key], have: day[key] ?? 0, target: targets[key], share: (day[key] ?? 0) / targets[key] }))
    .filter((x) => x.share < 0.8)
    .sort((a, b) => a.share - b.share);
}

/* ── Exact numbers: barcodes and labels ─────────────────────────────── */

/** A real EAN-13 / UPC-A / EAN-8 has a check digit - a misread barcode fails it. */
export function validBarcode(code: string): boolean {
  const d = code.replace(/\D/g, '');
  if (![8, 12, 13].includes(d.length)) return false;
  const digits = d.split('').map(Number);
  const check = digits.pop()!;
  const sum = digits.reverse().reduce((s, n, i) => s + n * (i % 2 === 0 ? 3 : 1), 0);
  return (10 - (sum % 10)) % 10 === check;
}

interface OffProduct { product_name?: string; brands?: string; serving_size?: string; nutriments?: Record<string, number | string> }

/** Open Food Facts' nutrients for one serving (or 100 g when no serving is given). It stores minerals in grams. */
export function fromOpenFoodFacts(p: OffProduct): FoodItem | null {
  const n = p.nutriments ?? {};
  const per = (key: string): number | undefined => {
    const v = n[`${key}_serving`] ?? n[`${key}_100g`];
    const x = typeof v === 'string' ? Number(v) : v;
    return typeof x === 'number' && Number.isFinite(x) ? x : undefined;
  };
  const serving = n['proteins_serving'] !== undefined || n['carbohydrates_serving'] !== undefined;
  const g = (k: string, scale = 1) => { const v = per(k); return v === undefined ? undefined : Math.round(v * scale * 10) / 10; };
  const nutrients: Nutrients = {
    protein_g: g('proteins'), carbs_g: g('carbohydrates'), fibre_g: g('fiber'),
    iron_mg: g('iron', 1000), calcium_mg: g('calcium', 1000), vitd_ug: g('vitamin-d', 1_000_000),
  };
  if (Object.values(nutrients).every((v) => v === undefined)) return null;
  const name = [p.brands?.split(',')[0]?.trim(), p.product_name?.trim()].filter(Boolean).join(' ') || 'packaged food';
  return { name, amount: serving ? p.serving_size || '1 serving' : '100 g', nutrients, exact: true };
}

/** Looks a barcode up on Open Food Facts (free, no key, nothing about the operator is sent). */
export async function lookupBarcode(code: string, signal?: AbortSignal): Promise<FoodItem | { error: string }> {
  const digits = code.replace(/\D/g, '');
  if (!validBarcode(digits)) return { error: `${code} is not a valid barcode number (the check digit is wrong) - read it again.` };
  try {
    const res = await fetch(`https://world.openfoodfacts.org/api/v2/product/${digits}.json?fields=product_name,brands,serving_size,nutriments`, {
      headers: { 'User-Agent': 'Ultron/2.0 (personal assistant; https://github.com/Shae1234567)' },
      signal: signal ?? AbortSignal.timeout(15_000),
    });
    if (res.status === 404) return { error: 'Open Food Facts does not have that product yet - a photo of the nutrition label works instead.' };
    if (!res.ok) return { error: `Open Food Facts answered ${res.status}.` };
    const body = (await res.json()) as { status?: number; product?: OffProduct };
    if (!body.product || body.status === 0) return { error: 'Open Food Facts does not have that product yet - a photo of the nutrition label works instead.' };
    return fromOpenFoodFacts(body.product) ?? { error: 'Open Food Facts has that product but no nutrition numbers for it.' };
  } catch (e) {
    return { error: `Could not reach Open Food Facts: ${e instanceof Error ? e.message : String(e)}` };
  }
}

/* ── Demeter's fuelling notes (fuel, not diet) ──────────────────────── */

/**
 * Drinks a day: boys 14-18 need about 3.3 L of water in total (Dietary Reference Intakes),
 * roughly 2.6 L of it from drinks - so about 2.5 L of drinks, more on training days.
 */
export const WATER_TARGET_ML = 2500;

/** What fits each kind of day - timing and carbs around training, never restriction. */
export const FUEL_TIPS: Record<'training' | 'match' | 'rest', string[]> = {
  training: [
    'A meal with carbs 2-3 hours before practice (rice, pasta, a wrap, roti), or a snack 30-60 minutes before (banana, toast, yogurt).',
    'Within an hour after: protein and carbs together - chocolate milk, yogurt and fruit, or a sandwich.',
    'Drink through the day, and a bottle during practice.',
  ],
  match: [
    'Pre-game meal 3-4 hours before kick-off: familiar food, mostly carbs, some protein, not too greasy or high in fibre.',
    'If you are hungry an hour before, a banana or a slice of toast.',
    'Water all day, not just at the game. A proper meal within 1-2 hours after.',
  ],
  rest: [
    'Rest days still need fuel - this is when your body repairs. Normal meals, no skipping.',
    'A good day to catch up on iron and calcium foods.',
  ],
};

/** Foods to ask a parent for, by what the week is short on. Ordinary groceries. */
export const ASK_FOR: Record<keyof typeof TARGETS, string[]> = {
  protein_g: ['eggs', 'Greek yogurt', 'chicken', 'dal or lentils', 'milk'],
  iron_mg: ['lean beef', 'dal, chana or rajma', 'iron-fortified cereal', 'spinach or palak (with an orange for the vitamin C)'],
  calcium_mg: ['milk', 'yogurt', 'cheese or paneer', 'fortified soy milk'],
  vitd_ug: ['milk (vitamin D is added in Canada)', 'salmon', 'eggs', 'fortified orange juice'],
  fibre_g: ['oatmeal', 'beans or chickpeas', 'berries', 'whole wheat bread', 'apples and pears'],
  fruitveg: ['fruit with breakfast', 'baby carrots or cucumber for lunch', 'frozen berries for smoothies', 'an extra vegetable at dinner'],
};
