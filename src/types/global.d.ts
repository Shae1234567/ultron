import type {
  Article, IndexedFile, IndexedFolder, NewsResult, OllamaStatus, GeminiStatus, Quota, Settings, ChatMessage,
  ResearchSource, WeatherResult, OnThisDayEvent, GitHubUser, GitHubRepo, GitHubIssue,
  NotionUser, NotionItem, DiscordWebhookInfo, VaultFolder, NoteRef,
  DiscordBotIdentity, DiscordGuild, DiscordChannel, DiscordMessage, DiscordRole, DiscordMember,
  ToolCall,
} from './index';

export interface UltronBridge {
  win: {
    minimize(): Promise<void>;
    maximize(): Promise<boolean>;
    close(): Promise<void>;
    show(): Promise<void>;
    onState(cb: (s: { maximized: boolean }) => void): () => void;
  };
  tray: {
    isAutoLaunchEnabled(): Promise<boolean>;
    setAutoLaunch(enabled: boolean): Promise<void>;
  };
  ollama: {
    status(): Promise<OllamaStatus>;
    chat(p: { requestId: string; messages: ChatMessage[]; model?: string; temperature?: number }): Promise<{ started: boolean }>;
    cancel(requestId: string): Promise<void>;
    once(p: { messages: ChatMessage[]; model?: string; temperature?: number; timeoutMs?: number; tools?: unknown[] }):
      Promise<{ ok: true; text: string; toolCalls?: ToolCall[] } | { ok: false; error: string }>;
    onChunk(cb: (p: { requestId: string; token: string }) => void): () => void;
    onDone(cb: (p: { requestId: string; aborted?: boolean }) => void): () => void;
    onError(cb: (p: { requestId: string; error: string }) => void): () => void;
  };
  gemini: {
    status(): Promise<GeminiStatus>;
    chat(p: { requestId: string; messages: ChatMessage[]; model?: string; temperature?: number }): Promise<{ started: boolean }>;
    cancel(requestId: string): Promise<void>;
    once(p: { messages: ChatMessage[]; model?: string; temperature?: number; timeoutMs?: number }):
      Promise<{ ok: true; text: string } | { ok: false; error: string }>;
    onChunk(cb: (p: { requestId: string; token: string }) => void): () => void;
    onDone(cb: (p: { requestId: string; aborted?: boolean }) => void): () => void;
    onError(cb: (p: { requestId: string; error: string }) => void): () => void;
    getKeyForLiveSession(): Promise<string>;
  };
  browser: {
    search(query: string, limit?: number): Promise<{ ok: boolean; results: { title: string; url: string; snippet: string }[]; error?: string }>;
    youtubeSearch(query: string, limit?: number): Promise<{ ok: boolean; results: { title: string; url: string; channel: string; duration?: string }[]; error?: string }>;
    open(url: string): Promise<{ ok: boolean; title?: string; text?: string; url?: string; error?: string }>;
    click(selector: string): Promise<{ ok: boolean; error?: string }>;
    type(selector: string, text: string, submit?: boolean): Promise<{ ok: boolean; error?: string }>;
    screenshot(): Promise<{ ok: boolean; dataUrl?: string; error?: string }>;
    close(): Promise<void>;
  };
  system: {
    openApp(name: string): Promise<{ ok: boolean; error?: string }>;
    openGoogleService(service: string): Promise<{ ok: boolean; url?: string; error?: string }>;
    setVolume(direction: 'up' | 'down' | 'mute'): Promise<{ ok: boolean; error?: string }>;
    lock(): Promise<{ ok: boolean; error?: string }>;
    sleep(): Promise<{ ok: boolean; error?: string }>;
    openExplorer(path?: string): Promise<{ ok: boolean; error?: string }>;
  };
  google: {
    hasCredentials(): Promise<boolean>;
    isConnected(): Promise<boolean>;
    connect(scopes: string[]): Promise<{ ok: boolean; error?: string }>;
    disconnect(): Promise<void>;
    gmailListUnread(limit?: number): Promise<{ ok: boolean; messages?: { id: string; from: string; subject: string; snippet: string; date: string; unread: boolean }[]; error?: string }>;
    gmailSend(to: string, subject: string, body: string): Promise<{ ok: boolean; error?: string }>;
    calendarListUpcoming(limit?: number): Promise<{ ok: boolean; events?: { id: string; title: string; start: string; end: string; location?: string }[]; error?: string }>;
    calendarCreateEvent(title: string, start: string, end: string, description?: string): Promise<{ ok: boolean; error?: string }>;
    driveListRecent(limit?: number): Promise<{ ok: boolean; files?: { id: string; name: string; mimeType: string; modifiedTime: string; webViewLink?: string }[]; error?: string }>;
    driveSearch(query: string, limit?: number): Promise<{ ok: boolean; files?: { id: string; name: string; mimeType: string; modifiedTime: string; webViewLink?: string }[]; error?: string }>;
  };
  news: {
    fetch(manual?: boolean): Promise<NewsResult>;
    quota(): Promise<Quota>;
    hasKey(): Promise<boolean>;
  };
  settings: {
    get(): Promise<Settings>;
    save(patch: Partial<Settings>): Promise<Settings>;
    setEnvKey(key: string, value: string): Promise<{ ok: boolean; file?: string; error?: string }>;
    envPath(): Promise<string>;
  };
  memory: {
    get(): Promise<string>;
    save(content: string): Promise<{ ok: boolean; file: string; error?: string }>;
    path(): Promise<string>;
  };
  research: {
    wikipedia(query: string): Promise<{ title: string; extract: string; url: string } | null>;
    multi(query: string): Promise<ResearchSource[]>;
    weather(place: string): Promise<WeatherResult | null>;
    onThisDay(): Promise<OnThisDayEvent[]>;
  };
  github: {
    hasToken(): Promise<boolean>;
    verify(): Promise<{ ok: boolean; user?: GitHubUser; error?: string }>;
    repos(limit?: number): Promise<GitHubRepo[]>;
    openWork(limit?: number): Promise<GitHubIssue[]>;
  };
  notion: {
    hasToken(): Promise<boolean>;
    verify(): Promise<{ ok: boolean; user?: NotionUser; error?: string }>;
    search(limit?: number): Promise<NotionItem[]>;
  };
  discord: {
    hasWebhook(): Promise<boolean>;
    verify(): Promise<{ ok: boolean; info?: DiscordWebhookInfo; error?: string }>;
    postMessage(content: string): Promise<{ ok: boolean; error?: string }>;
    hasBotToken(): Promise<boolean>;
    verifyBot(): Promise<{ ok: boolean; bot?: DiscordBotIdentity; error?: string }>;
    guilds(): Promise<DiscordGuild[]>;
    channels(guildId: string): Promise<DiscordChannel[]>;
    messages(channelId: string, limit?: number): Promise<DiscordMessage[]>;
    postAsBot(channelId: string, content: string): Promise<{ ok: boolean; error?: string }>;
    roles(guildId: string): Promise<DiscordRole[]>;
    members(guildId: string, limit?: number): Promise<DiscordMember[]>;
    assignRole(guildId: string, userId: string, roleId: string): Promise<{ ok: boolean; error?: string }>;
    removeRole(guildId: string, userId: string, roleId: string): Promise<{ ok: boolean; error?: string }>;
    createChannel(guildId: string, name: string): Promise<{ ok: boolean; channel?: DiscordChannel; error?: string }>;
    renameChannel(channelId: string, name: string): Promise<{ ok: boolean; error?: string }>;
  };
  obsidian: {
    hasVault(): Promise<boolean>;
    folders(): Promise<VaultFolder[]>;
    recentNotes(limit?: number): Promise<NoteRef[]>;
  };
  files: {
    addFolder(): Promise<{ ok: boolean; folders: IndexedFolder[] }>;
    removeFolder(p: string): Promise<IndexedFolder[]>;
    list(limit?: number): Promise<IndexedFile[]>;
    search(q: string): Promise<IndexedFile[]>;
    rebuild(): Promise<number>;
    stats(): Promise<{ folderCount: number; fileCount: number; capped: boolean }>;
    reveal(p: string): Promise<boolean>;
    read(p: string): Promise<{ ok: boolean; content?: string; error?: string }>;
    write(p: string, content: string): Promise<{ ok: boolean; error?: string }>;
    rename(p: string, name: string): Promise<{ ok: boolean; path?: string; error?: string }>;
    move(p: string, destFolder: string): Promise<{ ok: boolean; path?: string; error?: string }>;
    delete(p: string): Promise<{ ok: boolean; error?: string }>;
    createFile(folder: string, name: string, content?: string): Promise<{ ok: boolean; path?: string; error?: string }>;
    createFolder(folder: string, name: string): Promise<{ ok: boolean; path?: string; error?: string }>;
  };
  app: {
    openExternal(url: string): Promise<boolean>;
    versions(): Promise<{ electron: string; chrome: string; node: string; platform: string }>;
  };
}

declare global {
  interface Window { ultron: UltronBridge }
}

export type { Article };
