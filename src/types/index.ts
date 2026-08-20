export type Region =
  | 'NORTH AMERICA' | 'EUROPE' | 'MIDDLE EAST' | 'ASIA-PACIFIC'
  | 'AFRICA' | 'LATIN AMERICA' | 'GLOBAL';

export const ALL_REGIONS: Region[] = [
  'GLOBAL', 'NORTH AMERICA', 'EUROPE', 'MIDDLE EAST', 'ASIA-PACIFIC', 'AFRICA', 'LATIN AMERICA',
];

export interface ResearchSource {
  source: 'Wikipedia' | 'Wikidata' | 'DuckDuckGo';
  title: string;
  summary: string;
  url: string;
}

export interface WeatherResult {
  place: string;
  tempC: number;
  feelsLikeC: number;
  windKph: number;
  condition: string;
  isDay: boolean;
}

export interface OnThisDayEvent {
  year: string;
  text: string;
}

export interface GitHubUser {
  login: string;
  name: string | null;
  avatarUrl: string;
  profileUrl: string;
}

export interface GitHubRepo {
  name: string;
  fullName: string;
  url: string;
  private: boolean;
  stars: number;
  updatedAt: string;
  description: string | null;
}

export interface GitHubIssue {
  title: string;
  repo: string;
  url: string;
  isPullRequest: boolean;
  updatedAt: string;
  state: string;
}

export interface NotionUser {
  botName: string | null;
  workspaceName: string | null;
}

export interface NotionItem {
  id: string;
  title: string;
  url: string;
  type: 'page' | 'database';
  lastEditedTime: string;
}

export interface DiscordWebhookInfo {
  name: string;
  channelId: string;
  guildId: string | null;
}

export interface DiscordBotIdentity { username: string; id: string; avatarUrl: string | null }
export interface DiscordGuild { id: string; name: string; iconUrl: string | null }
export interface DiscordChannel { id: string; name: string; type: number }
export interface DiscordMessage { id: string; author: string; content: string; timestamp: string }
export interface DiscordRole { id: string; name: string; color: number }
export interface DiscordMember { userId: string; username: string; nick: string | null; roleIds: string[] }

export interface VaultFolder {
  path: string;
  noteCount: number;
}

export interface NoteRef {
  name: string;
  path: string;
  folder: string;
  modified: number;
}

export interface Article {
  id: string;
  title: string;
  description: string;
  content: string;
  url: string;
  image: string | null;
  publishedAt: string;
  source: string;
  category: string;
  region: Region;
}

export interface Quota { used: number; cap: number; date: string }

export interface NewsResult {
  articles: Article[];
  quota: Quota;
  fetchedAt: number;
  error?: string;
  blocked?: boolean;
  /** True when served from the on-disk cache without spending a request. */
  cached?: boolean;
}

export interface OllamaStatus {
  running: boolean;
  host: string;
  models: string[];
  activeModel: string;
  modelInstalled: boolean;
  error?: string;
}

export interface IndexedFolder { path: string; addedAt: number; fileCount: number }

export interface IndexedFile {
  name: string; path: string; ext: string; size: number; modified: number; folder: string;
}

export interface Settings {
  profile: { location: string; interests: string[]; notes: string };
  news: { autoRefreshMinutes: number; dailyCap: number; categories: string[]; country: string };
  ollama: { host: string; model: string };
  voice: { name: string; rate: number; pitch: number };
  folders: IndexedFolder[];
}

export interface ChatMessage { role: 'system' | 'user' | 'assistant'; content: string }

export type CoreState = 'idle' | 'listening' | 'thinking' | 'speaking' | 'offline';

export interface TranscriptEntry {
  id: string;
  who: 'you' | 'ultron' | 'system';
  text: string;
  at: number;
  streaming?: boolean;
  error?: boolean;
  /** Sources the Researcher specialist actually consulted for this reply. */
  sources?: ResearchSource[];
}
