/**
 * CM8's memory, ported.
 *
 * Deliberately uses the SAME localStorage key and the same blob shape as the
 * CM8 app (cm8_state_v2), so a browser profile that has both sees one shared
 * history rather than two diverging ones. Meals are immutable once written and
 * merge by id; plans merge by savedAt; deletions travel as tombstones so a
 * delete cannot be resurrected by a merge.
 */
import type { EntryKind, Totals, TrainingLoad } from './nutrition';

const LS_KEY = 'cm8_state_v2';

export interface Meal {
  id: string;
  time: string;
  type: string;
  text: string;
  score: number | null;
  kind?: EntryKind;
  n?: Partial<Totals>;
  items?: { name: string; servings: number }[];
  ts: number;
}

export interface BusyBlock { label: string; start: number; end: number }

export interface DayPlan {
  sleptAt?: string;
  wokeAt?: string;
  wakeTarget?: string;
  training?: TrainingLoad;
  homework?: number;
  busy?: BusyBlock[];
  notes?: string;
  savedAt: number;
}

export interface Profile { weightKg: number; savedAt?: number }

export interface Cm8State {
  v: 2;
  food: Record<string, Meal[]>;
  plans: Record<string, DayPlan>;
  profile?: Profile;
  tombstones: { id: string; at: number }[];
  updated: number;
}

const EMPTY: Cm8State = { v: 2, food: {}, plans: {}, tombstones: [], updated: 0 };

/* ---------- dates ---------- */
const pad = (n: number) => String(n).padStart(2, '0');
export const dateKey = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const todayKey = () => dateKey(new Date());
export function shiftKey(key: string, days: number): string {
  const [y, m, d] = key.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + days);
  return dateKey(dt);
}
export const tomorrowKey = () => shiftKey(todayKey(), 1);

export function prettyDate(key: string): string {
  const [y, m, d] = key.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  if (key === todayKey()) return 'Today';
  if (key === tomorrowKey()) return 'Tomorrow';
  if (key === shiftKey(todayKey(), -1)) return 'Yesterday';
  return dt.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
}

const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

/* ---------- load / save ---------- */
function load(): Cm8State {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) {
      const s = JSON.parse(raw) as Cm8State;
      if (s && s.v === 2) {
        return { ...EMPTY, ...s, food: s.food || {}, plans: s.plans || {}, tombstones: s.tombstones || [] };
      }
    }
  } catch { /* fall through to empty */ }
  return JSON.parse(JSON.stringify(EMPTY)) as Cm8State;
}

let state: Cm8State = load();
const listeners = new Set<() => void>();

function persist() {
  state.updated = Date.now();
  try { localStorage.setItem(LS_KEY, JSON.stringify(state)); } catch { /* quota - keep in memory */ }
  listeners.forEach((fn) => { try { fn(); } catch { /* a bad listener must not stop the rest */ } });
}

export function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

export const raw = () => state;

/* ---------- food ---------- */
export const food = {
  day(date?: string): Meal[] {
    return (state.food[date || todayKey()] || []).slice();
  },
  add(date: string | null, meal: Omit<Meal, 'id' | 'ts'> & Partial<Pick<Meal, 'id' | 'ts'>>): Meal {
    const key = date || todayKey();
    const m: Meal = { id: uid(), ts: Date.now(), ...meal } as Meal;
    (state.food[key] = state.food[key] || []).push(m);
    persist();
    return m;
  },
  remove(date: string, id: string) {
    const list = state.food[date] || [];
    const i = list.findIndex((m) => m.id === id);
    if (i < 0) return;
    list.splice(i, 1);
    if (!list.length) delete state.food[date];
    state.tombstones.unshift({ id, at: Date.now() });
    state.tombstones = state.tombstones.slice(0, 500);
    persist();
  },
  days(): string[] {
    return Object.keys(state.food).filter((d) => (state.food[d] || []).length).sort().reverse();
  },
  /** Drinks carry no meal score, so they must not drag the day's average down. */
  scoreable(date: string): Meal[] {
    return (state.food[date] || []).filter((m) => m.kind !== 'drink' && typeof m.score === 'number');
  },
  dayStats(date: string) {
    const meals = food.scoreable(date);
    if (!meals.length) return null;
    const avg = Math.round(meals.reduce((a, m) => a + (m.score || 0), 0) / meals.length);
    return {
      count: meals.length,
      avg,
      verdict: avg >= 70 ? 'Strong' : avg >= 50 ? 'Decent' : avg >= 35 ? 'Patchy' : 'Poor',
    };
  },
  /** What Shae actually eats, most-repeated first - this is what makes logging fast. */
  recent(limit = 8) {
    const seen: Record<string, { text: string; type: string; score: number | null; count: number; last: number }> = {};
    for (const d of food.days()) {
      for (const m of state.food[d] || []) {
        const text = (m.text || '').trim();
        if (!text || text === 'Photo + answers') continue;
        const key = text.toLowerCase();
        if (!seen[key]) seen[key] = { text, type: m.type, score: m.score, count: 0, last: m.ts || 0 };
        seen[key].count++;
        seen[key].last = Math.max(seen[key].last, m.ts || 0);
      }
    }
    return Object.values(seen)
      .sort((a, b) => b.count - a.count || b.last - a.last)
      .slice(0, limit);
  },
};

/* ---------- day plans ---------- */
export const plans = {
  get: (date: string): DayPlan | null => state.plans[date] || null,
  set(date: string, plan: Omit<DayPlan, 'savedAt'>): DayPlan {
    state.plans[date] = { ...plan, savedAt: Date.now() };
    persist();
    return state.plans[date];
  },
  clear(date: string) {
    if (state.plans[date]) { delete state.plans[date]; persist(); }
  },
  dates: () => Object.keys(state.plans).sort(),
  upcoming() {
    const today = todayKey();
    return plans.dates().filter((d) => d >= today).map((d) => ({ date: d, plan: state.plans[d] }));
  },
};

/* ---------- profile ---------- */
export const profile = {
  get: (): Profile => ({ weightKg: 55, ...(state.profile || {}) }),
  set(next: Partial<Profile>): Profile {
    state.profile = { ...profile.get(), ...next, savedAt: Date.now() };
    persist();
    return state.profile;
  },
  weightKg(): number {
    const w = Number(profile.get().weightKg);
    return w >= 25 && w <= 150 ? w : 55;
  },
};

/* ---------- merge (for sync, and for two windows sharing one origin) ---------- */
export function mergeStates(a: Cm8State, b: Cm8State): Cm8State {
  const out: Cm8State = {
    v: 2, food: {}, plans: {}, tombstones: [],
    updated: Math.max(a.updated || 0, b.updated || 0),
  };

  const tomb: Record<string, number> = {};
  for (const t of [...(a.tombstones || []), ...(b.tombstones || [])]) {
    if (t && t.id) tomb[t.id] = Math.max(tomb[t.id] || 0, t.at || 0);
  }
  out.tombstones = Object.keys(tomb)
    .map((id) => ({ id, at: tomb[id] }))
    .sort((x, y) => y.at - x.at)
    .slice(0, 500);

  for (const d of new Set([...Object.keys(a.food || {}), ...Object.keys(b.food || {})])) {
    const byId: Record<string, Meal> = {};
    for (const m of [...((a.food || {})[d] || []), ...((b.food || {})[d] || [])]) {
      if (!m || !m.id || tomb[m.id]) continue;
      const prev = byId[m.id];
      if (!prev || (m.ts || 0) > (prev.ts || 0)) byId[m.id] = m;
    }
    const meals = Object.values(byId).sort((x, y) => (x.ts || 0) - (y.ts || 0));
    if (meals.length) out.food[d] = meals;
  }

  for (const d of new Set([...Object.keys(a.plans || {}), ...Object.keys(b.plans || {})])) {
    const pa = (a.plans || {})[d];
    const pb = (b.plans || {})[d];
    out.plans[d] = !pa ? pb : !pb ? pa : (pb.savedAt || 0) > (pa.savedAt || 0) ? pb : pa;
  }

  const qa = a.profile;
  const qb = b.profile;
  out.profile = !qa ? qb : !qb ? qa : (qb.savedAt || 0) > (qa.savedAt || 0) ? qb : qa;

  return out;
}

/** Another window on the same origin wrote - pull it in rather than clobber. */
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key !== LS_KEY || !e.newValue) return;
    try {
      const incoming = JSON.parse(e.newValue) as Cm8State;
      if (incoming && incoming.v === 2) {
        state = mergeStates(state, incoming);
        listeners.forEach((fn) => { try { fn(); } catch { /* ignore */ } });
      }
    } catch { /* ignore malformed */ }
  });
}
