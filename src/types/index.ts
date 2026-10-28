export type { DashGroup, DashItem, DashSection, DashSnapshot, SectionId, SpotifyNow } from '../../electron/dashboard';
export type { Lesson, Skill } from '../../electron/learn';
export type { FocusSession, FocusState } from '../../electron/focus';
export type { TestRun } from '../../electron/selftest';
export type { HealthView, NightPoint, LoadPoint, PainArea } from '../../electron/departments/health/view';
export type {
  SleepEntry, TrainingEntry, FoodEntry, FoodItem, Nutrients, PainEntry, CheckIn, WaterEntry, UsualMeal, ScheduleItem,
  GymExercise, GymSet, Meal, DayType, TrainingKind, EntryKind as HealthEntryKind,
} from '../../electron/departments/health/store';
export type { TableMatch } from '../../electron/departments/health/foods';
export type { SchoolDoc, GradePoint, OnTimeItem, LibraryItem } from '../../electron/departments/school/store';
export type { SchoolNumber } from '../../electron/departments/school/summary';
export interface SchoolState { doc: import('../../electron/departments/school/store').SchoolDoc; number: import('../../electron/departments/school/summary').SchoolNumber; text: string; focus: { streak: number; todayMinutes: number } }
export type { BrainUsage, BrainLine } from '../../electron/brain/llm';
export type { VoiceStatus, VoiceState } from '../../electron/voice/kokoro';
export type { MindGraph, MindNode, MindShell } from '../../electron/memory/graph';
export type HealthLogKind = 'sleep' | 'training' | 'food' | 'water' | 'pain' | 'checkin' | 'dayType';
export type HealthResult = { ok: true; entry?: unknown; alerts?: string[]; detail?: string; total?: number } | { ok: false; error: string };
export type LearnSummary = ReturnType<typeof import('../../electron/learn').summary>;

export type Region =
  | 'NORTH AMERICA' | 'EUROPE' | 'MIDDLE EAST' | 'ASIA-PACIFIC'
  | 'AFRICA' | 'LATIN AMERICA' | 'GLOBAL';

export const ALL_REGIONS: Region[] = [
  'GLOBAL', 'NORTH AMERICA', 'EUROPE', 'MIDDLE EAST', 'ASIA-PACIFIC', 'AFRICA', 'LATIN AMERICA',
];

export interface WeatherResult {
  place: string;
  tempC: number;
  feelsLikeC: number;
  windKph: number;
  condition: string;
  isDay: boolean;
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

export interface GeminiState {
  configured: boolean;
  valid: boolean | null;
  model: string | null;
  liveModel: string | null;
  models: string[];
  error?: string;
  checkedAt?: number;
}

export type Provider = 'gemini' | 'cloud' | 'ollama';

export interface BrainStatus {
  active: Provider | null;
  label: string;
  model: string | null;
  gemini: GeminiState;
  ollama: OllamaStatus;
  clouds: CloudStatus[];
}

/** One free AI service Ultron can borrow a brain from (electron/clouds.ts). */
export interface CloudStatus {
  id: string;
  label: string;
  configured: boolean;
  off: boolean;
  valid: boolean | null;
  models: string[];
  model: string | null;
  error?: string;
  restingUntil?: number;
  /** The key is fine, the free credits behind it are spent. Not something to fix. */
  outOfCredits?: number;
  checkedAt?: number;
  free: string;
  signup: string;
  /** A built-in key name, or CUSTOM_<ID> for a service he added. */
  secret: string;
  /** Added by him - it can be removed. */
  custom?: boolean;
  /** Why a refused key was refused, by its shape alone (never its value). */
  keyHint?: string;
}

/** A service he can add with one paste (Settings -> AI services). */
export interface CloudPreset { id: string; label: string; baseUrl: string; signup: string; free: string; noKey?: boolean; needsAccount?: boolean }

export interface IndexedFolder { path: string; addedAt: number; fileCount: number }

export interface IndexedFile {
  name: string; path: string; ext: string; size: number; modified: number; folder: string;
}

export interface Settings {
  schema: number;
  profile: { name: string; location: string; interests: string[]; notes: string };
  news: { autoRefreshMinutes: number; dailyCap: number; categories: string[]; country: string };
  ollama: { host: string; model: string; numCtx: number; reasoningModel: string };
  brain: 'auto' | 'gemini' | 'cloud' | 'ollama';
  thinking: 'deep' | 'balanced' | 'fast';
  gemini: { model: string };
  team: { mode: 'auto' | 'full' };
  voice: { engine: 'ultron' | 'system'; ultronVoice: string; effect: number; name: string; rate: number; pitch: number; speakReminders: boolean; wakeWord: boolean };
  vault: { path: string };
  composio: { userId: string };
  d2l: { baseUrl: string };
  browser: { visible: boolean };
  workflow: 'v1' | 'v2' | 'v3';
  research: { depth: 'quick' | 'standard' | 'deep' };
  limits: { maxCalls: number; maxTokens: number; minutes: number };
  addons: { hindsight: boolean; askBrowserAgent: boolean };
  briefing: { on: boolean; hour: number };
  clouds: Record<string, { model?: string; baseUrl?: string; off?: boolean; rank?: number }>;
  jobs: Record<string, number>;
  folders: IndexedFolder[];
  privacy: { trusted: string[]; terms: string[] };
  hq: { path: string; on: boolean };
  trackers: { pcActivity: boolean; games: boolean };
  health: { bedtimeNudge: boolean; wake: string; hours: number };
  powerschool: { baseUrl: string };
  helios: { on: boolean };
  phone: { discordUserId: string };
  customClouds: { id: string; label: string; baseUrl: string; model?: string; modelsUrl?: string; signup?: string; free?: string; noKey?: boolean; freeOnly?: boolean; prefer?: string[] }[];
}

/**
 * Must match SECRET_NAMES in electron/secrets.ts. It is a real list, not just a type,
 * because the type alone had drifted: every free-AI-service key was missing here, so
 * CloudStatus.secret claimed to be one of the other six.
 */
export const SECRET_NAMES = [
  'GEMINI_API_KEY',
  'GROQ_API_KEY',
  'OPENROUTER_API_KEY',
  'NVIDIA_API_KEY',
  'HUGGINGFACE_API_KEY',
  'OPENAI_API_KEY',
  'DEEPSEEK_API_KEY',
  'COMPOSIO_API_KEY',
  'GNEWS_API_KEY',
  'TELEGRAM_BOT_TOKEN',
  'DISCORD_BOT_TOKEN',
  'WOLFRAM_APP_ID',
] as const;

export type SecretName = (typeof SECRET_NAMES)[number];

/* ── Team ─────────────────────────────────────────────────────────────── */

/**
 * Must match AGENT_IDS in electron/brain/types.ts (a test checks). A real list, so a
 * department's agents can't join the main process and be missing here.
 */
export const AGENT_IDS = [
  'ultron', 'athena', 'argus', 'hephaestus', 'hermes', 'chronos', 'mnemosyne', 'daedalus',
  'asclepius', 'achilles', 'heracles', 'demeter', 'hypnos',
  'prometheus', 'chiron', 'sphinx', 'kratos',
  'dionysus', 'theseus', 'morpheus', 'orpheus', 'clio', 'ares', 'calliope', 'atlas', 'odysseus', 'talos', 'nike',
] as const;
export type AgentId = (typeof AGENT_IDS)[number];

export type DepartmentId = 'health' | 'school' | 'media' | 'history' | 'projects';

export interface AgentInfo { id: AgentId; name: string; title: string; summary: string; color: string; department?: DepartmentId }

/* ── The council (electron/council.ts) ────────────────────────────────── */

export interface SeatMember { id: string; name: string; job: string; live: boolean }
export interface SeatMetric { value: string; unit: string; nights?: (number | null)[]; target?: number; empty: boolean; extra?: string }
export interface CouncilSeat {
  id: DepartmentId; name: string; seat: number; built: boolean; step: number; private: boolean;
  epithet: string; greek: { letter: string; word: string; latin: string; meaning: string }; metricName: string;
  head: SeatMember; specialists: SeatMember[]; borrows: string[];
  brain: { facts: number; last?: { date: string; text: string; who: string } } | null;
  metric: SeatMetric | null;
}
export interface PhoneStatus { linked: boolean; connected: boolean; botReady: boolean; error?: string; pairing?: string }
export interface HeliosState {
  built: true; on: boolean;
  budget: { used: number; cap: number }; nextSweep: number; lastPull: number; today: number;
  requests: { id: string; dept: DepartmentId; what: string; by: string; at: number }[];
  log: { at: number; dept?: DepartmentId; text: string }[];
  /** Today's intel per built department (first lines). */
  intel: Partial<Record<DepartmentId, string>>;
}
export interface CouncilState { seats: CouncilSeat[]; helios: HeliosState; phone: PhoneStatus }
export interface CouncilBriefing { at: number; lines: { id: DepartmentId; head: string; text: string; built: boolean }[]; summary: string }

export type AgentStatus = 'idle' | 'working' | 'waiting' | 'done' | 'error';

export type TeamPhase = 'idle' | 'recall' | 'thinking' | 'planning' | 'working' | 'reviewing' | 'writing';

export interface PlanStep { id: string; agent: AgentId; task: string; dependsOn: string[]; status?: 'queued' | 'working' | 'done' | 'failed' }

export interface ActivityLine { id: string; at: number; agent: AgentId; /** a helper the agent built */ sub?: string; text: string; kind?: 'progress' | 'note' | 'ok' | 'warn' }

/** A helper sub-agent a specialist built for part of its job. */
export interface HelperCard { id: string; parent: AgentId; name: string; task: string; status: 'working' | 'done' | 'failed'; report?: string }

/** The latest picture of one agent's (or helper's) browser tab. */
export interface BrowserFrame { id: string; runId: string; agent: AgentId; label: string; url: string; title: string; image: string; at: number; closed?: boolean }

export interface SourceLink { title: string; url: string }

/** How long one phase of a run took (recall, thinking, planning, working, reviewing, reporting). */
export interface PhaseTiming { label: string; ms: number }

export type BrainEvent =
  | { runId: string; at: number; type: 'start'; provider: Provider | null }
  | { runId: string; at: number; type: 'phase'; phase: TeamPhase; label: string }
  | { runId: string; at: number; type: 'agent'; agent: AgentId; status: AgentStatus; task?: string }
  | { runId: string; at: number; type: 'action'; agent: AgentId; sub?: string; text: string; kind?: ActivityLine['kind'] }
  | { runId: string; at: number; type: 'helper'; id: string; parent: AgentId; name: string; task?: string; skills?: string[]; status: HelperCard['status']; report?: string }
  | { runId: string; at: number; type: 'plan'; steps: PlanStep[]; note?: string }
  | { runId: string; at: number; type: 'step'; id: string; status: 'working' | 'done' | 'failed'; report?: string }
  | { runId: string; at: number; type: 'token'; text: string }
  | { runId: string; at: number; type: 'reset' }
  | { runId: string; at: number; type: 'notice'; text: string }
  | { runId: string; at: number; type: 'final'; text: string; agents: AgentId[]; sources: SourceLink[]; runNote?: string; timings?: PhaseTiming[] }
  | { runId: string; at: number; type: 'error'; message: string; cancelled?: boolean }
  | { runId: string; at: number; type: 'done' };

export interface ApprovalRequest {
  id: string;
  runId: string;
  agent: AgentId;
  kind: string;
  title: string;
  detail: string;
  createdAt: number;
}

/* ── Tasks ────────────────────────────────────────────────────────────── */

export interface Task {
  id: string;
  title: string;
  notes: string;
  due: string | null;
  remindAt: string | null;
  allDay: boolean;
  priority: 'low' | 'normal' | 'high';
  recurrence: 'daily' | 'weekdays' | 'weekly' | null;
  done: boolean;
  doneAt: string | null;
  notifiedAt: string | null;
  createdAt: string;
  updatedAt: string;
  source: 'operator' | 'ultron';
}

/* ── Apps / D2L / memory ─────────────────────────────────────────────── */

export type AppConnection = 'connected' | 'pending' | 'expired' | 'failed' | 'none';

export interface AppState {
  slug: string;
  name: string;
  group: 'Google' | 'Apps';
  blurb: string;
  recommended?: boolean;
  status: AppConnection;
  accountIds: string[];
  detail?: string;
}

export interface AppsStatus { hasKey: boolean; mode: 'connect' | 'project' | 'none'; auth: 'oauth' | 'key' | 'none'; ok: boolean; error?: string; hint?: string; userId: string; apps: AppState[]; checkedAt: number }

/** The agents' own browser profile: which sites have saved logins, and whether the sign-in window is open. */
export interface WebLogins { signInOpen: boolean; sites: string[]; checkedAt?: number }

export interface D2LStatus { baseUrl: string; signedIn: boolean; user?: string; error?: string }

/** Open-source add-ons in ~/UltronTools (electron/addons.ts). */
export interface AddonStatus { id: string; name: string; repo: string; installed: boolean; detail: string }
export interface AddonsReport {
  addons: AddonStatus[];
  hindsight: { installed: boolean; enabled: boolean; running: boolean; error?: string };
}

/** The operator's own Discord bot (electron/discord.ts). */
export interface DiscordStatus {
  configured: boolean;
  ok?: boolean;
  bot?: string;
  servers?: { id: string; name: string }[];
  inviteUrl?: string;
  /** Servers where Composio's shared bot is still a member. */
  sharedBotIn?: string[];
  tokenRejected?: boolean;
  stale?: boolean;
  error?: string;
}

export interface VaultStats {
  root: string;
  notes: number;
  memories: number;
  journalDays: number;
  research: number;
  teamRuns: number;
  lastUpdated: number | null;
}

export interface VaultNote { rel: string; title: string; folder: string; mtime: number; size: number }

export interface MemoryHit { rel: string; title: string; text: string; score: number }

export interface MemoryUpdate { at: number; saved: { title: string; rel: string; added: number; created: boolean }[]; profileAdded: number }

/* ── Conversation ─────────────────────────────────────────────────────── */

export type CoreState = 'idle' | 'listening' | 'thinking' | 'speaking' | 'offline';

export interface TranscriptEntry {
  id: string;
  who: 'you' | 'ultron' | 'system';
  text: string;
  at: number;
  streaming?: boolean;
  error?: boolean;
  sources?: SourceLink[];
  /** Which agents worked on this reply, and the saved team log if the team ran. */
  team?: { agents: AgentId[]; runNote?: string; actions: ActivityLine[] };
}
