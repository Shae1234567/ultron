import { contextBridge, ipcRenderer } from 'electron';

/**
 * The only bridge between the HUD and the OS. Everything the renderer can do
 * is enumerated here - there is no direct node access in the UI.
 */
const api = {
  win: {
    minimize: () => ipcRenderer.invoke('win:minimize'),
    maximize: () => ipcRenderer.invoke('win:maximize'),
    close: () => ipcRenderer.invoke('win:close'),
    onState: (cb: (s: { maximized: boolean }) => void) => {
      const handler = (_e: unknown, s: { maximized: boolean }) => cb(s);
      ipcRenderer.on('win:state', handler);
      return () => ipcRenderer.off('win:state', handler);
    },
  },

  ollama: {
    status: () => ipcRenderer.invoke('ollama:status'),
    chat: (payload: { requestId: string; messages: unknown[]; model?: string; temperature?: number }) =>
      ipcRenderer.invoke('ollama:chat', payload),
    cancel: (requestId: string) => ipcRenderer.invoke('ollama:cancel', requestId),
    once: (payload: { messages: unknown[]; model?: string; temperature?: number; timeoutMs?: number; tools?: unknown[] }) =>
      ipcRenderer.invoke('ollama:once', payload),
    onChunk: (cb: (p: { requestId: string; token: string }) => void) => {
      const handler = (_e: unknown, p: { requestId: string; token: string }) => cb(p);
      ipcRenderer.on('ollama:chunk', handler);
      return () => ipcRenderer.off('ollama:chunk', handler);
    },
    onDone: (cb: (p: { requestId: string; aborted?: boolean }) => void) => {
      const handler = (_e: unknown, p: { requestId: string; aborted?: boolean }) => cb(p);
      ipcRenderer.on('ollama:done', handler);
      return () => ipcRenderer.off('ollama:done', handler);
    },
    onError: (cb: (p: { requestId: string; error: string }) => void) => {
      const handler = (_e: unknown, p: { requestId: string; error: string }) => cb(p);
      ipcRenderer.on('ollama:error', handler);
      return () => ipcRenderer.off('ollama:error', handler);
    },
  },

  gemini: {
    status: () => ipcRenderer.invoke('gemini:status'),
    chat: (payload: { requestId: string; messages: unknown[]; model?: string; temperature?: number }) =>
      ipcRenderer.invoke('gemini:chat', payload),
    cancel: (requestId: string) => ipcRenderer.invoke('gemini:cancel', requestId),
    once: (payload: { messages: unknown[]; model?: string; temperature?: number; timeoutMs?: number }) =>
      ipcRenderer.invoke('gemini:once', payload),
    onChunk: (cb: (p: { requestId: string; token: string }) => void) => {
      const handler = (_e: unknown, p: { requestId: string; token: string }) => cb(p);
      ipcRenderer.on('gemini:chunk', handler);
      return () => ipcRenderer.off('gemini:chunk', handler);
    },
    onDone: (cb: (p: { requestId: string; aborted?: boolean }) => void) => {
      const handler = (_e: unknown, p: { requestId: string; aborted?: boolean }) => cb(p);
      ipcRenderer.on('gemini:done', handler);
      return () => ipcRenderer.off('gemini:done', handler);
    },
    onError: (cb: (p: { requestId: string; error: string }) => void) => {
      const handler = (_e: unknown, p: { requestId: string; error: string }) => cb(p);
      ipcRenderer.on('gemini:error', handler);
      return () => ipcRenderer.off('gemini:error', handler);
    },
  },

  browser: {
    search: (query: string, limit?: number) => ipcRenderer.invoke('browser:search', query, limit),
    open: (url: string) => ipcRenderer.invoke('browser:open', url),
    click: (selector: string) => ipcRenderer.invoke('browser:click', selector),
    type: (selector: string, text: string, submit?: boolean) => ipcRenderer.invoke('browser:type', selector, text, submit),
    screenshot: () => ipcRenderer.invoke('browser:screenshot'),
    close: () => ipcRenderer.invoke('browser:close'),
  },

  news: {
    fetch: (manual = false) => ipcRenderer.invoke('news:fetch', manual),
    quota: () => ipcRenderer.invoke('news:quota'),
    hasKey: () => ipcRenderer.invoke('news:hasKey'),
  },

  settings: {
    get: () => ipcRenderer.invoke('settings:get'),
    save: (patch: unknown) => ipcRenderer.invoke('settings:save', patch),
    setEnvKey: (key: string, value: string) => ipcRenderer.invoke('env:setKey', { key, value }),
    envPath: () => ipcRenderer.invoke('env:path'),
  },

  memory: {
    get: () => ipcRenderer.invoke('memory:get'),
    save: (content: string) => ipcRenderer.invoke('memory:save', content),
    path: () => ipcRenderer.invoke('memory:path'),
  },

  research: {
    wikipedia: (query: string) => ipcRenderer.invoke('research:wikipedia', query),
    multi: (query: string) => ipcRenderer.invoke('research:multi', query),
    weather: (place: string) => ipcRenderer.invoke('research:weather', place),
    onThisDay: () => ipcRenderer.invoke('research:onThisDay'),
  },

  github: {
    hasToken: () => ipcRenderer.invoke('github:hasToken'),
    verify: () => ipcRenderer.invoke('github:verify'),
    repos: (limit?: number) => ipcRenderer.invoke('github:repos', limit),
    openWork: (limit?: number) => ipcRenderer.invoke('github:openWork', limit),
  },

  notion: {
    hasToken: () => ipcRenderer.invoke('notion:hasToken'),
    verify: () => ipcRenderer.invoke('notion:verify'),
    search: (limit?: number) => ipcRenderer.invoke('notion:search', limit),
  },

  discord: {
    hasWebhook: () => ipcRenderer.invoke('discord:hasWebhook'),
    verify: () => ipcRenderer.invoke('discord:verify'),
    postMessage: (content: string) => ipcRenderer.invoke('discord:postMessage', content),
    hasBotToken: () => ipcRenderer.invoke('discord:hasBotToken'),
    verifyBot: () => ipcRenderer.invoke('discord:verifyBot'),
    guilds: () => ipcRenderer.invoke('discord:guilds'),
    channels: (guildId: string) => ipcRenderer.invoke('discord:channels', guildId),
    messages: (channelId: string, limit?: number) => ipcRenderer.invoke('discord:messages', channelId, limit),
    postAsBot: (channelId: string, content: string) => ipcRenderer.invoke('discord:postAsBot', channelId, content),
    roles: (guildId: string) => ipcRenderer.invoke('discord:roles', guildId),
    members: (guildId: string, limit?: number) => ipcRenderer.invoke('discord:members', guildId, limit),
    assignRole: (guildId: string, userId: string, roleId: string) => ipcRenderer.invoke('discord:assignRole', guildId, userId, roleId),
    removeRole: (guildId: string, userId: string, roleId: string) => ipcRenderer.invoke('discord:removeRole', guildId, userId, roleId),
    createChannel: (guildId: string, name: string) => ipcRenderer.invoke('discord:createChannel', guildId, name),
    renameChannel: (channelId: string, name: string) => ipcRenderer.invoke('discord:renameChannel', channelId, name),
  },

  obsidian: {
    hasVault: () => ipcRenderer.invoke('obsidian:hasVault'),
    folders: () => ipcRenderer.invoke('obsidian:folders'),
    recentNotes: (limit?: number) => ipcRenderer.invoke('obsidian:recentNotes', limit),
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

  app: {
    openExternal: (url: string) => ipcRenderer.invoke('app:openExternal', url),
    versions: () => ipcRenderer.invoke('app:versions'),
  },
};

contextBridge.exposeInMainWorld('ultron', api);

export type UltronApi = typeof api;
