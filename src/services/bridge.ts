import type { UltronBridge } from '../types/global';

/**
 * Access point for the preload bridge.
 *
 * Inside Electron this is the real `window.ultron`. When the renderer is opened
 * directly in a browser (`npx vite`, useful for fast visual iteration) there is
 * no preload, so we substitute a null implementation that reports everything as
 * unavailable. It never fabricates articles, files, or model output - the UI
 * simply renders its genuine "not connected" states.
 */

export const inElectron = typeof window !== 'undefined' && Boolean((window as any).ultron);

const unavailable = (what: string) => `${what} is only available in the Electron app.`;

const nullBridge: UltronBridge = {
  win: {
    minimize: async () => {},
    maximize: async () => false,
    close: async () => {},
    onState: () => () => {},
  },
  ollama: {
    status: async () => ({
      running: false, host: 'http://localhost:11434', models: [],
      activeModel: 'llama3.2', modelInstalled: false, error: unavailable('Ollama'),
    }),
    chat: async () => ({ started: false }),
    cancel: async () => {},
    once: async () => ({ ok: false as const, error: unavailable('Ollama') }),
    onChunk: () => () => {},
    onDone: () => () => {},
    onError: () => () => {},
  },
  gemini: {
    status: async () => ({
      running: false, host: 'https://generativelanguage.googleapis.com', models: [],
      activeModel: 'gemini-2.0-flash', modelInstalled: false, error: unavailable('Gemini'),
    }),
    chat: async () => ({ started: false }),
    cancel: async () => {},
    once: async () => ({ ok: false as const, error: unavailable('Gemini') }),
    onChunk: () => () => {},
    onDone: () => () => {},
    onError: () => () => {},
  },
  browser: {
    search: async () => ({ ok: false, results: [], error: unavailable('Browser') }),
    open: async () => ({ ok: false, error: unavailable('Browser') }),
    click: async () => ({ ok: false, error: unavailable('Browser') }),
    type: async () => ({ ok: false, error: unavailable('Browser') }),
    screenshot: async () => ({ ok: false, error: unavailable('Browser') }),
    close: async () => {},
  },
  news: {
    fetch: async () => ({
      articles: [], quota: { used: 0, cap: 100, date: '' }, fetchedAt: Date.now(),
      error: unavailable('News'),
    }),
    quota: async () => ({ used: 0, cap: 100, date: '' }),
    hasKey: async () => false,
  },
  settings: {
    get: async () => ({
      profile: { location: 'Calgary, Alberta, Canada', interests: [], notes: '' },
      news: { autoRefreshMinutes: 60, dailyCap: 100, categories: ['world', 'nation'], country: 'ca' },
      ollama: { host: 'http://localhost:11434', model: 'llama3.2' },
      brain: 'ollama' as const,
      gemini: { model: 'gemini-2.0-flash' },
      voice: { name: '', rate: 0.93, pitch: 0.8 },
      folders: [],
    }),
    save: async (patch) => ({ ...(await nullBridge.settings.get()), ...patch }),
    setEnvKey: async () => ({ ok: false, error: unavailable('Writing .env') }),
    envPath: async () => '(unavailable outside Electron)',
  },
  memory: {
    get: async () => '',
    save: async () => ({ ok: false, file: '', error: unavailable('Memory') }),
    path: async () => '(unavailable outside Electron)',
  },
  research: {
    wikipedia: async () => null,
    multi: async () => [],
    weather: async () => null,
    onThisDay: async () => [],
  },
  github: {
    hasToken: async () => false,
    verify: async () => ({ ok: false, error: unavailable('GitHub') }),
    repos: async () => [],
    openWork: async () => [],
  },
  notion: {
    hasToken: async () => false,
    verify: async () => ({ ok: false, error: unavailable('Notion') }),
    search: async () => [],
  },
  discord: {
    hasWebhook: async () => false,
    verify: async () => ({ ok: false, error: unavailable('Discord') }),
    postMessage: async () => ({ ok: false, error: unavailable('Discord') }),
    hasBotToken: async () => false,
    verifyBot: async () => ({ ok: false, error: unavailable('Discord') }),
    guilds: async () => [],
    channels: async () => [],
    messages: async () => [],
    postAsBot: async () => ({ ok: false, error: unavailable('Discord') }),
    roles: async () => [],
    members: async () => [],
    assignRole: async () => ({ ok: false, error: unavailable('Discord') }),
    removeRole: async () => ({ ok: false, error: unavailable('Discord') }),
    createChannel: async () => ({ ok: false, error: unavailable('Discord') }),
    renameChannel: async () => ({ ok: false, error: unavailable('Discord') }),
  },
  obsidian: {
    hasVault: async () => false,
    folders: async () => [],
    recentNotes: async () => [],
  },
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
  app: {
    openExternal: async (url: string) => { window.open(url, '_blank', 'noopener'); return true; },
    versions: async () => ({ electron: '-', chrome: '-', node: '-', platform: 'browser' }),
  },
};

export const ultron: UltronBridge = inElectron ? (window as any).ultron : nullBridge;
