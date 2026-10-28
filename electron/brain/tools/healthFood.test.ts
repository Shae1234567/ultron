import { beforeEach, describe, expect, it, vi } from 'vitest';

// Hermes' food additions (12 Oct 2026), repaired: an unknown food crashed the log, the recipe tool crashed on
// its first use, and both asked any AI service (food is private Health data). Fake log, fake AI here.
const docs = new Map<string, unknown>();
vi.mock('../../store', () => ({
  readDoc: (n: string, f: unknown) => (docs.has(n) ? structuredClone(docs.get(n)) : f),
  writeDoc: (n: string, d: unknown) => { docs.set(n, structuredClone(d)); },
  getSettings: () => ({}),
}));
vi.mock('../events', () => ({ emit: () => {} }));
const chat = vi.fn();
vi.mock('../llm', () => ({ chat: (req: unknown) => chat(req) }));

const { healthTools, cleanNutrients, replyJson } = await import('./health');
const store = await import('../../departments/health/store');
const tool = (name: string) => healthTools.find((t) => t.name === name)!;
const ctx = { approve: async () => true } as never;

beforeEach(() => { docs.clear(); chat.mockReset(); });

describe('reading the AI\'s nutrient reply', () => {
  it('keeps only sane numbers for the known nutrients - calories are dropped', () => {
    expect(cleanNutrients({ protein_g: 12.34, fiber_g: 3, calories: 450, iron_mg: -2, calcium_mg: 'lots' })).toEqual({ protein_g: 12.3, fibre_g: 3 });
  });
  it('reads JSON even in a code fence or a sentence', () => {
    expect(replyJson('```json\n{"name":"x"}\n```')).toEqual({ name: 'x' });
    expect(replyJson('Sure! {"name":"y"} hope that helps')).toEqual({ name: 'y' });
    expect(replyJson('no json here')).toBeNull();
  });
});

describe('health_log_food with a food the table does not know', () => {
  it('logs an AI estimate for it - asking only private-safe brains', async () => {
    chat.mockResolvedValue({ text: JSON.stringify({ name: 'shakshuka', amount: '1 plate', nutrients: { protein_g: 9, carbs_g: 70, fibre_g: 3, calories: 500 } }) });
    const r = await tool('health_log_food').run({ text: 'shakshuka' }, ctx) as Record<string, unknown>;
    expect(chat.mock.calls[0][0]).toMatchObject({ private: true });
    expect(r.logged).toEqual(['shakshuka (1 plate)']);
    expect(r.not_recognised).toBeUndefined();
    const food = store.load().food[0];
    expect(food.items[0].nutrients).toEqual({ protein_g: 9, carbs_g: 70, fibre_g: 3 });
    expect(food.items[0].exact).toBe(false);
  });

  it('with no private-safe brain available, still logs the meal and says what it did not recognise', async () => {
    chat.mockRejectedValue(new Error('No brain trusted with private data is available.'));
    const r = await tool('health_log_food').run({ text: 'shakshuka' }, ctx) as Record<string, unknown>;
    expect(r.not_recognised).toEqual(['shakshuka']);
    expect(store.load().food).toHaveLength(1);
  });
});

describe('health_analyze_recipe', () => {
  it('adds up the ingredients, scales to the servings he ate, and logs one item - no calories', async () => {
    chat.mockResolvedValue({ text: JSON.stringify({ ingredients: [
      { name: 'chicken thighs', amount: '500 g', nutrients: { protein_g: 100, iron_mg: 4, calories: 900 } },
      { name: 'rice', amount: '300 g dry', nutrients: { protein_g: 20, carbs_g: 240 } },
    ] }) });
    const r = await tool('health_analyze_recipe').run({ recipe: 'chicken thighs 500 g, rice 300 g', servings: 4, ate: 1, meal: 'dinner' }, ctx) as Record<string, unknown>;
    expect(r.error).toBeUndefined();
    expect(r.his_portion).toEqual({ protein_g: 30, carbs_g: 60, iron_mg: 1 });
    const f = store.load().food[0];
    expect(f.meal).toBe('dinner');
    expect(f.items).toHaveLength(1);
    expect(JSON.stringify(f)).not.toMatch(/calorie/i);
  });

  it('says so plainly when it cannot work the recipe out', async () => {
    chat.mockResolvedValue({ text: 'I am not sure.' });
    const r = await tool('health_analyze_recipe').run({ recipe: 'mystery stew' }, ctx) as Record<string, unknown>;
    expect(String(r.error)).toMatch(/Could not work out that recipe/);
    expect(store.load().food).toHaveLength(0);
  });
});

describe('health_program', () => {
  it('gives the next session with this week\'s sets and every form cue', async () => {
    const r = await tool('health_program').run({}, ctx) as { next: { session: string; exercises: string[] } };
    expect(r.next.session).toMatch(/Day 1/);
    expect(r.next.exercises[0]).toMatch(/Dumbbell bench press: 2 x 8-12, rest 90 s - Feet flat/);
  });
  it('pauses the program on request', async () => {
    await tool('health_program').run({ action: 'off' }, ctx);
    expect(store.load().program?.off).toBe(true);
  });
});
