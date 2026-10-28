/** 'cloud' is any of the free services in clouds.ts - which one is picked per call. */
export type Provider = 'gemini' | 'cloud' | 'ollama';

/** Ultron and the shared team every department borrows. */
export const CORE_AGENT_IDS = ['ultron', 'athena', 'argus', 'hephaestus', 'hermes', 'chronos', 'mnemosyne', 'daedalus'] as const;
/** Department agents that are built and running. A department's agents join this list when it is built. */
export const DEPARTMENT_AGENT_IDS = ['asclepius', 'achilles', 'heracles', 'demeter', 'hypnos', 'prometheus', 'chiron', 'sphinx', 'kratos', 'dionysus', 'theseus', 'morpheus', 'orpheus', 'clio', 'ares', 'calliope', 'atlas', 'odysseus', 'talos', 'nike'] as const;
/** Every agent that exists - mirrored in src/types/index.ts (a test keeps the two the same). */
export const AGENT_IDS = [...CORE_AGENT_IDS, ...DEPARTMENT_AGENT_IDS] as const;
export type AgentId = (typeof AGENT_IDS)[number];

/** The council's departments, in build order (Money is parked). */
export const DEPARTMENT_IDS = ['health', 'school', 'media', 'history', 'projects'] as const;
export type DepartmentId = (typeof DEPARTMENT_IDS)[number];

export interface AgentDef {
  id: AgentId;
  name: string;
  title: string;
  summary: string;
  color: string;
  tools: string[];
  directives: string[];
  /** The department this agent works in; unset for Ultron and the shared team. */
  department?: DepartmentId;
  /** How a department agent talks - for its in-character lines in the council chamber. */
  voice?: string;
}

export interface JsonSchema {
  type: string;
  description?: string;
  properties?: Record<string, JsonSchema & Record<string, unknown>>;
  items?: JsonSchema;
  required?: string[];
  enum?: string[];
  [key: string]: unknown;
}

export interface ToolSpec {
  name: string;
  description: string;
  parameters: JsonSchema;
}

export interface ToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
}

export type LlmMessage =
  | { role: 'user'; content: string; images?: { mimeType: string; data: string }[] }
  | { role: 'assistant'; content: string; toolCalls?: ToolCall[]; native?: unknown; nativeProvider?: Provider }
  | { role: 'tool'; callId: string; name: string; content: string };

/** main = the strongest brain available; fast = cheap background work (memory, news blurbs). */
export type Tier = 'main' | 'fast';
export type Effort = 'low' | 'medium' | 'high';

export interface ChatRequest {
  system: string;
  messages: LlmMessage[];
  tools?: ToolSpec[];
  temperature?: number;
  /** true = any JSON object; a schema = structured output against that schema. */
  json?: boolean | JsonSchema;
  think?: boolean;
  /** How hard the model should think: planning and reviewing high, background chores low. Unset = the model's default. */
  effort?: Effort;
  /** Worth the strongest (slower) model - Gemini Pro when the key allows it. */
  deep?: boolean;
  /** Maths or hard reasoning: on the local brain, the reasoning model (DeepSeek-R1) takes it when it is set up. */
  reason?: boolean;
  tier?: Tier;
  /** Carries private data (health, grades, injuries): only the local model and services trusted not to keep it may answer. */
  private?: boolean;
  /** Background work that must never load the local model (it shares the GPU with his games): a cloud brain or nothing. */
  noLocal?: boolean;
  signal?: AbortSignal;
  onToken?: (token: string) => void;
  /** Called when the router falls back from one provider to another. */
  onNotice?: (text: string) => void;
  /** Called once, when the service first sends any of its answer (or its thinking) - used to race a slow service. */
  onAlive?: () => void;
}

export interface ChatResult {
  text: string;
  toolCalls: ToolCall[];
  native?: unknown;
  provider: Provider;
  model: string;
  /** Tokens this call used, when the provider reports them. */
  usage?: { input?: number; output?: number; thinking?: number };
}

export class LlmError extends Error {
  constructor(
    message: string,
    readonly kind: 'auth' | 'rate' | 'model' | 'network' | 'aborted' | 'other',
    readonly retryAfterMs?: number,
  ) {
    super(message);
    this.name = 'LlmError';
  }
}

export function newId(prefix = 'c'): string {
  return `${prefix}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}
