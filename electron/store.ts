import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';

export interface IndexedFolder {
  path: string;
  addedAt: number;
  fileCount: number;
}

export interface Settings {
  profile: {
    location: string;
    interests: string[];
    notes: string;
  };
  news: {
    autoRefreshMinutes: number;
    dailyCap: number;
    categories: string[];
    country: string;
  };
  ollama: {
    host: string;
    model: string;
  };
  voice: {
    /** Exact SpeechSynthesis voice name, or '' to auto-pick the deepest English voice. */
    name: string;
    rate: number;
    pitch: number;
  };
  folders: IndexedFolder[];
}

export interface QuotaState {
  date: string; // YYYY-MM-DD, local
  used: number;
}

const DEFAULTS: Settings = {
  profile: {
    location: 'Calgary, Alberta, Canada',
    interests: ['soccer', 'history', 'technology', 'economy', 'education'],
    notes: 'Grade 9 student in Calgary. Plays club soccer and badminton. Deeply into history.',
  },
  news: {
    autoRefreshMinutes: 60,
    dailyCap: 100,
    categories: ['world', 'nation'],
    country: 'ca',
  },
  ollama: { host: 'http://localhost:11434', model: 'llama3.2' },
  // Deep and deliberate - as close to Ultron as the OS voices get.
  voice: { name: '', rate: 0.93, pitch: 0.8 },
  folders: [],
};

function filePath(name: string): string {
  return path.join(app.getPath('userData'), name);
}

function readJson<T>(name: string, fallback: T): T {
  try {
    const p = filePath(name);
    if (!fs.existsSync(p)) return fallback;
    return { ...fallback, ...JSON.parse(fs.readFileSync(p, 'utf8')) } as T;
  } catch {
    return fallback;
  }
}

function writeJson(name: string, data: unknown): void {
  const p = filePath(name);
  try {
    fs.mkdirSync(path.dirname(p), { recursive: true });
    // Write to a temp file and rename over the target - a straight
    // writeFileSync left a truncated file (and a silently reset quota
    // counter) if the process died mid-write; rename is atomic on the same
    // filesystem.
    const tmp = `${p}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
    fs.renameSync(tmp, p);
  } catch {
    // A failed persist should degrade to "in-memory value only" for this
    // call, not throw through read paths (getQuota calls this internally).
  }
}

export function getSettings(): Settings {
  const s = readJson<Settings>('settings.json', DEFAULTS);
  // Deep-merge the nested objects so new defaults survive old files
  return {
    profile: { ...DEFAULTS.profile, ...s.profile },
    news: { ...DEFAULTS.news, ...s.news },
    ollama: { ...DEFAULTS.ollama, ...s.ollama },
    voice: { ...DEFAULTS.voice, ...s.voice },
    folders: Array.isArray(s.folders) ? s.folders : [],
  };
}

export function saveSettings(patch: Partial<Settings>): Settings {
  const next = { ...getSettings(), ...patch };
  writeJson('settings.json', next);
  return next;
}

function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate(),
  ).padStart(2, '0')}`;
}

export function getQuota(): QuotaState {
  const q = readJson<QuotaState>('news-quota.json', { date: today(), used: 0 });
  // A corrupted/partial write or hand-edited file with a non-numeric `used`
  // would otherwise make `used + cost` do string concatenation, and the cap
  // check `"...` > 100` coerces to NaN > 100 -> false - silently disabling
  // the 100/day guard until the file is fixed.
  const usedOk = typeof q.used === 'number' && Number.isFinite(q.used) && q.used >= 0;
  if (q.date !== today() || !usedOk) {
    const reset = { date: today(), used: 0 };
    writeJson('news-quota.json', reset);
    return reset;
  }
  return q;
}

export function bumpQuota(by = 1): QuotaState {
  const q = getQuota();
  const next = { date: q.date, used: q.used + by };
  writeJson('news-quota.json', next);
  return next;
}

/**
 * Reserves `cost` requests against today's quota atomically (read-modify-
 * write with nothing awaited in between) and returns whether the reservation
 * fit under the cap. Callers must reserve before making any network request -
 * bumping the counter only after the fact leaves a window where two
 * concurrent fetches (auto-refresh firing alongside a manual refresh) can
 * both pass the cap check and push combined usage over 100/day.
 */
export function reserveQuota(cost: number, cap: number): { ok: boolean; quota: QuotaState } {
  const q = getQuota();
  if (q.used + cost > cap) return { ok: false, quota: q };
  const next = { date: q.date, used: q.used + cost };
  writeJson('news-quota.json', next);
  return { ok: true, quota: next };
}

/** Rolls back a reservation for categories that failed before actually
 *  costing a real request (e.g. rejected with 401 before any data returned). */
export function releaseQuota(by: number): QuotaState {
  const q = getQuota();
  const next = { date: q.date, used: Math.max(0, q.used - by) };
  writeJson('news-quota.json', next);
  return next;
}

/* ── News cache ─────────────────────────────────────────────────────────
   Headlines are cached to disk so relaunching the app does not burn two
   requests out of the free 100/day for stories we already have.          */

export interface NewsCache<T> {
  fetchedAt: number;
  articles: T[];
}

export function getNewsCache<T>(): NewsCache<T> {
  return readJson<NewsCache<T>>('news-cache.json', { fetchedAt: 0, articles: [] });
}

export function saveNewsCache<T>(articles: T[]): void {
  writeJson('news-cache.json', { fetchedAt: Date.now(), articles });
}
