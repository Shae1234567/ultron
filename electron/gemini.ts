import { GoogleGenAI } from '@google/genai';
import type { WebContents } from 'electron';
import { env } from './env';

// Second "brain" alongside the local Ollama daemon: Gemini's hosted models,
// for when the operator wants more capability than the free local model
// affords. Also doubles as the text-chat basis for a future live-voice mode.

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface GeminiStatus {
  running: boolean;
  host: string;
  models: string[];
  activeModel: string;
  modelInstalled: boolean;
  error?: string;
}

const API_HOST = 'https://generativelanguage.googleapis.com';
const AVAILABLE_MODELS = ['gemini-2.0-flash', 'gemini-2.0-flash-lite'];

function apiKey(): string {
  return env('GEMINI_API_KEY');
}

function activeModel(): string {
  return env('GEMINI_MODEL', 'gemini-2.0-flash');
}

/**
 * Unlike Ollama's status(), this never touches the network - there's no local
 * daemon to probe, and pinging the API just to answer "is it configured?"
 * would burn a real (billable) request for no reason.
 */
export async function status(): Promise<GeminiStatus> {
  const model = activeModel();
  const key = apiKey();
  if (!key) {
    return {
      running: false, host: API_HOST, models: [], activeModel: model, modelInstalled: false,
      error: 'No GEMINI_API_KEY configured.',
    };
  }
  return { running: true, host: API_HOST, models: AVAILABLE_MODELS, activeModel: model, modelInstalled: true };
}

// Cooperative cancellation - the SDK's stream iterator doesn't accept an
// AbortSignal, so cancel() just flags the requestId and the read loop below
// checks it between chunks.
const cancelled = new Set<string>();

export function cancel(requestId: string): void {
  cancelled.add(requestId);
}

interface GeminiContent {
  role: 'user' | 'model';
  parts: { text: string }[];
}

/** Splits the leading system message(s) out into a systemInstruction string, per the Gemini SDK's shape. */
function splitMessages(messages: ChatMessage[]): { systemInstruction: string; contents: GeminiContent[] } {
  let i = 0;
  const systemParts: string[] = [];
  while (i < messages.length && messages[i].role === 'system') {
    systemParts.push(messages[i].content);
    i += 1;
  }
  const contents: GeminiContent[] = messages.slice(i).map((m) => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: m.content }],
  }));
  return { systemInstruction: systemParts.join('\n\n'), contents };
}

/**
 * Streaming chat. Emits `gemini:chunk` / `gemini:done` / `gemini:error` on the
 * given WebContents, tagged with requestId - same contract as ollama.ts's
 * chatStream, including never letting this reject.
 */
export async function chatStream(
  wc: WebContents,
  requestId: string,
  messages: ChatMessage[],
  options: { model?: string; temperature?: number } = {},
): Promise<void> {
  const model = options.model || activeModel();
  const key = apiKey();

  const emit = (channel: string, payload: unknown) => {
    try {
      if (!wc.isDestroyed()) wc.send(channel, payload);
    } catch {
      /* frame disposed mid-navigation - nothing left to notify */
    }
  };

  try {
    if (!key) throw new Error('No GEMINI_API_KEY configured.');

    const { systemInstruction, contents } = splitMessages(messages);
    const ai = new GoogleGenAI({ apiKey: key });
    const stream = await ai.models.generateContentStream({
      model,
      contents,
      config: { systemInstruction, temperature: options.temperature ?? 0.7 },
    });

    let aborted = false;
    for await (const chunk of stream) {
      if (cancelled.has(requestId)) { aborted = true; break; }
      const token = chunk.text;
      if (token) emit('gemini:chunk', { requestId, token });
    }

    if (aborted) emit('gemini:done', { requestId, aborted: true });
    else emit('gemini:done', { requestId });
  } catch (e) {
    emit('gemini:error', { requestId, error: e instanceof Error ? e.message : String(e) });
  } finally {
    cancelled.delete(requestId);
  }
}

/** Non-streaming one-shot. Used for short background jobs like news relevance blurbs. */
export async function chatOnce(
  messages: ChatMessage[],
  options: { model?: string; temperature?: number; timeoutMs?: number } = {},
): Promise<string> {
  const key = apiKey();
  if (!key) throw new Error('No GEMINI_API_KEY configured.');

  const model = options.model || activeModel();
  const { systemInstruction, contents } = splitMessages(messages);
  const ai = new GoogleGenAI({ apiKey: key });

  // The SDK call doesn't take an AbortSignal, so timeout via Promise.race
  // against a rejecting timer instead - same intent as ollama.ts's
  // AbortController-based timeout, adapted to what this SDK supports.
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('Gemini request timed out')), options.timeoutMs ?? 60_000);
  });

  try {
    const result = await Promise.race([
      ai.models.generateContent({
        model,
        contents,
        config: { systemInstruction, temperature: options.temperature ?? 0.4 },
      }),
      timeout,
    ]);
    return result.text?.trim() ?? '';
  } finally {
    clearTimeout(timer!);
  }
}
