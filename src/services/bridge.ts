import type { UltronBridge } from '../types/global';
import { SECRET_NAMES, type SecretName } from '../types';
import type { Settings } from '../types';

/**
 * Access point for the preload bridge. Inside Electron this is the real
 * `window.ultron`. Opened directly in a browser (`npx vite`, for quick visual
 * iteration) there is no preload, so a null implementation reports every
 * capability as unavailable - it never fabricates data.
 */

export const inElectron = typeof window !== 'undefined' && Boolean((window as unknown as { ultron?: unknown }).ultron);

const unavailable = (what: string) => `${what} is only available in the Electron app.`;
const noop = () => () => {};

const DEFAULT_SETTINGS: Settings = {
  schema: 2,
  profile: { name: 'Shae', location: 'Calgary, Alberta, Canada', interests: [], notes: '' },
  news: { autoRefreshMinutes: 60, dailyCap: 100, categories: ['world', 'nation'], country: 'ca' },
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
  workflow: 'v2',
  research: { depth: 'standard' },
  limits: { maxCalls: 60, maxTokens: 600_000, minutes: 10 },
  addons: { hindsight: true, askBrowserAgent: false },
  briefing: { on: true, hour: 7 },
  clouds: {},
  jobs: {},
  folders: [],
  privacy: { trusted: ['groq'], terms: [] },
  hq: { path: '', on: true },
  trackers: { pcActivity: true, games: true },
  health: { bedtimeNudge: true, wake: '', hours: 9 },
  powerschool: { baseUrl: 'https://sis.cbe.ab.ca' },
  helios: { on: true },
  phone: { discordUserId: '' },
  customClouds: [],
};

const offlineOllama = {
  running: false, host: 'http://localhost:11434', models: [], activeModel: 'qwen3.5:4b', modelInstalled: false, error: unavailable('Ollama'),
};

const nullBridge: UltronBridge = {
  win: { minimize: async () => {}, maximize: async () => false, close: async () => {}, show: async () => {}, onState: noop },
  notify: { show: async () => ({ ok: false }) },
  brain: {
    ask: async () => ({ ok: false, error: unavailable('The brain') }),
    cancel: async () => {},
    status: async () => ({
      active: null, label: 'BRAIN OFFLINE', model: null,
      gemini: { configured: false, valid: null, model: null, liveModel: null, models: [] },
      ollama: offlineOllama,
      clouds: [],
    }),
    recheck: async () => nullBridge.brain.status(),
    usage: async () => ({ choice: 'auto', using: [], notUsing: [] }),
    once: async () => ({ ok: false as const, error: unavailable('The brain') }),
    greet: async () => ({ ok: false, error: unavailable('The brain') }),
    agents: async () => [],
    liveVoice: async () => ({ key: '', model: null }),
    onEvent: noop,
  },
  clouds: {
    presets: async () => [],
    add: async () => ({ ok: false, error: unavailable('AI services') }),
    remove: async () => false,
    setKey: async () => ({ ok: false, error: unavailable('AI services') }),
    pasteKey: async () => ({ ok: false, error: unavailable('AI services') }),
  },
  council: {
    state: async () => ({ seats: [], helios: { built: true as const, on: false, budget: { used: 0, cap: 40 }, nextSweep: 0, lastPull: 0, today: 0, requests: [], log: [], intel: {} }, phone: { linked: false, connected: false, botReady: false } }),
    line: async () => '',
    convene: async () => ({ at: Date.now(), lines: [], summary: unavailable('The council') }),
    phoneLink: async () => ({ code: '', expires: 0 }),
    helios: async () => nullBridge.council.state().then((s) => s.helios),
    onReview: noop,
  },
  health: {
    view: async () => { throw new Error(unavailable('Health')); },
    log: async () => ({ ok: false as const, error: unavailable('Health') }),
    edit: async () => ({ ok: false as const, error: unavailable('Health') }),
    remove: async () => ({ ok: false as const, error: unavailable('Health') }),
    restore: async () => ({ ok: false as const, error: unavailable('Health') }),
    preview: async () => ({ items: [], unknown: [] }),
    search: async () => [],
    barcode: async () => ({ error: unavailable('Health') }),
    saveUsual: async () => ({ ok: false as const, error: unavailable('Health') }),
    removeUsual: async () => ({ ok: false as const, error: unavailable('Health') }),
    scheduleAdd: async () => ({ ok: false as const, error: unavailable('Health') }),
    scheduleRemove: async () => ({ ok: false as const, error: unavailable('Health') }),
    program: async () => ({ ok: false as const, error: unavailable('Health') }),
    onChanged: noop,
    onNudge: noop,
  },
  approvals: { respond: async () => {}, pending: async () => [], onRequest: noop, onSettled: noop },
  secrets: {
    status: async () => SECRET_NAMES.reduce((a, n) => ({ ...a, [n]: false }), {} as Record<SecretName, boolean>),
    set: async () => ({ ok: false, error: unavailable('Saving keys') }),
  },
  discord: {
    status: async () => ({ configured: false }),
  },
  addons: {
    status: async () => ({ addons: [], hindsight: { installed: false, enabled: false, running: false } }),
    setHindsight: async () => ({ addons: [], hindsight: { installed: false, enabled: false, running: false } }),
    setAskBrowserAgent: async () => false,
  },
  settings: {
    get: async () => DEFAULT_SETTINGS,
    save: async (patch) => ({ ...DEFAULT_SETTINGS, ...patch }),
  },
  ollama: { status: async () => offlineOllama, pull: async () => ({ ok: false, error: unavailable('Ollama') }), onPullProgress: noop },
  vault: {
    stats: async () => ({ root: '(unavailable outside Electron)', notes: 0, memories: 0, journalDays: 0, research: 0, teamRuns: 0, lastUpdated: null }),
    recent: async () => [],
    search: async () => [],
    profile: async () => '',
    saveProfile: async () => ({ ok: false, error: unavailable('Memory') }),
    open: async () => ({ ok: false, error: unavailable('Memory') }),
    reveal: async () => ({ ok: false, error: unavailable('Memory') }),
    choose: async () => ({ ok: false }),
    reindex: async () => nullBridge.vault.stats(),
    graph: async () => ({ root: '', nodes: [], links: [], groups: [], stats: { notes: 0, links: 0, brains: 0, hq: 0, passages: 0, indexedNotes: 0, lastWrite: null } }),
    read: async () => null,
    onUpdated: noop,
  },
  web: { status: async () => ({ signInOpen: false, sites: [] }), signIn: async () => ({ ok: false, error: unavailable('The browser') }), clear: async () => ({ signInOpen: false, sites: [] }), onChanged: noop },
  transcript: { load: async () => [], save: async () => false },
  tasks: {
    list: async () => [],
    add: async () => ({ ok: false, error: unavailable('Tasks') }),
    complete: async () => null,
    reopen: async () => null,
    remove: async () => null,
    snooze: async () => null,
    update: async () => null,
    clearDone: async () => 0,
    onChanged: noop,
    onReminder: noop,
  },
  browser: { onFrame: noop, onClosed: noop },
  apps: {
    status: async () => ({ hasKey: false, mode: 'none', auth: 'none', ok: false, error: unavailable('Apps'), userId: 'ultron', apps: [], checkedAt: Date.now() }),
    connect: async () => ({ ok: false, error: unavailable('Apps') }),
    disconnect: async () => ({ ok: false, error: unavailable('Apps') }),
    signIn: async () => ({ ok: false, error: unavailable('Apps') }),
    signOut: async () => nullBridge.apps.status(),
    onChanged: noop,
  },
  briefing: {
    now: async () => null,
    onReady: () => () => {},
  },
  focus: {
    state: async () => ({ active: null, left: 0, streak: 0, todayMinutes: 0, recent: [] }),
    start: async () => ({ active: null, left: 0, streak: 0, todayMinutes: 0, recent: [] }),
    stop: async () => ({ active: null, left: 0, streak: 0, todayMinutes: 0, recent: [] }),
    onChanged: () => () => {},
    onDone: () => () => {},
  },
  learn: {
    summary: async () => ({ lessons: 0, style: [], topSources: [], avoid: [], skills: 0, tests: 0, recent: [] }),
    reflect: async () => ({ lessons: 0, skills: 0, reviewed: 0 }),
    selfTest: async () => ({ total: 0, passed: 0, results: [] }),
    onUpdated: () => () => {},
  },
  dashboard: {
    get: async () => ({ updatedAt: 0, nextAt: 0, refreshing: false, sections: [], spotify: { playing: false, open: false, recent: [] } }),
    refresh: async () => ({ updatedAt: 0, nextAt: 0, refreshing: false, sections: [], spotify: { playing: false, open: false, recent: [] } }),
    spotify: async () => ({ playing: false, open: false, recent: [] }),
    open: async () => false,
    onUpdate: () => () => {},
  },
  voice: {
    status: async () => ({ state: 'off' as const, downloaded: false }),
    prepare: async () => ({ state: 'off' as const, downloaded: false }),
    voices: async () => [],
    synth: async () => { throw new Error(unavailable('The Ultron voice')); },
    onChanged: noop,
  },
  powerschool: {
    status: async () => ({ baseUrl: 'https://sis.cbe.ab.ca', signedIn: false, error: unavailable('PowerSchool') }),
    signIn: async () => ({ baseUrl: 'https://sis.cbe.ab.ca', signedIn: false, error: unavailable('PowerSchool') }),
    signOut: async () => ({ baseUrl: 'https://sis.cbe.ab.ca', signedIn: false }),
    open: async () => { window.open('https://sis.cbe.ab.ca/public/home.html', '_blank', 'noopener'); },
    onChanged: noop,
  },
  trackers: { collected: async () => [], forget: async () => false },
  school: {
    state: async () => { throw new Error(unavailable('School')); },
    refresh: async () => ({ ok: false, error: unavailable('School') }),
    courses: async () => ({ ok: false as const, error: unavailable('School') }),
    sync: async () => ({ ok: false as const, error: unavailable('School') }),
    search: async () => [],
    plan: async () => ({ error: unavailable('School') }),
    onChanged: noop,
  },
  d2l: {
    status: async () => ({ baseUrl: DEFAULT_SETTINGS.d2l.baseUrl, signedIn: false, error: unavailable('D2L') }),
    signIn: async () => nullBridge.d2l.status(),
    signOut: async () => nullBridge.d2l.status(),
    open: async () => { window.open(DEFAULT_SETTINGS.d2l.baseUrl, '_blank', 'noopener'); },
    sync: async () => ({ ok: false, error: unavailable('D2L') }),
    onChanged: noop,
  },
  news: {
    fetch: async () => ({ articles: [], quota: { used: 0, cap: 100, date: '' }, fetchedAt: Date.now(), error: unavailable('News') }),
    quota: async () => ({ used: 0, cap: 100, date: '' }),
    hasKey: async () => false,
  },
  research: { weather: async () => null },
  system: { hardwareStats: async () => ({ cpuPercent: 0, ramPercent: 0, ramUsedGB: 0, ramTotalGB: 0 }) },
  files: {
    addFolder: async () => ({ ok: false, folders: [] }),
    removeFolder: async () => [],
    list: async () => [],
    search: async () => [],
    rebuild: async () => 0,
    stats: async () => ({ folderCount: 0, fileCount: 0, capped: false }),
    reveal: async () => false,
    read: async () => ({ ok: false, error: unavailable('Files') }),
    write: async () => ({ ok: false, error: unavailable('Files') }),
    rename: async () => ({ ok: false, error: unavailable('Files') }),
    move: async () => ({ ok: false, error: unavailable('Files') }),
    delete: async () => ({ ok: false, error: unavailable('Files') }),
    createFile: async () => ({ ok: false, error: unavailable('Files') }),
    createFolder: async () => ({ ok: false, error: unavailable('Files') }),
  },
  backup: {
    export: async () => ({ ok: false, error: unavailable('Backup') }),
    import: async () => ({ ok: false, error: unavailable('Backup') }),
  },
  tray: { isAutoLaunchEnabled: async () => false, setAutoLaunch: async () => false },
  clipboard: { onNewText: noop },
  ui: { onFocus: noop },
  app: {
    openExternal: async (url: string) => { window.open(url, '_blank', 'noopener'); return true; },
    versions: async () => ({ app: '-', packaged: false, electron: '-', chrome: '-', node: '-', platform: 'browser' }),
  },
};

export const ultron: UltronBridge = inElectron ? (window as unknown as { ultron: UltronBridge }).ultron : nullBridge;
