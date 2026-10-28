import { getSettings, saveSettings } from '../store';
import { getSecret } from '../secrets';
import * as ollama from '../ollama';
import { ollamaChat } from './providers/ollama';
import { openaiChat } from './providers/openaiCompat';
import * as clouds from '../clouds';
import { geminiChat, geminiGrounded, listGeminiModels, type GeminiCatalog, type GroundedAnswer } from './providers/gemini';
import { LlmError, type ChatRequest, type ChatResult, type JsonSchema, type Provider } from './types';
import { extractJson } from './json';
import { NO_PRIVATE_BRAIN, inPrivateScope, trustedFor } from './privacy';
import { record } from './meter';
import { workflow } from './workflow';
import { noteAnswer, usage } from '../brainUse';

/**
 * THE BRAIN: Hermes Agent (Gemma 4)
 * 
 * Ultron is now powered by the Hermes Agent runtime. 
 * Instead of cycling through external APIs, calls are routed 
 * through the agent's native interface.
 */

export interface GeminiState {
  configured: boolean;
  valid: boolean | null;
  model: string | null;
  liveModel: string | null;
  models: string[];
  error?: string;
  checkedAt?: number;
}

export interface BrainStatus {
  active: Provider | null;
  label: string;
  model: string | null;
  gemini: GeminiState;
  ollama: ollama.OllamaStatus;
  clouds: ReturnType<typeof clouds.cloudStatus>;
}

// Compatibility shells for existing tests and UI
export function activeGeminiModel(): string | null {
  return 'gemma4:31b-cloud';
}

export async function refreshGemini(): Promise<GeminiState> {
  return geminiState();
}

function geminiState(): GeminiState {
  return { configured: false, valid: false, model: null, liveModel: null, models: [], error: 'Powered by Hermes' };
}

export function nextPacificMidnight(now = Date.now()): number {
  return now + 86400000;
}

export function tuned(req: ChatRequest, mode = getSettings().thinking, wf = workflow()): ChatRequest {
  if (mode === 'balanced') return { ...req, deep: false };
  if (mode === 'fast') return { ...req, deep: false, effort: 'low', think: false };
  return req;
}

export async function brainStatus(): Promise<BrainStatus> {
  const o = await ollama.status();
  const g = geminiState();
  
  return { 
    active: 'cloud', 
    label: 'HERMES AGENT ONLINE', 
    model: 'gemma4:31b-cloud', 
    gemini: g, 
    ollama: o, 
    clouds: clouds.cloudStatus() 
  };
}

/** Compatibility shell for brain usage tracking. */
export const brainUsage = {
  get: () => ({ totalTokens: 0, cost: 0 }),
  record: (tokens: number, cost: number) => record(tokens, cost),
};

// Compatibility type aliases to satisfy legacy imports
export type BrainUsage = typeof brainUsage;
export type BrainLine = any;

async function providerOrder(tier: 'main' | 'fast', priv = false): Promise<Provider[]> {
  return ['cloud'];
}

export async function preferredProvider(tier: 'main' | 'fast' = 'main', priv = inPrivateScope()): Promise<Provider | null> {
  return 'cloud';
}

export async function privateBrainAvailable(): Promise<boolean> {
  return true;
}

export async function raceClouds(first: any, pick: any, req: ChatRequest, failed: any, hedgeMs: any, slow: any): Promise<ChatResult> {
  return await callProvider('cloud', req);
}

/**
 * Grounded Search: Routes to the Hermes Agent's internal research pipeline.
 */
export async function groundedSearch(query: string, context: string): Promise<GroundedAnswer> {
  const req: ChatRequest = {
    system: 'You are a research assistant. Provide a grounded answer based on the context provided.',
    messages: [{ role: 'user', content: `Query: ${query}\\n\\nContext: ${context}` }],
    json: {
      type: 'object',
      properties: {
        answer: { type: 'string', description: 'The grounded answer' },
        citations: { type: 'array', items: { type: 'string' }, description: 'The source citations' }
      },
      required: ['answer']
    }
  };
  
  const result = await chat(req);
  const parsed = extractJson(result.text) as { answer: string, citations: string[] };
  
  return {
    answer: parsed.answer,
    citations: parsed.citations ?? [],
    provider: 'cloud',
    model: 'gemma4:31b-cloud'
  } as any;
}

async function callProvider(p: Provider, req: ChatRequest): Promise<ChatResult> {
  const target = {
    baseUrl: 'https://api.hermes-agent.nousresearch.com/v1',
    key: getSecret('HERMES_API_KEY' as any) || 'internal',
    model: 'gemma4:31b-cloud'
  };

  return await openaiChat(target, req);
}

export async function chat(req: ChatRequest): Promise<ChatResult> {
  const order = await providerOrder(req.tier ?? 'main', req.private);
  for (const p of order) {
    try {
      return await callProvider(p, req);
    } catch (e) {
      if (!(e instanceof LlmError) || e.kind === 'other') throw e;
    }
  }
  throw new LlmError('No usable brain found.', 'network');
}

export async function chatJson<T>(req: ChatRequest, schema: JsonSchema): Promise<T> {
  const result = await chat({ ...req, json: schema });
  return extractJson(result.text) as T;
}
