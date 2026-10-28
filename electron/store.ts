import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';

export interface IndexedFolder {
  path: string;
  addedAt: number;
  fileCount: number;
}

export type BrainChoice = 'auto' | 'gemini' | 'cloud' | 'ollama';
export type ThinkingMode = 'deep' | 'balanced' | 'fast';
export type WorkflowVersion = 'v1' | 'v2' | 'v3';
export type ResearchDepth = 'quick' | 'standard' | 'deep';
export type TeamMode = 'auto' | 'full';

export interface Settings {
  schema: number;
  profile: {
    name: string;
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
    numCtx: number;
    /** A second local model for Athena's thinking work (plans, comparisons, hard problems in team jobs). '' = off. */
    reasoningModel: string;
  };
  /** auto = Gemini when its key works, the local model otherwise (and for background jobs). */
  brain: BrainChoice;
  /** deep = Gemini Pro and full reasoning on hard steps; balanced = full reasoning on Flash; fast = quicker, lighter reasoning. */
  thinking: ThinkingMode;
  gemini: {
    /** '' = pick the newest available Flash model automatically. */
    model: string;
  };
  team: {
    /** auto = the lead pulls in whoever the task needs; full = every specialist contributes on every task. */
    mode: TeamMode;
  };
  voice: {
    /** ultron = Kokoro on this PC with the Ultron effect (11 Oct 2026); system = the Windows voices. */
    engine: 'ultron' | 'system';
    /** Which Kokoro voice (voice/kokoro.ts ULTRON_VOICES). */
    ultronVoice: string;
    /** How strong the Ultron effect is, 0 (clean) to 1 (full robot). */
    effect: number;
    /** Exact SpeechSynthesis voice name, or '' to auto-pick the deepest English voice. */
    name: string;
    rate: number;
    pitch: number;
    speakReminders: boolean;
    /** Listen for "Ultron" - remembered across restarts. */
    wakeWord: boolean;
  };
  vault: {
    /** '' = ~/Ultron Vault */
    path: string;
  };
  composio: {
    userId: string;
  };
  d2l: {
    baseUrl: string;
  };
  /** The agents' browser: hidden (watch it in the HUD) or real windows on screen. */
  browser: {
    visible: boolean;
  };
  /** Which version of the team's workflow runs - v1 is the earlier behaviour, kept so changes can be compared and undone. */
  workflow: WorkflowVersion;
  research: {
    /** How much deep_research does when a request doesn't say. */
    depth: ResearchDepth;
  };
  /** Per-request budget: past any of these the team stops starting new work and writes up what it has. */
  limits: {
    maxCalls: number;
    maxTokens: number;
    minutes: number;
  };
  /** Open-source add-ons in ~/UltronTools (addons.ts). */
  addons: {
    /** Hindsight memory server beside the vault (runs the local model in the background). */
    hindsight: boolean;
    /** Ask before each browser-agent run. Off: it runs sandboxed (logged out, one site, no downloads) without asking. */
    askBrowserAgent: boolean;
  };
  /** A short spoken rundown of the day, once a day after the chosen hour. */
  briefing: { on: boolean; hour: number };
  /** The free AI services Ultron may borrow a bigger brain from (clouds.ts), by service id. */
  clouds: Record<string, { model?: string; baseUrl?: string; off?: boolean; rank?: number }>;
  /** When each background job last ran (epoch ms), so schedules survive a restart. */
  jobs: Record<string, number>;
  folders: IndexedFolder[];
  /** The privacy wall (brain/privacy.ts). */
  privacy: {
    /** Free AI services trusted with private data (health, grades, injuries) - they neither keep nor train on it. The local model always is. */
    trusted: string[];
    /** Extra words that must never leave in a web search or address: a full name, email, phone, username, address. */
    terms: string[];
  };
  /** The operator's HQ folder, read into the shared brain read-only. '' = the usual place (OneDrive/Desktop/Claude Code testing). */
  hq: { path: string; on: boolean };
  /** Each automatic tracker's own switch. All local, all private. */
  trackers: { pcActivity: boolean; games: boolean };
  /** Hypnos' wind-down nudge: on school nights (and before morning sessions), 30 min before "in bed by". wake '' = his usual. */
  health: { bedtimeNudge: boolean; wake: string; hours: number };
  /** PowerSchool (CBE's MyCBE) - he signs in himself in its own window; read-only. */
  powerschool: { baseUrl: string };
  /** Helios, the background researcher: hourly feed pulls and three sweeps a day while idle. */
  helios: { on: boolean };
  /** His own Discord account, linked by a code - the only one whose DMs to the bot are read. */
  phone: { discordUserId: string };
  /** AI services he added himself (a preset or any OpenAI-compatible address); their keys are in secrets.json. */
  customClouds: { id: string; label: string; baseUrl: string; model?: string; modelsUrl?: string; signup?: string; free?: string; noKey?: boolean; freeOnly?: boolean; prefer?: string[] }[];
}

export interface QuotaState {
  date: string; // YYYY-MM-DD, local
  used: number;
}

const SCHEMA = 2;
const LEGACY_DEFAULT_MODELS = new Set(['llama3.2', 'llama3.2:latest', '']);

const DEFAULTS: Settings = {
  schema: SCHEMA,
  profile: {
    name: 'Shae',
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
  // DeepSeek-R1 8B (R1-0528 distilled into Qwen3-8B): stronger at maths and step-by-step logic, slower. If it
  // isn't downloaded, reasoning jobs simply stay on the main local model.
  ollama: { host: 'http://localhost:11434', model: 'qwen3.5:4b', numCtx: 8192, reasoningModel: 'deepseek-r1:8b' },
  brain: 'auto',
  thinking: 'deep',
  gemini: { model: '' },
  team: { mode: 'auto' },
  voice: { engine: 'ultron', ultronVoice: 'am_michael', effect: 0.6, name: '', rate: 0.93, pitch: 0.8, speakReminders: true, wakeWord: false },
  vault: { path: '' },
  composio: { userId: 'ultron' },
  d2l: { baseUrl: 'https://d2l.cbe.ab.ca' },
  browser: { visible: false },
  // v2, not v3: on 12 fresh held-out hard problems v3 (the program solver) scored 20/24 to v2's 21/24 at 2-3x the
  // time (evals/README.md, 30 Sep 2026), so it stays a choice in Settings rather than the default.
  workflow: 'v2',
  research: { depth: 'standard' },
  limits: { maxCalls: 60, maxTokens: 600_000, minutes: 10 },
  addons: { hindsight: true, askBrowserAgent: false },
  briefing: { on: true, hour: 7 },
  clouds: {},
  jobs: {},
  // Groq keeps no prompts and trains on none by default (checked 9 Oct 2026). Gemini's free tier, OpenRouter's
  // free models and NVIDIA's trial may keep or learn from what they're sent; OpenAI keeps prompts for 30 days.
  privacy: { trusted: ['groq'], terms: [] },
  hq: { path: '', on: true },
  trackers: { pcActivity: true, games: true },
  health: { bedtimeNudge: true, wake: '', hours: 9 },
  powerschool: { baseUrl: 'https://sis.cbe.ab.ca' },
  helios: { on: true },
  phone: { discordUserId: '' },
  customClouds: [],
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
    // Temp file + rename: a crash mid-write can't leave a truncated file behind.
    const tmp = `${p}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
    fs.renameSync(tmp, p);
  } catch (e) {
    // A failed persist degrades to "in-memory value only" rather than throwing through reads - but say so.
    console.warn(`[ultron] could not save ${name}:`, e instanceof Error ? e.message : e);
  }
}

function clampInt(v: unknown, min: number, max: number, fallback: number): number {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : fallback;
}

function normalize(raw: Partial<Settings> & { brain?: string }): Settings {
  const s = { ...DEFAULTS, ...raw } as Settings;
  const out: Settings = {
    schema: SCHEMA,
    profile: { ...DEFAULTS.profile, ...s.profile },
    news: { ...DEFAULTS.news, ...s.news },
    ollama: { ...DEFAULTS.ollama, ...s.ollama },
    brain: s.brain === 'gemini' || s.brain === 'cloud' || s.brain === 'ollama' || s.brain === 'auto' ? s.brain : 'auto',
    thinking: s.thinking === 'balanced' || s.thinking === 'fast' ? s.thinking : 'deep',
    gemini: { ...DEFAULTS.gemini, ...s.gemini },
    team: { mode: s.team?.mode === 'full' ? 'full' : 'auto' },
    voice: { ...DEFAULTS.voice, ...s.voice },
    vault: { ...DEFAULTS.vault, ...s.vault },
    composio: { ...DEFAULTS.composio, ...s.composio },
    d2l: { ...DEFAULTS.d2l, ...s.d2l },
    browser: { visible: s.browser?.visible === true },
    workflow: s.workflow === 'v1' || s.workflow === 'v3' ? s.workflow : 'v2',
    research: { depth: s.research?.depth === 'quick' || s.research?.depth === 'deep' ? s.research.depth : 'standard' },
    limits: {
      maxCalls: clampInt(s.limits?.maxCalls, 10, 400, DEFAULTS.limits.maxCalls),
      maxTokens: clampInt(s.limits?.maxTokens, 50_000, 5_000_000, DEFAULTS.limits.maxTokens),
      minutes: clampInt(s.limits?.minutes, 2, 60, DEFAULTS.limits.minutes),
    },
    addons: { hindsight: s.addons?.hindsight !== false, askBrowserAgent: s.addons?.askBrowserAgent === true },
    briefing: { on: s.briefing?.on !== false, hour: clampInt(s.briefing?.hour, 0, 23, DEFAULTS.briefing.hour) },
    clouds: s.clouds && typeof s.clouds === 'object' ? s.clouds : {},
    jobs: s.jobs && typeof s.jobs === 'object' ? s.jobs : {},
    folders: Array.isArray(s.folders) ? s.folders : [],
    privacy: {
      trusted: Array.isArray(s.privacy?.trusted) ? s.privacy.trusted.filter((t): t is string => typeof t === 'string') : [...DEFAULTS.privacy.trusted],
      terms: Array.isArray(s.privacy?.terms) ? s.privacy.terms.filter((t): t is string => typeof t === 'string' && t.trim().length > 1) : [],
    },
    hq: { path: typeof s.hq?.path === 'string' ? s.hq.path : '', on: s.hq?.on !== false },
    trackers: { pcActivity: s.trackers?.pcActivity !== false, games: s.trackers?.games !== false },
    health: {
      bedtimeNudge: s.health?.bedtimeNudge !== false,
      wake: typeof s.health?.wake === 'string' && /^\d{2}:\d{2}$/.test(s.health.wake) ? s.health.wake : '',
      hours: typeof s.health?.hours === 'number' && s.health.hours >= 8 && s.health.hours <= 10 ? Math.round(s.health.hours * 2) / 2 : 9,
    },
    powerschool: { baseUrl: typeof s.powerschool?.baseUrl === 'string' && /^https:\/\//.test(s.powerschool.baseUrl) ? s.powerschool.baseUrl : 'https://sis.cbe.ab.ca' },
    helios: { on: s.helios?.on !== false },
    customClouds: Array.isArray(s.customClouds)
      ? s.customClouds.filter((c) => c && typeof c.id === 'string' && /^[a-z0-9-]{1,30}$/.test(c.id) && typeof c.label === 'string' && typeof c.baseUrl === 'string')
      : [],
    phone: { discordUserId: typeof s.phone?.discordUserId === 'string' && /^\d{15,22}$/.test(s.phone.discordUserId) ? s.phone.discordUserId : '' },
  };
  if (!/^https:\/\/[^\s/]+/.test(out.d2l.baseUrl)) out.d2l.baseUrl = DEFAULTS.d2l.baseUrl;
  // The Ultron voice: a known engine, a real-looking voice id and an effect between 0 and 1.
  if (out.voice.engine !== 'system') out.voice.engine = 'ultron';
  if (!/^[ab][mf]_[a-z]+$/.test(String(out.voice.ultronVoice))) out.voice.ultronVoice = DEFAULTS.voice.ultronVoice;
  out.voice.effect = Number.isFinite(out.voice.effect) ? Math.min(1, Math.max(0, out.voice.effect)) : DEFAULTS.voice.effect;
  if (!Number.isFinite(out.ollama.numCtx) || out.ollama.numCtx < 2048) out.ollama.numCtx = DEFAULTS.ollama.numCtx;
  if (!out.composio.userId.trim()) out.composio.userId = DEFAULTS.composio.userId;

  // Schema 1 (the Atlas build) defaulted to llama3.2 on Ollama and a Gemini
  // model Google has since retired - move those onto the new defaults once.
  if ((raw.schema ?? 1) < 2) {
    if (LEGACY_DEFAULT_MODELS.has(out.ollama.model)) out.ollama.model = DEFAULTS.ollama.model;
    if (/^gemini-(1\.|2\.0)/.test(out.gemini.model)) out.gemini.model = '';
    if (raw.brain === 'ollama' || raw.brain === undefined) out.brain = 'auto';
  }
  return out;
}

export function getSettings(): Settings {
  const raw = readJson<Partial<Settings>>('settings.json', {});
  const settings = normalize(raw);
  if ((raw.schema ?? 1) < SCHEMA) writeJson('settings.json', settings);
  return settings;
}

export function saveSettings(patch: Partial<Settings>): Settings {
  const current = getSettings();
  const next = normalize({
    ...current,
    ...patch,
    profile: { ...current.profile, ...patch.profile },
    news: { ...current.news, ...patch.news },
    ollama: { ...current.ollama, ...patch.ollama },
    gemini: { ...current.gemini, ...patch.gemini },
    team: { ...current.team, ...patch.team },
    voice: { ...current.voice, ...patch.voice },
    vault: { ...current.vault, ...patch.vault },
    composio: { ...current.composio, ...patch.composio },
    d2l: { ...current.d2l, ...patch.d2l },
    browser: { ...current.browser, ...patch.browser },
    research: { ...current.research, ...patch.research },
    limits: { ...current.limits, ...patch.limits },
    addons: { ...current.addons, ...patch.addons },
    briefing: { ...current.briefing, ...patch.briefing },
    clouds: { ...current.clouds, ...patch.clouds },
    jobs: { ...current.jobs, ...patch.jobs },
    privacy: { ...current.privacy, ...patch.privacy },
    hq: { ...current.hq, ...patch.hq },
    trackers: { ...current.trackers, ...patch.trackers },
    health: { ...current.health, ...patch.health },
    powerschool: { ...current.powerschool, ...patch.powerschool },
    helios: { ...current.helios, ...patch.helios },
    phone: { ...current.phone, ...patch.phone },
  });
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
  // A non-numeric `used` would turn the cap check into string concatenation
  // and silently disable the 100/day guard.
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
 * write with nothing awaited in between). Callers must reserve before the
 * network request, or two concurrent fetches can both pass the cap check.
 */
export function reserveQuota(cost: number, cap: number): { ok: boolean; quota: QuotaState } {
  const q = getQuota();
  if (q.used + cost > cap) return { ok: false, quota: q };
  const next = { date: q.date, used: q.used + cost };
  writeJson('news-quota.json', next);
  return { ok: true, quota: next };
}

/** Rolls back a reservation for categories that failed before costing a real request. */
export function releaseQuota(by: number): QuotaState {
  const q = getQuota();
  const next = { date: q.date, used: Math.max(0, q.used - by) };
  writeJson('news-quota.json', next);
  return next;
}

/* ── News cache: relaunching the app shouldn't burn requests on stories we already have. */

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

/* ── Generic small JSON documents in userData (tasks, caches). */

export function readDoc<T>(name: string, fallback: T): T {
  try {
    const p = filePath(name);
    if (!fs.existsSync(p)) return fallback;
    return JSON.parse(fs.readFileSync(p, 'utf8')) as T;
  } catch {
    return fallback;
  }
}

export function writeDoc(name: string, data: unknown): void {
  writeJson(name, data);
}
