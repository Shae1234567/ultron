import * as store from './store';
import { estimate, lookupBarcode, searchFoods, type TableMatch } from './foods';
import { healthView, type HealthView } from './view';
import { readiness } from './load';
import { HEALTH_RULES } from '../../brain/safety/health';
import type { FoodItem, Nutrients, PainEntry } from './store';

/*
 * The Health app's doorway into the log (over IPC). Everything from the renderer is checked
 * here - kinds, ids, numbers, lengths - before it touches the store, the same checks as
 * logging by chat. Nothing in here calls a model or leaves the PC, except a barcode lookup,
 * which sends only the barcode number to Open Food Facts.
 */

type Result = { ok: true; entry?: unknown; alerts?: string[]; detail?: string; total?: number } | { ok: false; error: string };

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const str = (v: unknown) => (typeof v === 'string' ? v : '');
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : Number(v) || 0);
const fail = (error: string): Result => ({ ok: false, error });
const done = <T extends object>(r: T | { error: string }, extra: Omit<Extract<Result, { ok: true }>, 'ok' | 'entry'> = {}): Result =>
  ('error' in r ? fail(r.error) : { ok: true, entry: r, ...extra });

export function view(date?: unknown): HealthView {
  return healthView(typeof date === 'string' ? date : undefined);
}

/** What a pain entry obliges Ultron to say (the safety core's lines), most urgent first. */
export function painAlerts(p: Pick<PainEntry, 'where' | 'note' | 'head' | 'severity' | 'feel' | 'swelling' | 'status'>): string[] {
  const text = `${p.where} ${p.note ?? ''}`;
  const rule = (id: string) => HEALTH_RULES.find((r) => r.id === id)!;
  const out: string[] = [];
  if (rule('emergency').trigger.test(text)) out.push(rule('emergency').line);
  if (p.head) out.push(rule('head').line);
  if (p.feel === 'sharp' || p.swelling || p.severity >= 6 || p.status === 'worse' || rule('injury').trigger.test(text)) out.push(rule('injury').line);
  return out;
}

/** An exact item that came back from a barcode lookup, checked before it is stored. */
function cleanItem(v: unknown): FoodItem | null {
  const o = obj(v);
  const name = str(o.name).trim().slice(0, 80);
  if (!name) return null;
  const n = obj(o.nutrients);
  const keys: (keyof Nutrients)[] = ['protein_g', 'carbs_g', 'fibre_g', 'iron_mg', 'calcium_mg', 'vitd_ug', 'fruitveg'];
  const nutrients: Nutrients = {};
  for (const k of keys) {
    const x = Number(n[k]);
    if (Number.isFinite(x) && x >= 0 && x < 5000) nutrients[k] = Math.round(x * 10) / 10;
  }
  return { name, amount: str(o.amount).slice(0, 40) || undefined, nutrients, exact: o.exact === true };
}

/** Words plus any exact (barcode) items into the items to store. A saved usual meal is used whole. */
function foodFrom(p: Record<string, unknown>): { text: string; items: FoodItem[]; unknown: string[]; source: store.Source } | { error: string } {
  const usualName = str(p.usual).trim();
  if (usualName) {
    const u = store.findUsual(usualName);
    if (!u) return { error: `No saved meal called "${usualName}".` };
    return { text: u.name, items: u.items, unknown: [], source: 'app' };
  }
  const text = str(p.text).trim().slice(0, 300);
  const exact = (Array.isArray(p.exact) ? p.exact : []).slice(0, 10).map(cleanItem).filter((x): x is FoodItem => Boolean(x));
  const est = text ? estimate(text) : { items: [], unknown: [] };
  const items = [...est.items, ...exact];
  if (!items.length && !est.unknown.length) return { error: 'What did you eat?' };
  return { text: text || exact.map((e) => e.name).join(', '), items, unknown: est.unknown, source: exact.length ? 'barcode' : 'app' };
}

export function log(kind: unknown, payload: unknown): Result {
  const p = obj(payload);
  const date = str(p.date) || undefined;
  switch (kind) {
    case 'sleep':
      return done(store.addSleep({ bed: str(p.bed), wake: str(p.wake), quality: num(p.quality) || undefined, tags: Array.isArray(p.tags) ? p.tags.map(String) : undefined, note: str(p.note), date, source: p.fromPc ? 'pc' : 'app' }));
    case 'training': {
      const r = store.addTraining({ kind: str(p.kind), minutes: num(p.minutes), effort: num(p.effort), what: str(p.what), note: str(p.note), exercises: p.exercises, workout: str(p.workout), date, source: 'app' });
      return done(r, 'error' in r ? {} : { detail: `Load ${r.minutes * r.effort} (minutes x effort).` });
    }
    case 'food': {
      const f = foodFrom(p);
      if ('error' in f) return fail(f.error);
      const e = store.addFood({ ...f, meal: store.isMeal(p.meal) ? p.meal : undefined, date });
      return { ok: true, entry: e, detail: e.unknown.length ? `Not in the food table: ${e.unknown.join(', ')}. A barcode gives exact numbers.` : undefined };
    }
    case 'water': {
      const r = store.addWater(num(p.ml), date);
      return 'error' in r ? fail(r.error) : { ok: true, total: r.total };
    }
    case 'pain': {
      const r = store.buildPain({ where: str(p.where), side: p.side, severity: num(p.severity), feel: p.feel, swelling: p.swelling === true, when: p.when, status: p.status, note: str(p.note), date });
      if ('error' in r) return fail(r.error);
      const e = store.addPain({ where: r.where, side: r.side, severity: r.severity, feel: r.feel, swelling: r.swelling, when: r.when, status: r.status, note: r.note, head: r.head, date: r.date });
      return { ok: true, entry: e, alerts: painAlerts(e) };
    }
    case 'checkin': {
      const c = store.addCheckIn({ energy: num(p.energy) || undefined, soreness: num(p.soreness) || undefined, note: str(p.note), date });
      const v = healthView(c.date);
      return { ok: true, entry: c, detail: `Readiness: ${readiness(v.sleep.entry, c).level}.` };
    }
    case 'dayType': {
      const t = str(p.type);
      store.setDayType(date ?? store.isoDay(), (store.DAY_TYPES as string[]).includes(t) ? (t as store.DayType) : null);
      return { ok: true };
    }
    default:
      return fail('Unknown kind of entry.');
  }
}

export function edit(kind: unknown, id: unknown, payload: unknown): Result {
  const p = obj(payload);
  const key = str(id);
  if (!key) return fail('Which entry?');
  const date = str(p.date) || undefined;
  switch (kind) {
    case 'sleep':
      return done(store.editEntry('sleep', key, { bed: str(p.bed), wake: str(p.wake), quality: num(p.quality) || undefined, tags: Array.isArray(p.tags) ? p.tags.map(String) : undefined, note: str(p.note), date }));
    case 'training':
      return done(store.editEntry('training', key, { kind: str(p.kind), minutes: num(p.minutes), effort: num(p.effort), what: str(p.what), note: str(p.note), exercises: p.exercises, workout: str(p.workout), date }));
    case 'food': {
      const f = foodFrom(p);
      if ('error' in f) return fail(f.error);
      return done(store.editEntry('food', key, { text: f.text, items: f.items, unknown: f.unknown, meal: p.meal, date }));
    }
    case 'pain': {
      const r = store.editEntry('pain', key, { where: str(p.where), side: p.side, severity: num(p.severity), feel: p.feel, swelling: p.swelling === true, when: p.when, status: p.status, note: str(p.note), date });
      return 'error' in r ? fail(r.error) : { ok: true, entry: r, alerts: painAlerts(r) };
    }
    default:
      return fail('That kind of entry is changed by logging it again.');
  }
}

export function remove(kind: unknown, id: unknown): Result {
  if (!(store.ENTRY_KINDS as unknown[]).includes(kind) || !str(id)) return fail('Which entry?');
  const gone = store.removeEntry(kind as store.EntryKind, str(id));
  return gone ? { ok: true, entry: gone } : fail('That entry is already gone.');
}

export function restore(kind: unknown, entry: unknown): Result {
  if (!(store.ENTRY_KINDS as unknown[]).includes(kind)) return fail('Unknown kind of entry.');
  return store.restoreEntry(kind as store.EntryKind, entry as never) ? { ok: true } : fail('Could not put it back.');
}

export function preview(text: unknown): { items: FoodItem[]; unknown: string[] } {
  return estimate(str(text).slice(0, 300));
}

export function search(q: unknown): TableMatch[] {
  return searchFoods(str(q).slice(0, 40));
}

export async function barcode(code: unknown): Promise<FoodItem | { error: string }> {
  return lookupBarcode(str(code).slice(0, 20));
}

export function saveUsual(name: unknown, payload: unknown): Result {
  const n = str(name).trim();
  if (!n) return fail('Give the meal a name, like "usual breakfast".');
  const f = foodFrom({ ...obj(payload), usual: '' });
  if ('error' in f) return fail(f.error);
  if (!f.items.length) return fail('None of those foods were recognised - list them with amounts, or add a barcode.');
  // Items keep their own label: barcode numbers are exact, table amounts stay estimates.
  return { ok: true, entry: store.saveUsual(n, f.items), detail: f.unknown.length ? `Left out (not recognised): ${f.unknown.join(', ')}.` : undefined };
}

export function removeUsual(name: unknown): Result {
  return store.removeUsual(str(name)) ? { ok: true } : fail('No saved meal by that name.');
}

export function scheduleAdd(payload: unknown): Result {
  const p = obj(payload);
  const kind = (['practice', 'game', 'gym', 'other'] as const).find((k) => k === p.kind) ?? 'other';
  return done(store.addSchedule({ kind, sport: str(p.sport) || undefined, day: num(p.day), start: str(p.start), minutes: num(p.minutes) || 60, note: str(p.note) || undefined }));
}

export function scheduleRemove(id: unknown): Result {
  return store.removeSchedule(str(id)) ? { ok: true } : fail('No schedule item with that id.');
}

/** The gym program's switch and restart, from its card in Train. */
export function program(action: unknown): Result {
  const a = str(action);
  if (a !== 'on' && a !== 'off' && a !== 'restart') return fail('Unknown program action.');
  store.setProgram(a);
  return { ok: true };
}
