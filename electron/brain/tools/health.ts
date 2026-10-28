import fs from 'node:fs';
import path from 'node:path';
import * as health from '../../departments/health/store';
import type { FoodItem, Nutrients } from '../../departments/health/store';
import { estimate, lookupBarcode, lookupFood, shortfalls, targetsFor, totals, TARGETS, LABELS } from '../../departments/health/foods';
import { forWeek, GROW_FOOD, HONEST, PHASES, PROGRAM, programStatus } from '../../departments/health/program';
import { snapshot, snapshotText } from '../../departments/health/summary';
import { hqRoot } from '../../memory/hq';
import { painAlerts } from '../../departments/health/api';
import { GYM_RULES, parseExercises, sessionTotals, targetText, workoutById } from '../../departments/health/workouts';
import { emit } from '../events';
import { chat } from '../llm';
import { A, B, N, S, num, obj, str, type AgentTool } from './types';

const DAY_NAMES = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

function dayOf(v: unknown): number {
  const s = String(v ?? '').trim().toLowerCase();
  const n = Number(s);
  if (Number.isInteger(n) && n >= 0 && n <= 6) return n;
  return DAY_NAMES.findIndex((d) => d.startsWith(s.slice(0, 3)));
}

const dateArg = S('YYYY-MM-DD, only when it is not today (for sleep: the morning they woke up)');

/*
 * AI estimates for foods the built-in table doesn't know (added by Hermes on 12 Oct 2026, fixed the same day:
 * the model's reply was used as an object when it is text, so any unknown food crashed the log). Food is
 * private Health data, so only the local model or a service trusted with private data is asked; with none
 * available the food simply stays "not recognised". Never calories - fuel, not diet.
 */
const NUTRIENT_KEYS = ['protein_g', 'carbs_g', 'fibre_g', 'iron_mg', 'calcium_mg', 'vitd_ug', 'fruitveg'] as const;
const NUTRIENT_FIELDS = '{ protein_g, carbs_g, fibre_g, iron_mg, calcium_mg, vitd_ug, fruitveg (servings of fruit and veg) }';

/** Only real, sane numbers for the known nutrient fields ("fiber_g" accepted); anything else - calories too - is dropped. */
export function cleanNutrients(x: unknown): Nutrients {
  const o = (x && typeof x === 'object' ? x : {}) as Record<string, unknown>;
  const out: Nutrients = {};
  for (const k of NUTRIENT_KEYS) {
    const v = Number(o[k] ?? (k === 'fibre_g' ? o.fiber_g : undefined));
    if (o[k] !== undefined || (k === 'fibre_g' && o.fiber_g !== undefined)) {
      if (Number.isFinite(v) && v >= 0 && v < 2000) out[k] = Math.round(v * 10) / 10;
    }
  }
  return out;
}

/** A model's JSON reply, even wrapped in a code fence or a sentence. */
export function replyJson(text: string): Record<string, unknown> | null {
  const t = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```$/, '').trim();
  for (const s of [t, /\{[\s\S]*\}/.exec(t)?.[0]]) {
    if (!s) continue;
    try {
      const v = JSON.parse(s);
      if (v && typeof v === 'object' && !Array.isArray(v)) return v as Record<string, unknown>;
    } catch { /* try the next shape */ }
  }
  return null;
}

async function aiJson(system: string, user: string): Promise<Record<string, unknown> | null> {
  try {
    const res = await chat({ system, messages: [{ role: 'user', content: user }], json: true, temperature: 0.1, tier: 'fast', private: true });
    return replyJson(res.text);
  } catch {
    return null; // no private-safe brain right now, or it failed - the food stays unrecognised
  }
}

async function aiEstimateFood(food: string): Promise<FoodItem | null> {
  const o = await aiJson(
    `Estimate the nutrients in the food the user names, for a normal teen portion unless an amount is given. Reply with ONLY a JSON object: { "name": string, "amount": string, "nutrients": ${NUTRIENT_FIELDS} }. No calories.`,
    food,
  );
  const nutrients = cleanNutrients(o?.nutrients);
  if (!o || !Object.keys(nutrients).length) return null;
  return { name: String(o.name || food).slice(0, 60), amount: o.amount ? String(o.amount).slice(0, 30) : undefined, nutrients, exact: false };
}

export const healthTools: AgentTool[] = [
  {
    name: 'health_log_sleep',
    owner: 'hypnos',
    description: 'Log a night\'s sleep from the bedtime and wake time the operator gave. Logging the same morning again corrects it.',
    parameters: obj({ bed: S('Bedtime, e.g. "23:30" or "11:30pm"'), wake: S('Wake time, e.g. "7:00"'), quality: N('Optional 1-5'), note: S('Optional'), date: dateArg }, ['bed', 'wake']),
    label: (a) => `log sleep ${str(a, 'bed')} to ${str(a, 'wake')}`,
    run: async (a) => {
      const r = health.addSleep({ bed: str(a, 'bed'), wake: str(a, 'wake'), quality: num(a, 'quality', 0) || undefined, note: str(a, 'note'), date: str(a, 'date') || undefined });
      return 'error' in r ? r : { logged: r, hours: r.hours };
    },
  },
  {
    name: 'health_log_training',
    owner: 'achilles',
    description: 'Log a training session or game: what kind, how many minutes, and effort 1-10 (1 easy, 10 everything they had).',
    parameters: obj({
      kind: S('soccer, badminton, gym, run or other', { enum: ['soccer', 'badminton', 'gym', 'run', 'other'] }),
      minutes: N('How long'),
      effort: N('1-10'),
      what: S('Optional: practice, game, drills, legs day...'),
      exercises: S('Optional gym detail as said, one exercise per ";": "goblet squat 3x10 @ 12kg; push-ups 3x12; plank 3x30s"'),
      note: S('Optional'),
      date: dateArg,
    }, ['kind', 'minutes', 'effort']),
    label: (a) => `log ${str(a, 'kind')} ${num(a, 'minutes', 0)} min`,
    run: async (a) => {
      const exercises = str(a, 'exercises') ? parseExercises(str(a, 'exercises')) : undefined;
      const r = health.addTraining({ kind: str(a, 'kind'), minutes: num(a, 'minutes', 0), effort: num(a, 'effort', 0), what: str(a, 'what'), note: str(a, 'note'), exercises, date: str(a, 'date') || undefined });
      if ('error' in r) return r;
      const t = sessionTotals(r.exercises);
      return { logged: r, load: r.minutes * r.effort, gym: t.exercises ? `${t.exercises} exercises, ${t.sets} sets` : undefined };
    },
  },
  {
    name: 'health_log_food',
    owner: 'demeter',
    description: 'Log what the operator ate. Common foods come from the built-in table; anything it does not know is estimated by the AI (private-safe brains only).',
    parameters: obj({ text: S('What they ate'), meal: S('Which meal', { enum: [...health.MEALS] }), date: dateArg }, ['text']),
    label: (a) => `log food: ${str(a, 'text').slice(0, 50)}`,
    run: async (a) => {
      const text = str(a, 'text').trim();
      if (!text) return { error: 'What did they eat?' };
      const usual = /\busual\b/i.test(text) ? health.findUsual(text) : undefined;
      const est = usual ? { items: usual.items, unknown: [] as string[] } : estimate(text);
      // Foods the table doesn't know: an AI estimate each (a few at most), the rest stay "not recognised".
      const guessed: string[] = [];
      for (const food of est.unknown.slice(0, 4)) {
        const item = await aiEstimateFood(food);
        if (!item) continue;
        est.items.push(item);
        guessed.push(food);
      }
      const unknown = est.unknown.filter((u) => !guessed.includes(u));
      const meal = health.MEALS.find((m) => m === str(a, 'meal'));
      const e = health.addFood({ text, meal, items: est.items, unknown, source: 'chat', date: str(a, 'date') || undefined });
      return {
        logged: e.items.map((i) => (i.amount ? `${i.name} (${i.amount})` : i.name)),
        exact: usual ? `from the saved usual meal "${usual.name}"` : undefined,
        estimated: usual ? undefined : guessed.length ? `estimates - the AI estimated ${guessed.join(', ')}` : 'estimates from the common-food table',
        not_recognised: e.unknown.length ? e.unknown : undefined,
      };
    },
  },
  {
    name: 'health_analyze_recipe',
    owner: 'demeter',
    description: 'A home-cooked dish from its ingredients and amounts: estimates protein, carbs, fibre, iron, calcium, vitamin D and fruit and veg per serving, and logs the servings he ate. Never calories.',
    parameters: obj({
      recipe: S('The ingredients and amounts, as he said them'),
      servings: N('How many servings the whole recipe makes (default 1)'),
      ate: N('How many servings he ate (default 1)'),
      meal: S('Which meal', { enum: [...health.MEALS] }),
      date: dateArg,
    }, ['recipe']),
    label: (a) => `recipe: ${str(a, 'recipe').slice(0, 50)}`,
    run: async (a) => {
      const recipe = str(a, 'recipe').trim();
      if (!recipe) return { error: 'What went into it, and how much of each?' };
      const o = await aiJson(
        `Estimate the nutrients of each ingredient in this recipe at the amount given. Reply with ONLY a JSON object: { "ingredients": [ { "name": string, "amount": string, "nutrients": ${NUTRIENT_FIELDS} } ] }. No calories.`,
        recipe,
      );
      const rows = Array.isArray(o?.ingredients) ? (o!.ingredients as Record<string, unknown>[]).slice(0, 30) : [];
      const parts = rows.map((r) => ({ name: String(r?.name ?? '').slice(0, 60), amount: r?.amount ? String(r.amount).slice(0, 30) : undefined, nutrients: cleanNutrients(r?.nutrients) })).filter((r) => r.name && Object.keys(r.nutrients).length);
      if (!parts.length) return { error: 'Could not work out that recipe right now (it needs the local model or a service trusted with private data). Log it as plain food instead.' };
      const servings = Math.max(1, Math.min(20, num(a, 'servings', 1) || 1));
      const ate = Math.max(0.25, Math.min(servings, num(a, 'ate', 1) || 1));
      const share = ate / servings;
      // The whole dish, scaled to what he ate - one item, so a week of food stays readable.
      const nutrients: Nutrients = {};
      for (const k of NUTRIENT_KEYS) {
        const sum = parts.reduce((n, p) => n + (p.nutrients[k] ?? 0), 0) * share;
        if (sum) nutrients[k] = Math.round(sum * 10) / 10;
      }
      const name = `Home-cooked: ${recipe.split(/[,;\n]/)[0].slice(0, 40)}`;
      const meal = health.MEALS.find((m) => m === str(a, 'meal'));
      const e = health.addFood({ text: `${name} (${ate} of ${servings} servings)`, meal, items: [{ name, amount: `${ate} of ${servings} servings`, nutrients, exact: false }], unknown: [], source: 'chat', date: str(a, 'date') || undefined });
      return { logged: e.text, his_portion: nutrients, ingredients: parts.map((p) => `${p.name}${p.amount ? ` (${p.amount})` : ''}`), estimated: 'AI estimates for each ingredient - fine for patterns across a week.' };
    },
  },
  {
    name: 'health_log_pain',
    owner: 'asclepius',
    description: 'Log pain or an injury the operator mentioned: where, how bad (1-10), what happened. Never diagnose.',
    parameters: obj({
      where: S('Body part'),
      side: S('left, right or both', { enum: ['left', 'right', 'both'] }),
      severity: N('1-10'),
      feel: S('How it feels', { enum: ['sharp', 'dull', 'ache', 'tight'] }),
      swelling: B('Is it swollen?'),
      note: S('What happened, how it feels'),
      date: dateArg,
    }, ['where', 'severity']),
    label: (a) => `log pain: ${str(a, 'where')}`,
    run: async (a) => {
      const p = health.addPain({ where: str(a, 'where'), side: str(a, 'side'), severity: num(a, 'severity', 3), feel: str(a, 'feel'), swelling: a.swelling === true, note: str(a, 'note'), date: str(a, 'date') || undefined });
      const must = painAlerts(p);
      return { logged: p, you_must_say: must.length ? must : undefined };
    },
  },
  {
    name: 'health_checkin',
    owner: 'asclepius',
    description: 'Record today\'s quick check-in: energy 1-5 and soreness 1-5 (either one is fine).',
    parameters: obj({ energy: N('1-5'), soreness: N('1-5'), note: S('Optional'), date: dateArg }),
    label: () => 'check-in',
    run: async (a) => ({ logged: health.addCheckIn({ energy: num(a, 'energy', 0) || undefined, soreness: num(a, 'soreness', 0) || undefined, note: str(a, 'note'), date: str(a, 'date') || undefined }) }),
  },
  {
    name: 'health_log_water',
    owner: 'demeter',
    description: 'Log water or other drinks: in ml, or glasses/cups (250 ml) and bottles (500 ml). Returns the day\'s total against about 2.5 L.',
    parameters: obj({ ml: N('Millilitres'), glasses: N('Glasses or cups (250 ml each)'), bottles: N('Bottles (500 ml each)'), date: dateArg }),
    label: () => 'log water',
    run: async (a) => {
      const ml = num(a, 'ml', 0) + num(a, 'glasses', 0) * 250 + num(a, 'bottles', 0) * 500;
      const r = health.addWater(ml, str(a, 'date') || undefined);
      return 'error' in r ? r : { logged_ml: ml, today_ml: r.total, target_ml: 2500 };
    },
  },
  {
    name: 'health_open',
    owner: 'asclepius',
    description: 'Open the Health app on the operator\\\'s screen - where they log sleep, gym sets, training, food, water, pain and check-ins with buttons, and see their week. Use when they ask to open or see it, or want to log something themselves.',
    parameters: obj({ tab: S('Which page', { enum: ['today', 'sleep', 'train', 'food', 'body', 'week', 'log'] }) }),
    label: (a) => `open Health ${str(a, 'tab') || 'today'}`,
    run: async (a) => {
      emit('ui:focus', { health: str(a, 'tab') || 'today' });
      return { opened: str(a, 'tab') || 'today' };
    },
  },
  {
    name: 'health_week',
    owner: 'asclepius',
    description: 'The last 7 days of health data: sleep per night, training sessions and load, food against the daily targets, pain, flags (load jumps, stacked hard days, short sleep before hard days) and today\'s readiness.',
    parameters: obj({}),
    label: () => 'health this week',
    run: async () => {
      const s = snapshot();
      return {
        summary: snapshotText(s),
        nights: s.number.nights,
        targets_per_day: Object.fromEntries((Object.keys(TARGETS) as (keyof typeof TARGETS)[]).map((k) => [LABELS[k], targetsFor(s.program.on)[k]])),
        food_per_day: s.food?.perDay,
      };
    },
  },
  {
    name: 'health_program',
    owner: 'heracles',
    description: 'His 12-month gym program, the Fight Club build: "today" (default) gives the session to do next with every exercise, this week\'s sets, reps, rest and form cue; "plan" gives the phases and where he is; "off"/"on" pauses or resumes it; "restart" goes back to week 1.',
    parameters: obj({ action: S('today, plan, off, on or restart', { enum: ['today', 'plan', 'off', 'on', 'restart'] }) }),
    label: (a) => `gym program: ${str(a, 'action') || 'today'}`,
    run: async (a, ctx) => {
      const action = str(a, 'action') || 'today';
      if (action === 'off' || action === 'on') {
        health.setProgram(action);
        return { done: action === 'off' ? 'Program paused - Health goes back to general fitness until it is turned on again.' : 'Program back on.' };
      }
      if (action === 'restart') {
        const ok = await ctx.approve('health-program', 'Restart the gym program from week 1?', 'The Fight Club build goes back to week 1 (Foundation); the next program session starts the 12 months again. Logged sessions stay in the log.');
        if (!ok) return { error: 'The operator said no - the program carries on where it is.' };
        health.setProgram('restart');
        return { done: 'Back to week 1 - the next program session starts it.' };
      }
      const s = programStatus(health.load(), health.isoDay());
      if (!s.on) return { off: 'The program is paused. Say "turn the gym program back on" to resume.' };
      const base = {
        program: PROGRAM.name,
        week: s.started ? `${Math.min(s.week, PROGRAM.weeks)} of ${PROGRAM.weeks}` : 'not started - week 1 begins with the first session',
        phase: `${s.phase.name} (${s.phase.months}): ${s.phase.what}`,
        lighter_week: s.deload || undefined,
        this_week: `${s.doneThisWeek} of 5 done`,
        rules: GYM_RULES,
      };
      if (action === 'plan') return { ...base, goal: PROGRAM.goal, phases: PHASES.map((p) => `${p.months} - ${p.name}: ${p.what}`), honest: HONEST, eat_to_grow: GROW_FOOD };
      const w = s.next ? forWeek(workoutById(s.next.id)!, s.week) : null;
      return {
        ...base,
        note: s.note,
        next: w ? { session: w.name, minutes: w.minutes, focus: w.focus, exercises: w.exercises.map((e) => `${e.name}: ${targetText(e)}, rest ${e.rest} s - ${e.cue}`) } : null,
        start_it: w ? 'He can start it set by set in Health - Train - "Start" on the program card.' : undefined,
      };
    },
  },
  {
    name: 'health_usual_meal',
    owner: 'demeter',
    description: 'Save a meal the operator eats often, once, with real amounts - then "my usual breakfast" logs it exactly. Or list the saved ones.',
    parameters: obj({
      action: S('save or list', { enum: ['save', 'list'] }),
      name: S('e.g. "usual breakfast"'),
      foods: S('What is in it, with amounts ("2 eggs, 1 slice toast, glass of milk")'),
      barcodes: A('Optional barcode numbers of packaged foods in it, for exact numbers'),
    }, ['action']),
    label: (a) => `${str(a, 'action')} usual meal ${str(a, 'name')}`,
    run: async (a) => {
      if (str(a, 'action') === 'list') return { usual_meals: health.load().usual.map((u) => ({ name: u.name, items: u.items.map((i) => `${i.name} (${i.amount})`) })) };
      const name = str(a, 'name').trim();
      if (!name) return { error: 'Give the meal a name, like "usual breakfast".' };
      const est = estimate(str(a, 'foods'));
      const exact = [];
      for (const b of (Array.isArray(a.barcodes) ? a.barcodes : []).slice(0, 6)) {
        const r = await lookupBarcode(String(b));
        if (!('error' in r)) exact.push(r);
      }
      const items = [...est.items, ...exact];
      if (!items.length) return { error: 'None of those foods were recognised - list them with amounts, or give barcodes.' };
      const m = health.saveUsual(name, items);
      return { saved: m.name, items: m.items.map((i) => `${i.name} (${i.amount})${i.exact ? ' - exact' : ''}`), not_recognised: est.unknown.length ? est.unknown : undefined };
    },
  },
  {
    name: 'food_lookup',
    owner: 'demeter',
    description: 'Nutrients for one food: by barcode number (exact, from Open Food Facts - only the number is sent) or by name (an estimate from the common-food table).',
    parameters: obj({ barcode: S('The digits under the barcode'), name: S('A food name') }),
    label: (a) => `food lookup ${str(a, 'barcode') || str(a, 'name')}`,
    run: async (a) => {
      if (str(a, 'barcode')) return lookupBarcode(str(a, 'barcode'));
      const hit = lookupFood(str(a, 'name'));
      return hit ? { ...hit, estimated: true } : { error: 'Not in the common-food table - a barcode or label gives exact numbers.' };
    },
  },
  {
    name: 'health_day_food',
    owner: 'demeter',
    description: 'Food logged for one day against the daily targets for boys 14-18 (protein, iron, calcium, vitamin D, fibre, fruit and veg). Never calories.',
    parameters: obj({ date: dateArg }),
    label: () => 'food today',
    run: async (a) => {
      const date = str(a, 'date') || health.isoDay();
      const entries = health.load().food.filter((f) => f.date === date);
      if (!entries.length) return { date, logged: 'nothing yet' };
      const t = totals(entries);
      return { date, meals: entries.map((e) => `${e.meal ?? 'food'}: ${e.text}`), totals: t, short_on: shortfalls(t).map((x) => `${x.label}: ${x.have} of ${x.target}`), mostly_estimates: t.exactShare < 0.5 };
    },
  },
  {
    name: 'health_schedule',
    owner: 'achilles',
    description: 'The weekly training schedule (practices, games, gym), said once and kept: add, list or remove.',
    parameters: obj({
      action: S('add, list or remove', { enum: ['add', 'list', 'remove'] }),
      kind: S('practice, game, gym, other', { enum: ['practice', 'game', 'gym', 'other'] }),
      sport: S('soccer, badminton...'),
      day: S('Weekday, e.g. "Tuesday"'),
      start: S('Start time, e.g. "18:00"'),
      minutes: N('How long'),
      note: S('Optional'),
      id: S('For remove: the id from list'),
    }, ['action']),
    label: (a) => `${str(a, 'action')} schedule ${str(a, 'day')}`,
    run: async (a) => {
      const action = str(a, 'action');
      if (action === 'list') return { schedule: health.load().schedule.map((s) => ({ ...s, day: DAY_NAMES[s.day] })) };
      if (action === 'remove') return health.removeSchedule(str(a, 'id')) ? { removed: str(a, 'id') } : { error: 'No schedule item with that id - list first.' };
      const day = dayOf(a.day);
      const kind = (['practice', 'game', 'gym', 'other'] as const).find((k) => k === str(a, 'kind')) ?? 'other';
      const r = health.addSchedule({ kind, sport: str(a, 'sport') || undefined, day, start: str(a, 'start'), minutes: num(a, 'minutes', 60), note: str(a, 'note') || undefined });
      return 'error' in r ? r : { added: { ...r, day: DAY_NAMES[r.day] } };
    },
  },
  {
    name: 'hq_health_update',
    owner: 'asclepius',
    description: 'Propose an update to one section of the operator\'s own health plan files (HQ health-fitness/context: training-plan, nutrition, injury-log, match-schedule, tryout-prep). Shows them the change; nothing is written unless they approve.',
    parameters: obj({
      file: S('training-plan, nutrition, injury-log, match-schedule, tryout-prep'),
      section: S('The "## " heading to update, exactly as it is in the file'),
      content: S('The new text for that section (markdown), complete'),
    }, ['file', 'section', 'content']),
    label: (a) => `propose update to ${str(a, 'file')} > ${str(a, 'section')}`,
    run: async (a, ctx) => {
      const root = hqRoot();
      if (!root) return { error: 'The HQ folder is not found (Settings -> HQ).' };
      const file = str(a, 'file').replace(/\.md$/i, '').replace(/[^a-z-]/gi, '');
      const full = path.join(root, 'health-fitness', 'context', `${file}.md`);
      if (!fs.existsSync(full)) return { error: `There is no health-fitness/context/${file}.md - only the existing plan files can be updated.` };
      const before = fs.readFileSync(full, 'utf8');
      const heading = str(a, 'section').replace(/^#+\\s*/, '').trim();
      const at = before.search(new RegExp(`^#{2,3} ${heading.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\$&')}\\s*$`, 'm'));
      if (at < 0) return { error: `No "## ${heading}" section in ${file}.md.` };
      const afterHead = before.indexOf('\n', at) + 1;
      const rest = before.slice(afterHead);
      const next = rest.search(/^#{1,3} /m);
      const end = next < 0 ? before.length : afterHead + next;
      const content = str(a, 'content').trim();
      const updated = `${before.slice(0, afterHead)}${content}\n\n${before.slice(end)}`.replace(/\n{3,}/g, '\n\n');
      const ok = await ctx.approve('hq-edit', `Update your ${file}.md - "${heading}"`, `New text for "${heading}" in health-fitness/context/${file}.md:\n\n${content.slice(0, 1500)}`);
      if (!ok) return { declined: true, note: 'Nothing was changed.' };
      fs.writeFileSync(full, updated, 'utf8');
      return { updated: `health-fitness/context/${file}.md`, section: heading };
    },
    writes: true,
  },
];
