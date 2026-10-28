import { readDoc, writeDoc } from '../../store';
import { emit } from '../../brain/events';

/*
 * The Health department's logs: sleep, training (with gym sets), food, water, pain, quick
 * check-ins, usual meals, day types and the weekly schedule. One JSON file in Ultron's data
 * folder (departments/health.json), copied into the daily backup. Private data: it only ever
 * reaches a brain trusted with it. Entries older than 180 days are dropped - the patterns that
 * matter are recent.
 *
 * Every entry can be edited or deleted (and a delete undone) - from the Health app or by
 * asking. Each save tells the app, so what was logged by chat or from the phone shows up there
 * straight away.
 */

export type Source = 'chat' | 'checkin' | 'phone' | 'pc' | 'label' | 'barcode' | 'app';

export const SLEEP_TAGS = ['woke in the night', 'phone in bed', 'late game', 'nap today', 'hard to fall asleep', 'woke before alarm'] as const;

export interface SleepEntry {
  id: string;
  /** The morning he woke up (YYYY-MM-DD) - "last night" belongs to today. */
  date: string;
  bed: string; // HH:MM, 24h
  wake: string;
  hours: number;
  quality?: number; // 1-5
  tags?: string[];
  note?: string;
  source: Source;
  at: number;
}

export type TrainingKind = 'soccer' | 'badminton' | 'gym' | 'run' | 'other';
export const TRAINING_KINDS: TrainingKind[] = ['soccer', 'badminton', 'gym', 'run', 'other'];

/** One set: reps (and kg when there is a weight), or seconds for a hold or a timed drill. */
export interface GymSet { reps?: number; kg?: number; secs?: number }
export interface GymExercise { name: string; sets: GymSet[]; note?: string }

export interface TrainingEntry {
  id: string;
  date: string;
  kind: TrainingKind;
  what?: string;
  minutes: number;
  effort: number; // 1-10
  /** Gym and drill sessions: what was done, set by set. */
  exercises?: GymExercise[];
  /** The library workout it followed, if any. */
  workout?: string;
  note?: string;
  source: Source;
  at: number;
}

export interface Nutrients {
  protein_g?: number;
  carbs_g?: number;
  fibre_g?: number;
  iron_mg?: number;
  calcium_mg?: number;
  vitd_ug?: number;
  /** Servings of fruit or vegetables. */
  fruitveg?: number;
}

export interface FoodItem {
  name: string;
  amount?: string;
  nutrients: Nutrients;
  /** From a label, a barcode or a saved usual meal - not an estimate. */
  exact: boolean;
}

export const MEALS = ['breakfast', 'lunch', 'dinner', 'snack', 'pre-training', 'post-training'] as const;
export type Meal = (typeof MEALS)[number];
export const isMeal = (m: unknown): m is Meal => (MEALS as readonly unknown[]).includes(m);

export interface FoodEntry {
  id: string;
  date: string;
  meal?: Meal;
  text: string;
  items: FoodItem[];
  /** Words the food table did not know - kept so nothing is silently invented. */
  unknown: string[];
  source: Source;
  at: number;
}

export interface PainEntry {
  id: string;
  date: string;
  where: string;
  side?: 'left' | 'right' | 'both';
  severity: number; // 1-10
  /** How it feels - sharp pain is the kind that means stop. */
  feel?: 'sharp' | 'dull' | 'ache' | 'tight';
  swelling?: boolean;
  /** When it hurts. */
  when?: 'training' | 'after' | 'rest' | 'morning';
  /** A follow-up on an earlier entry for the same spot. */
  status?: 'same' | 'better' | 'worse' | 'gone';
  note?: string;
  head?: boolean;
  at: number;
}

export interface CheckIn {
  id: string;
  date: string;
  energy?: number; // 1-5
  soreness?: number; // 1-5
  note?: string;
  at: number;
}

export interface WaterEntry { id: string; date: string; ml: number; at: number }

/** What kind of day it is - it changes what fuelling advice fits. */
export type DayType = 'training' | 'match' | 'rest';
export const DAY_TYPES: DayType[] = ['training', 'match', 'rest'];

export interface UsualMeal { name: string; items: FoodItem[]; saved: number }

/**
 * His 12-month gym program (program.ts). Its start is kept here, not worked out from the log: the log only
 * keeps 180 days and the program runs 52 weeks. It starts with the first program session he logs.
 */
export interface ProgramState { started?: string; off?: boolean }

export interface ScheduleItem {
  id: string;
  kind: 'practice' | 'game' | 'gym' | 'other';
  sport?: string;
  day: number; // 0 = Sunday
  start: string; // HH:MM
  minutes: number;
  note?: string;
}

export interface HealthDoc {
  v: 1;
  sleep: SleepEntry[];
  training: TrainingEntry[];
  food: FoodEntry[];
  water: WaterEntry[];
  pain: PainEntry[];
  checkins: CheckIn[];
  usual: UsualMeal[];
  schedule: ScheduleItem[];
  dayTypes: Record<string, DayType>;
  /** Always filled in by load(). */
  program?: ProgramState;
}

const DOC = 'departments/health.json';
const KEEP_DAYS = 180;

const empty = (): HealthDoc => ({ v: 1, sleep: [], training: [], food: [], water: [], pain: [], checkins: [], usual: [], schedule: [], dayTypes: {}, program: {} });

export function load(): HealthDoc {
  const d = readDoc<Partial<HealthDoc>>(DOC, empty());
  const list = <T>(x: unknown): T[] => (Array.isArray(x) ? (x as T[]) : []);
  return {
    v: 1,
    sleep: list(d.sleep),
    training: list(d.training),
    food: list(d.food),
    water: list(d.water),
    pain: list(d.pain),
    checkins: list(d.checkins),
    usual: list(d.usual),
    schedule: list(d.schedule),
    dayTypes: d.dayTypes && typeof d.dayTypes === 'object' && !Array.isArray(d.dayTypes) ? d.dayTypes : {},
    program: programState(d.program),
  };
}

function save(d: HealthDoc, now = Date.now()): void {
  const cutoff = now - KEEP_DAYS * 86_400_000;
  const keep = <T extends { at: number }>(xs: T[]) => xs.filter((x) => x.at >= cutoff);
  const oldest = isoDay(new Date(cutoff));
  const dayTypes = Object.fromEntries(Object.entries(d.dayTypes).filter(([k]) => k >= oldest));
  writeDoc(DOC, {
    ...d, sleep: keep(d.sleep), training: keep(d.training), food: keep(d.food), water: keep(d.water),
    pain: keep(d.pain), checkins: keep(d.checkins), dayTypes,
  });
  // The Health app redraws from this - whatever the entry came from (the app, chat, the phone).
  emit('health:changed', { at: now });
}

export const newId = (p: string) => `${p}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

export function isoDay(d = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const ISO = /^\d{4}-\d{2}-\d{2}$/;
/** A date he gave, or today. Never more than a day in the future (a typo, not a plan). */
function dateOr(date: string | undefined, now: Date): string {
  if (!date || !ISO.test(date) || Number.isNaN(Date.parse(`${date}T12:00:00`))) return isoDay(now);
  const tomorrow = isoDay(new Date(now.getTime() + 86_400_000));
  return date > tomorrow ? isoDay(now) : date;
}

/**
 * "11:30pm", "23:30", "7", "7am" - plain clock times. Returns HH:MM or null. A bare hour is read
 * the way people say it: a bedtime of "11" is 11 at night, a wake time of "7" is 7 in the morning.
 */
export function parseClock(s: string, as: 'bed' | 'wake' | 'any' = 'any'): string | null {
  const m = /^\s*(\d{1,2})(?::?(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)?\s*$/i.exec(String(s ?? ''));
  if (!m) return null;
  let h = Number(m[1]);
  const min = Number(m[2] ?? 0);
  const ap = (m[3] ?? '').toLowerCase().replace(/\./g, '');
  if (min > 59 || h > 24 || (ap && (h < 1 || h > 12))) return null;
  if (ap === 'pm' && h < 12) h += 12;
  if (ap === 'am' && h === 12) h = 0;
  // "Bed at 10:30" means the evening; "bed at 1" means after midnight; "slept 12 to 8" means midnight, not noon
  // (12 Oct 2026: it logged 20 hours).
  if (!ap && as === 'bed' && h >= 6 && h <= 11) h += 12;
  if (!ap && as === 'bed' && h === 12) h = 0;
  if (h === 24) h = 0;
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}

/** Hours slept from a bedtime and a wake time (24h), across midnight when it has to. */
export function hoursBetween(bed: string, wake: string): number {
  const [bh, bm] = bed.split(':').map(Number);
  const [wh, wm] = wake.split(':').map(Number);
  let mins = wh * 60 + wm - (bh * 60 + bm);
  if (mins <= 0) mins += 24 * 60;
  return Math.round((mins / 60) * 100) / 100;
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, Math.round(n)));
const text = (s: unknown, max = 400) => (typeof s === 'string' ? s.trim().slice(0, max) : '') || undefined;
const pick = <T extends string>(v: unknown, from: readonly T[]): T | undefined => (from as readonly unknown[]).includes(v) ? (v as T) : undefined;

/* ── Building entries (shared by adding and editing) ─────────────────── */

export interface SleepInput { bed: string; wake: string; date?: string; quality?: number; tags?: string[]; note?: string; source?: Source }
export function buildSleep(e: SleepInput, now = new Date()): SleepEntry | { error: string } {
  const bed = parseClock(e.bed, 'bed');
  const wake = parseClock(e.wake, 'wake');
  if (!bed || !wake) return { error: 'Give the bedtime and wake time as clock times, like 23:30 and 7:00.' };
  const hours = hoursBetween(bed, wake);
  if (hours < 1 || hours > 16) return { error: `${bed} to ${wake} is ${hours} hours - check the times.` };
  const tags = Array.isArray(e.tags) ? [...new Set(e.tags.map((t) => text(t, 40)).filter((t): t is string => Boolean(t)))].slice(0, 8) : [];
  return {
    id: newId('s'), date: dateOr(e.date, now), bed, wake, hours,
    quality: e.quality ? clamp(e.quality, 1, 5) : undefined,
    tags: tags.length ? tags : undefined,
    note: text(e.note), source: e.source ?? 'chat', at: now.getTime(),
  };
}

export interface TrainingInput { kind: string; minutes: number; effort: number; what?: string; date?: string; note?: string; exercises?: unknown; workout?: string; source?: Source }

/** Exercises as sent (from the app or a model): names kept short, numbers in sane ranges, empties dropped. */
export function cleanExercises(raw: unknown): GymExercise[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const num = (v: unknown, hi: number, dp = 0) => {
    const n = Number(v);
    if (!Number.isFinite(n) || n <= 0) return undefined;
    const f = 10 ** dp;
    return Math.min(hi, Math.round(n * f) / f);
  };
  const out: GymExercise[] = [];
  for (const x of raw.slice(0, 20)) {
    const o = (x ?? {}) as Record<string, unknown>;
    const name = text(o.name, 60);
    if (!name) continue;
    const sets = (Array.isArray(o.sets) ? o.sets : []).slice(0, 12).map((s) => {
      const so = (s ?? {}) as Record<string, unknown>;
      return { reps: num(so.reps, 200), kg: num(so.kg, 300, 2), secs: num(so.secs, 3600) };
    }).map((s) => Object.fromEntries(Object.entries(s).filter(([, v]) => v !== undefined)) as GymSet)
      .filter((s) => s.reps || s.secs);
    if (sets.length) out.push({ name, sets, note: text(o.note, 200) });
  }
  return out.length ? out : undefined;
}

export function buildTraining(e: TrainingInput, now = new Date()): TrainingEntry | { error: string } {
  const kind = pick(e.kind, TRAINING_KINDS) ?? 'other';
  if (!(e.minutes > 0 && e.minutes <= 360)) return { error: 'How many minutes was it?' };
  if (!(e.effort >= 1 && e.effort <= 10)) return { error: 'Effort is 1 (easy) to 10 (everything you had).' };
  return {
    id: newId('t'), date: dateOr(e.date, now), kind, what: text(e.what, 80),
    minutes: clamp(e.minutes, 1, 360), effort: clamp(e.effort, 1, 10),
    exercises: cleanExercises(e.exercises), workout: text(e.workout, 40),
    note: text(e.note), source: e.source ?? 'chat', at: now.getTime(),
  };
}

export interface FoodInput { text: string; items: FoodItem[]; unknown?: string[]; meal?: unknown; date?: string; source?: Source }
export function buildFood(e: FoodInput, now = new Date()): FoodEntry | { error: string } {
  const t = text(e.text, 300);
  if (!t && !e.items?.length) return { error: 'What did you eat?' };
  return {
    id: newId('f'), date: dateOr(e.date, now), meal: pick(e.meal, MEALS), text: t ?? e.items.map((i) => i.name).join(', '),
    items: (e.items ?? []).slice(0, 30), unknown: (e.unknown ?? []).slice(0, 20), source: e.source ?? 'chat', at: now.getTime(),
  };
}

export interface PainInput { where: string; severity: number; side?: unknown; feel?: unknown; swelling?: boolean; when?: unknown; status?: unknown; note?: string; head?: boolean; date?: string }
export function buildPain(e: PainInput, now = new Date()): PainEntry | { error: string } {
  const where = text(e.where, 60);
  if (!where) return { error: 'Where does it hurt?' };
  const note = text(e.note);
  return {
    id: newId('p'), date: dateOr(e.date, now), where, side: pick(e.side, ['left', 'right', 'both'] as const),
    severity: clamp(e.severity || 1, 1, 10), feel: pick(e.feel, ['sharp', 'dull', 'ache', 'tight'] as const),
    swelling: e.swelling ? true : undefined, when: pick(e.when, ['training', 'after', 'rest', 'morning'] as const),
    status: pick(e.status, ['same', 'better', 'worse', 'gone'] as const), note,
    head: e.head || /\bhead\b|concuss|skull|forehead/i.test(`${where} ${note ?? ''}`) || undefined, at: now.getTime(),
  };
}

/* ── Adding ───────────────────────────────────────────────────────────── */

export function addSleep(e: SleepInput, now = new Date()): SleepEntry | { error: string } {
  const entry = buildSleep(e, now);
  if ('error' in entry) return entry;
  const d = load();
  // One night per morning: a correction replaces what was logged.
  d.sleep = [...d.sleep.filter((s) => s.date !== entry.date), entry];
  save(d, now.getTime());
  return entry;
}

export function addTraining(e: TrainingInput, now = new Date()): TrainingEntry | { error: string } {
  const entry = buildTraining(e, now);
  if ('error' in entry) return entry;
  const d = load();
  d.training.push(entry);
  // The first program session starts the 12 months.
  if (entry.workout?.startsWith('fc-') && !d.program?.started) d.program = { ...d.program, started: entry.date };
  save(d, now.getTime());
  return entry;
}

function programState(x: unknown): ProgramState {
  if (!x || typeof x !== 'object') return {};
  const o = x as Record<string, unknown>;
  return { ...(typeof o.started === 'string' && ISO.test(o.started) ? { started: o.started } : {}), ...(o.off === true ? { off: true } : {}) };
}

/** Program on or off, or back to week 1 (the next program session starts it again). */
export function setProgram(action: 'on' | 'off' | 'restart', now = new Date()): ProgramState {
  const d = load();
  const next = action === 'off' ? { ...d.program, off: true } : action === 'on' ? { started: d.program?.started } : { off: d.program?.off };
  d.program = programState(next);
  save(d, now.getTime());
  return d.program;
}

export function addFood(e: Omit<FoodEntry, 'id' | 'at' | 'date'> & { date?: string }, now = new Date()): FoodEntry {
  const built = buildFood(e, now);
  const entry = 'error' in built ? { ...e, id: newId('f'), date: dateOr(e.date, now), at: now.getTime() } as FoodEntry : built;
  const d = load();
  d.food.push(entry);
  save(d, now.getTime());
  return entry;
}

export function addPain(e: PainInput, now = new Date()): PainEntry {
  const built = buildPain(e, now);
  const entry = 'error' in built ? buildPain({ ...e, where: 'unspecified' }, now) as PainEntry : built;
  const d = load();
  d.pain.push(entry);
  save(d, now.getTime());
  return entry;
}

export function addCheckIn(e: { energy?: number; soreness?: number; note?: string; date?: string }, now = new Date()): CheckIn {
  const d = load();
  const date = dateOr(e.date, now);
  const before = d.checkins.find((c) => c.date === date);
  const entry: CheckIn = {
    id: before?.id ?? newId('c'), date,
    energy: e.energy ? clamp(e.energy, 1, 5) : before?.energy,
    soreness: e.soreness ? clamp(e.soreness, 1, 5) : before?.soreness,
    note: text(e.note) ?? before?.note,
    at: now.getTime(),
  };
  d.checkins = [...d.checkins.filter((c) => c.date !== date), entry];
  save(d, now.getTime());
  return entry;
}

/** A drink of water (ml). Negative takes back a mis-tap; a day never goes below zero. */
export function addWater(ml: number, date?: string, now = new Date()): { date: string; total: number } | { error: string } {
  if (!Number.isFinite(ml) || ml === 0 || Math.abs(ml) > 2000) return { error: 'Give an amount in ml, like 250.' };
  const d = load();
  const day = dateOr(date, now);
  const total = d.water.filter((w) => w.date === day).reduce((n, w) => n + w.ml, 0);
  const add = Math.max(-total, Math.round(ml));
  if (add !== 0) d.water.push({ id: newId('w'), date: day, ml: add, at: now.getTime() });
  save(d, now.getTime());
  return { date: day, total: total + add };
}

export function setDayType(date: string, type: DayType | null, now = new Date()): void {
  const d = load();
  const day = dateOr(date, now);
  if (type && DAY_TYPES.includes(type)) d.dayTypes[day] = type;
  else delete d.dayTypes[day];
  save(d, now.getTime());
}

export function saveUsual(name: string, items: FoodItem[], now = Date.now()): UsualMeal {
  const d = load();
  const meal: UsualMeal = { name: name.trim().slice(0, 60), items: items.slice(0, 30), saved: now };
  d.usual = [...d.usual.filter((u) => u.name.toLowerCase() !== meal.name.toLowerCase()), meal];
  save(d, now);
  return meal;
}

export function removeUsual(name: string): boolean {
  const d = load();
  const n = d.usual.length;
  d.usual = d.usual.filter((u) => u.name.toLowerCase() !== name.trim().toLowerCase());
  if (d.usual.length === n) return false;
  save(d);
  return true;
}

export function findUsual(name: string): UsualMeal | undefined {
  const want = name.trim().toLowerCase().replace(/^(my|the)\s+/, '').replace(/^usual\s+/, '');
  return load().usual.find((u) => {
    const n = u.name.toLowerCase().replace(/^(my|the)\s+/, '').replace(/^usual\s+/, '');
    return n === want || want.includes(n);
  });
}

export function addSchedule(e: Omit<ScheduleItem, 'id'>): ScheduleItem | { error: string } {
  const start = parseClock(e.start);
  if (!start || !(e.day >= 0 && e.day <= 6)) return { error: 'Give a weekday and a start time.' };
  const d = load();
  const item: ScheduleItem = { ...e, sport: text(e.sport, 30), note: text(e.note, 120), id: newId('w'), start, minutes: clamp(e.minutes || 60, 10, 300) };
  d.schedule.push(item);
  save(d);
  return item;
}

export function removeSchedule(id: string): boolean {
  const d = load();
  const n = d.schedule.length;
  d.schedule = d.schedule.filter((s) => s.id !== id);
  if (d.schedule.length === n) return false;
  save(d);
  return true;
}

/* ── Editing, deleting and undoing a delete ──────────────────────────── */

export type EntryKind = 'sleep' | 'training' | 'food' | 'water' | 'pain' | 'checkins';
export const ENTRY_KINDS: EntryKind[] = ['sleep', 'training', 'food', 'water', 'pain', 'checkins'];
type AnyEntry = HealthDoc[EntryKind][number];
const listOf = (d: HealthDoc, kind: EntryKind) => d[kind] as AnyEntry[];
const setList = (d: HealthDoc, kind: EntryKind, xs: AnyEntry[]) => { (d as unknown as Record<EntryKind, AnyEntry[]>)[kind] = xs; };

/** Deletes one entry; returns it so the app can offer Undo. */
export function removeEntry(kind: EntryKind, id: string): AnyEntry | null {
  const d = load();
  const list = listOf(d, kind);
  const hit = list.find((x) => x.id === id);
  if (!hit) return null;
  setList(d, kind, list.filter((x) => x.id !== id));
  save(d);
  return hit;
}

/** Puts a deleted entry back exactly as it was (Undo). A night replaces any other for that morning. */
export function restoreEntry(kind: EntryKind, entry: AnyEntry): boolean {
  if (!ENTRY_KINDS.includes(kind) || !entry || typeof entry.id !== 'string' || typeof entry.at !== 'number' || !ISO.test(String(entry.date))) return false;
  const d = load();
  const list = listOf(d, kind).filter((x) => x.id !== entry.id && !((kind === 'sleep' || kind === 'checkins') && x.date === entry.date));
  setList(d, kind, [...list, entry]);
  save(d);
  return true;
}

/**
 * Edits one entry with the same checks as adding it. The id and when it was first logged are
 * kept, so it stays in the same place in the history.
 */
export function editEntry(kind: 'sleep', id: string, input: SleepInput): SleepEntry | { error: string };
export function editEntry(kind: 'training', id: string, input: TrainingInput): TrainingEntry | { error: string };
export function editEntry(kind: 'food', id: string, input: FoodInput): FoodEntry | { error: string };
export function editEntry(kind: 'pain', id: string, input: PainInput): PainEntry | { error: string };
export function editEntry(kind: 'sleep' | 'training' | 'food' | 'pain', id: string, input: SleepInput | TrainingInput | FoodInput | PainInput): AnyEntry | { error: string };
export function editEntry(kind: 'sleep' | 'training' | 'food' | 'pain', id: string, input: SleepInput | TrainingInput | FoodInput | PainInput): AnyEntry | { error: string } {
  const d = load();
  const old = listOf(d, kind).find((x) => x.id === id);
  if (!old) return { error: 'That entry is gone - it may have been deleted.' };
  const withDate = { ...input, date: (input as { date?: string }).date || old.date };
  const built = kind === 'sleep' ? buildSleep({ ...(withDate as SleepInput), source: (old as SleepEntry).source })
    : kind === 'training' ? buildTraining({ ...(withDate as TrainingInput), source: (old as TrainingEntry).source })
      : kind === 'food' ? buildFood({ ...(withDate as FoodInput), source: (old as FoodEntry).source })
        : buildPain(withDate as PainInput);
  if ('error' in built) return built;
  const entry = { ...built, id: old.id, at: old.at } as AnyEntry;
  const others = listOf(d, kind).filter((x) => x.id !== id && !(kind === 'sleep' && x.date === entry.date));
  setList(d, kind, [...others, entry]);
  save(d);
  return entry;
}
