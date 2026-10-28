import { contextBridge, ipcRenderer } from 'electron';

/**
 * The only bridge between the HUD and the OS. Everything the renderer can do
 * is enumerated here - there is no direct Node access in the UI.
 */

function on<T>(channel: string, cb: (payload: T) => void): () => void {
  const handler = (_e: unknown, payload: T) => cb(payload);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.off(channel, handler);
}

const api = {
  win: {
    minimize: () => ipcRenderer.invoke('win:minimize'),
    maximize: () => ipcRenderer.invoke('win:maximize'),
    close: () => ipcRenderer.invoke('win:close'),
    show: () => ipcRenderer.invoke('win:show'),
    onState: (cb: (s: { maximized: boolean }) => void) => on('win:state', cb),
  },

  notify: {
    show: (title: string, body: string) => ipcRenderer.invoke('notify:show', title, body),
  },

  brain: {
    ask: (text: string, history: { role: 'user' | 'assistant'; content: string }[]) => ipcRenderer.invoke('brain:ask', { text, history }),
    cancel: (runId: string) => ipcRenderer.invoke('brain:cancel', runId),
    status: () => ipcRenderer.invoke('brain:status'),
    usage: () => ipcRenderer.invoke('brain:usage'),
    recheck: () => ipcRenderer.invoke('brain:recheck'),
    once: (payload: { system: string; user?: string; tier?: 'main' | 'fast'; temperature?: number }) => ipcRenderer.invoke('brain:once', payload),
    greet: (kind: 'boot' | 'wake' | 'checkin') => ipcRenderer.invoke('brain:greet', kind),
    agents: () => ipcRenderer.invoke('brain:agents'),
    liveVoice: () => ipcRenderer.invoke('brain:liveVoice'),
    onEvent: (cb: (e: Record<string, unknown>) => void) => on('brain:event', cb),
  },

  council: {
    state: () => ipcRenderer.invoke('council:state'),
    line: (id: string) => ipcRenderer.invoke('council:line', id),
    convene: () => ipcRenderer.invoke('council:convene'),
    phoneLink: () => ipcRenderer.invoke('council:phoneLink'),
    helios: (on: boolean) => ipcRenderer.invoke('council:helios', on),
    onReview: (cb: (r: { date: string; text: string }) => void) => on('council:review', cb),
  },

  health: {
    view: (date?: string) => ipcRenderer.invoke('health:view', date),
    log: (kind: string, p: unknown) => ipcRenderer.invoke('health:log', kind, p),
    edit: (kind: string, id: string, p: unknown) => ipcRenderer.invoke('health:edit', kind, id, p),
    remove: (kind: string, id: string) => ipcRenderer.invoke('health:remove', kind, id),
    restore: (kind: string, entry: unknown) => ipcRenderer.invoke('health:restore', kind, entry),
    preview: (text: string) => ipcRenderer.invoke('health:preview', text),
    search: (q: string) => ipcRenderer.invoke('health:search', q),
    barcode: (code: string) => ipcRenderer.invoke('health:barcode', code),
    saveUsual: (name: string, p: unknown) => ipcRenderer.invoke('health:saveUsual', name, p),
    removeUsual: (name: string) => ipcRenderer.invoke('health:removeUsual', name),
    scheduleAdd: (p: unknown) => ipcRenderer.invoke('health:scheduleAdd', p),
    scheduleRemove: (id: string) => ipcRenderer.invoke('health:scheduleRemove', id),
    program: (action: 'on' | 'off' | 'restart') => ipcRenderer.invoke('health:program', action),
    onChanged: (cb: (p: { at: number }) => void) => on('health:changed', cb),
    onNudge: (cb: (p: { text: string }) => void) => on('health:nudge', cb),
  },

  approvals: {
    respond: (id: string, approved: boolean, all = false) => ipcRenderer.invoke('approval:respond', id, approved, all),
    pending: () => ipcRenderer.invoke('approval:pending'),
    onRequest: (cb: (req: unknown) => void) => on('approval:request', cb),
    onSettled: (cb: (p: { id: string; approved: boolean }) => void) => on('approval:settled', cb),
  },

  clouds: {
    presets: () => ipcRenderer.invoke('clouds:presets'),
    add: (p: { preset?: string; label?: string; baseUrl?: string; model?: string; key: string; accountId?: string }) => ipcRenderer.invoke('clouds:add', p),
    remove: (id: string) => ipcRenderer.invoke('clouds:remove', id),
    setKey: (id: string, value: string) => ipcRenderer.invoke('clouds:setKey', id, value),
    pasteKey: (id: string) => ipcRenderer.invoke('clouds:pasteKey', id),
  },
  secrets: {
    status: () => ipcRenderer.invoke('secrets:status'),
    set: (name: string, value: string) => ipcRenderer.invoke('secrets:set', name, value),
  },
  discord: {
    status: () => ipcRenderer.invoke('discord:status'),
  },
  addons: {
    status: () => ipcRenderer.invoke('addons:status'),
    setHindsight: (on: boolean) => ipcRenderer.invoke('addons:setHindsight', on),
    setAskBrowserAgent: (on: boolean) => ipcRenderer.invoke('addons:setAskBrowserAgent', on),
  },

  settings: {
    get: () => ipcRenderer.invoke('settings:get'),
    save: (patch: unknown) => ipcRenderer.invoke('settings:save', patch),
  },

  ollama: {
    status: () => ipcRenderer.invoke('ollama:status'),
    pull: (model: string) => ipcRenderer.invoke('ollama:pull', model),
    onPullProgress: (cb: (p: unknown) => void) => on('ollama:pullProgress', cb),
  },

  vault: {
    stats: () => ipcRenderer.invoke('vault:stats'),
    recent: (limit?: number) => ipcRenderer.invoke('vault:recent', limit),
    search: (q: string) => ipcRenderer.invoke('vault:search', q),
    profile: () => ipcRenderer.invoke('vault:profile'),
    saveProfile: (text: string) => ipcRenderer.invoke('vault:saveProfile', text),
    open: (rel?: string) => ipcRenderer.invoke('vault:open', rel),
    reveal: () => ipcRenderer.invoke('vault:reveal'),
    choose: () => ipcRenderer.invoke('vault:choose'),
    reindex: () => ipcRenderer.invoke('vault:reindex'),
    graph: () => ipcRenderer.invoke('memory:graph'),
    read: (rel: string) => ipcRenderer.invoke('vault:read', rel),
    onUpdated: (cb: (p: unknown) => void) => on('memory:updated', cb),
  },

  web: {
    status: () => ipcRenderer.invoke('web:status'),
    signIn: (url?: string) => ipcRenderer.invoke('web:signIn', url),
    clear: () => ipcRenderer.invoke('web:clear'),
    onChanged: (cb: (s: unknown) => void) => on('web:changed', cb),
  },
  transcript: {
    load: () => ipcRenderer.invoke('transcript:load'),
    save: (entries: unknown) => ipcRenderer.invoke('transcript:save', entries),
  },
  tasks: {
    list: () => ipcRenderer.invoke('tasks:list'),
    add: (input: { title: string; due?: string; priority?: string }) => ipcRenderer.invoke('tasks:add', input),
    complete: (id: string) => ipcRenderer.invoke('tasks:complete', id),
    reopen: (id: string) => ipcRenderer.invoke('tasks:reopen', id),
    remove: (id: string) => ipcRenderer.invoke('tasks:remove', id),
    snooze: (id: string, minutes: number) => ipcRenderer.invoke('tasks:snooze', id, minutes),
    update: (id: string, patch: unknown) => ipcRenderer.invoke('tasks:update', id, patch),
    clearDone: () => ipcRenderer.invoke('tasks:clearDone'),
    onChanged: (cb: (all: unknown[]) => void) => on('tasks:changed', cb),
    onReminder: (cb: (p: unknown) => void) => on('tasks:reminder', cb),
  },

  browser: {
    onFrame: (cb: (f: unknown) => void) => on('browser:frame', cb),
    onClosed: (cb: (c: unknown) => void) => on('browser:closed', cb),
  },
  apps: {
    status: () => ipcRenderer.invoke('apps:status'),
    connect: (slug: string) => ipcRenderer.invoke('apps:connect', slug),
    disconnect: (slug: string) => ipcRenderer.invoke('apps:disconnect', slug),
    signIn: () => ipcRenderer.invoke('apps:signIn'),
    signOut: () => ipcRenderer.invoke('apps:signOut'),
    onChanged: (cb: (s: unknown) => void) => on('apps:changed', cb),
  },

  briefing: {
    now: () => ipcRenderer.invoke('briefing:now'),
    onReady: (cb: (b: unknown) => void) => on('briefing:ready', cb),
  },
  focus: {
    state: () => ipcRenderer.invoke('focus:state'),
    start: (subject: string, minutes?: number) => ipcRenderer.invoke('focus:start', subject, minutes),
    stop: () => ipcRenderer.invoke('focus:stop'),
    onChanged: (cb: (s: unknown) => void) => on('focus:changed', cb),
    onDone: (cb: (s: unknown) => void) => on('focus:done', cb),
  },
  learn: {
    summary: () => ipcRenderer.invoke('learn:summary'),
    reflect: () => ipcRenderer.invoke('learn:reflect'),
    selfTest: () => ipcRenderer.invoke('learn:selftest'),
    onUpdated: (cb: (s: unknown) => void) => on('learn:updated', cb),
  },
  dashboard: {
    get: () => ipcRenderer.invoke('dashboard:get'),
    refresh: () => ipcRenderer.invoke('dashboard:refresh'),
    spotify: (action?: string) => ipcRenderer.invoke('dashboard:spotify', action),
    open: (url: string) => ipcRenderer.invoke('dashboard:open', url),
    onUpdate: (cb: (s: unknown) => void) => on('dashboard:update', cb),
  },
  voice: {
    status: () => ipcRenderer.invoke('voice:status'),
    prepare: () => ipcRenderer.invoke('voice:prepare'),
    voices: () => ipcRenderer.invoke('voice:voices'),
    synth: (text: string, voice: string, speed: number) => ipcRenderer.invoke('voice:synth', text, voice, speed),
    onChanged: (cb: (s: unknown) => void) => on('voice:changed', cb),
  },
  powerschool: {
    status: () => ipcRenderer.invoke('powerschool:status'),
    signIn: () => ipcRenderer.invoke('powerschool:signIn'),
    signOut: () => ipcRenderer.invoke('powerschool:signOut'),
    open: () => ipcRenderer.invoke('powerschool:open'),
    onChanged: (cb: (s: unknown) => void) => on('powerschool:changed', cb),
  },
  trackers: {
    collected: (kind: 'pc' | 'games') => ipcRenderer.invoke('trackers:collected', kind),
    forget: (kind: 'pc' | 'games') => ipcRenderer.invoke('trackers:forget', kind),
  },
  school: {
    state: () => ipcRenderer.invoke('school:state'),
    refresh: () => ipcRenderer.invoke('school:refresh'),
    courses: () => ipcRenderer.invoke('school:courses'),
    sync: (course?: string) => ipcRenderer.invoke('school:sync', course),
    search: (q: string, course?: string) => ipcRenderer.invoke('school:search', q, course),
    plan: (p: { what: string; due: string; total?: number; block?: number }) => ipcRenderer.invoke('school:plan', p),
    onChanged: (cb: (p: unknown) => void) => on('school:changed', cb),
  },
  d2l: {
    status: () => ipcRenderer.invoke('d2l:status'),
    signIn: () => ipcRenderer.invoke('d2l:signIn'),
    signOut: () => ipcRenderer.invoke('d2l:signOut'),
    open: () => ipcRenderer.invoke('d2l:open'),
    sync: () => ipcRenderer.invoke('d2l:sync'),
    onChanged: (cb: (s: unknown) => void) => on('d2l:changed', cb),
  },

  news: {
    fetch: (manual = false) => ipcRenderer.invoke('news:fetch', manual),
    quota: () => ipcRenderer.invoke('news:quota'),
    hasKey: () => ipcRenderer.invoke('news:hasKey'),
  },

  research: {
    weather: (place: string) => ipcRenderer.invoke('research:weather', place),
  },

  system: {
    hardwareStats: () => ipcRenderer.invoke('system:hardwareStats'),
  },

  files: {
    addFolder: () => ipcRenderer.invoke('files:add'),
    removeFolder: (p: string) => ipcRenderer.invoke('files:remove', p),
    list: (limit?: number) => ipcRenderer.invoke('files:list', limit),
    search: (q: string) => ipcRenderer.invoke('files:search', q),
    rebuild: () => ipcRenderer.invoke('files:rebuild'),
    stats: () => ipcRenderer.invoke('files:stats'),
    reveal: (p: string) => ipcRenderer.invoke('files:reveal', p),
    read: (p: string) => ipcRenderer.invoke('files:read', p),
    write: (p: string, content: string) => ipcRenderer.invoke('files:write', p, content),
    rename: (p: string, name: string) => ipcRenderer.invoke('files:rename', p, name),
    move: (p: string, destFolder: string) => ipcRenderer.invoke('files:move', p, destFolder),
    delete: (p: string) => ipcRenderer.invoke('files:delete', p),
    createFile: (folder: string, name: string, content?: string) => ipcRenderer.invoke('files:createFile', folder, name, content),
    createFolder: (folder: string, name: string) => ipcRenderer.invoke('files:createFolder', folder, name),
  },

  backup: {
    export: () => ipcRenderer.invoke('backup:export'),
    import: () => ipcRenderer.invoke('backup:import'),
  },

  tray: {
    isAutoLaunchEnabled: () => ipcRenderer.invoke('tray:isAutoLaunchEnabled'),
    setAutoLaunch: (enabled: boolean) => ipcRenderer.invoke('tray:setAutoLaunch', enabled),
  },

  clipboard: {
    onNewText: (cb: (text: string) => void) => on('clipboard:newText', cb),
  },

  ui: {
    onFocus: (cb: (p: { tab?: string; health?: string; school?: string }) => void) => on('ui:focus', cb),
  },

  app: {
    openExternal: (url: string) => ipcRenderer.invoke('app:openExternal', url),
    versions: () => ipcRenderer.invoke('app:versions'),
  },
};

contextBridge.exposeInMainWorld('ultron', api);

export type UltronApi = typeof api;
