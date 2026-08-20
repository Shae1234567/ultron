import type {
  Article, IndexedFile, IndexedFolder, NewsResult, OllamaStatus, Quota, Settings, ChatMessage,
  ResearchSource, WeatherResult, OnThisDayEvent, GitHubUser, GitHubRepo, GitHubIssue,
  NotionUser, NotionItem, DiscordWebhookInfo, VaultFolder, NoteRef,
  DiscordBotIdentity, DiscordGuild, DiscordChannel, DiscordMessage, DiscordRole, DiscordMember,
} from './index';

export interface UltronBridge {
  win: {
    minimize(): Promise<void>;
    maximize(): Promise<boolean>;
    close(): Promise<void>;
    onState(cb: (s: { maximized: boolean }) => void): () => void;
  };
  ollama: {
    status(): Promise<OllamaStatus>;
    chat(p: { requestId: string; messages: ChatMessage[]; model?: string; temperature?: number }): Promise<{ started: boolean }>;
    cancel(requestId: string): Promise<void>;
    once(p: { messages: ChatMessage[]; model?: string; temperature?: number; timeoutMs?: number }):
      Promise<{ ok: true; text: string } | { ok: false; error: string }>;
    onChunk(cb: (p: { requestId: string; token: string }) => void): () => void;
    onDone(cb: (p: { requestId: string; aborted?: boolean }) => void): () => void;
    onError(cb: (p: { requestId: string; error: string }) => void): () => void;
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
