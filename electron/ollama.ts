import type { WebContents } from 'electron';
import { getSettings } from './store';
import { env } from './env';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface OllamaStatus {
  running: boolean;
  host: string;
  models: string[];
  activeModel: string;
  modelInstalled: boolean;
  error?: string;
}

function host(): string {
  const s = getSettings();
  return (s.ollama.host || env('OLLAMA_HOST', 'http://localhost:11434')).replace(/\/$/, '');
}

function activeModel(): string {
  const s = getSettings();
  return s.ollama.model || env('OLLAMA_MODEL', 'llama3.2');
}

/** Probes the local Ollama daemon. Never throws — the UI needs a verdict, not an exception. */
export async function status(): Promise<OllamaStatus> {
  const h = host();
  const model = activeModel();
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 2500);
  try {
    // Ollama not running yet is the single most common outcome here (checked
    // every 20s by the UI's poll), and fetch rejecting immediately with
    // ECONNREFUSED skipped straight to the catch block below, past a
    // clearTimeout that used to sit right after the await - leaking one
    // 2.5s timer per check. try/finally catches every exit path instead.
    const res = await fetch(`${h}/api/tags`, { signal: ctrl.signal });
    if (!res.ok) {
      return {
        running: false, host: h, models: [], activeModel: model, modelInstalled: false,
        error: `Ollama responded ${res.status}`,
      };
    }
    const data = (await res.json()) as { models?: { name: string }[] };
    const models = (data.models ?? []).map((m) => m.name);
    // "llama3.2" should match an installed "llama3.2:latest"
    const modelInstalled = models.some((m) => m === model || m.split(':')[0] === model.split(':')[0]);
    return { running: true, host: h, models, activeModel: model, modelInstalled };
  } catch (e) {
    return {
      running: false, host: h, models: [], activeModel: model, modelInstalled: false,
      error: e instanceof Error ? e.message : String(e),
    };
  } finally {
    clearTimeout(t);
  }
}

const inflight = new Map<string, AbortController>();

export function cancel(requestId: string): void {
  inflight.get(requestId)?.abort();
  inflight.delete(requestId);
}

/**
 * Streaming chat. Emits `ollama:chunk` / `ollama:done` / `ollama:error` on the
 * given WebContents, tagged with requestId.
 */
const IDLE_TIMEOUT_MS = 90_000;

export async function chatStream(
  wc: WebContents,
  requestId: string,
  messages: ChatMessage[],
  options: { model?: string; temperature?: number } = {},
): Promise<void> {
  const h = host();
  const model = options.model || activeModel();
  const ctrl = new AbortController();
  inflight.set(requestId, ctrl);

  // Resets on every chunk received - catches the daemon accepting the
  // connection but then stalling mid-generation (wedged runner, model swap),
  // which otherwise left the renderer's promise unsettled forever.
  let idle: ReturnType<typeof setTimeout>;
  const armIdle = () => {
    clearTimeout(idle);
    idle = setTimeout(() => ctrl.abort(), IDLE_TIMEOUT_MS);
  };

  const emit = (channel: string, payload: unknown) => {
    try {
      if (!wc.isDestroyed()) wc.send(channel, payload);
    } catch {
      /* frame disposed mid-navigation - nothing left to notify */
    }
  };
  const onDestroyed = () => ctrl.abort();
  wc.once('destroyed', onDestroyed);

  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;

  const handleLine = (line: string): void => {
    if (!line.trim()) return;
    const json = JSON.parse(line) as { message?: { content?: string }; done?: boolean; error?: string };
    if (json.error) throw new Error(json.error);
    const token = json.message?.content;
    if (token) emit('ollama:chunk', { requestId, token });
  };

  try {
    armIdle();
    const res = await fetch(`${h}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: ctrl.signal,
      body: JSON.stringify({
        model,
        messages,
        stream: true,
        options: { temperature: options.temperature ?? 0.7 },
      }),
    });

    if (!res.ok || !res.body) {
      const detail = await res.text().catch(() => '');
      throw new Error(`Ollama ${res.status}: ${detail.slice(0, 200) || 'no response body'}`);
    }

    reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      armIdle();
      buffer += decoder.decode(value, { stream: true });
      // Ollama streams newline-delimited JSON
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        try {
          handleLine(line);
        } catch (err) {
          // A genuine JSON.parse failure here means malformed/non-Ollama
          // output (a proxy's HTML error page, a truncated frame) - not a
          // partial line, since lines.pop() above already withheld the one
          // line that could still be incomplete. Log and skip rather than
          // aborting the whole reply over one bad line.
          if (err instanceof SyntaxError) { console.warn('[ollama] unparseable line:', line.slice(0, 200)); continue; }
          throw err;
        }
      }
    }
    // Flush whatever is left in the buffer - Ollama's terminal {"done":true}
    // object frequently arrives without a trailing newline, and without this
    // it was silently dropped: the last token missing, or a late mid-stream
    // error object landing here and getting swallowed instead of surfaced.
    if (buffer.trim()) {
      try {
        handleLine(buffer);
      } catch (err) {
        if (!(err instanceof SyntaxError)) throw err;
      }
    }
    emit('ollama:done', { requestId });
  } catch (e) {
    const aborted = e instanceof Error && e.name === 'AbortError';
    if (aborted) emit('ollama:done', { requestId, aborted: true });
    else emit('ollama:error', { requestId, error: e instanceof Error ? e.message : String(e) });
  } finally {
    clearTimeout(idle!);
    wc.removeListener('destroyed', onDestroyed);
    inflight.delete(requestId);
    if (reader) { try { await reader.cancel(); } catch { /* already closed */ } }
  }
}

/** Non-streaming one-shot. Used for short background jobs like news relevance blurbs. */
export async function chatOnce(
  messages: ChatMessage[],
  options: { model?: string; temperature?: number; timeoutMs?: number } = {},
): Promise<string> {
  const h = host();
  const model = options.model || activeModel();
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), options.timeoutMs ?? 60_000);
  try {
    const res = await fetch(`${h}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: ctrl.signal,
      body: JSON.stringify({
        model,
        messages,
        stream: false,
        options: { temperature: options.temperature ?? 0.4 },
      }),
    });
    if (!res.ok) throw new Error(`Ollama ${res.status}`);
    const data = (await res.json()) as { message?: { content?: string } };
    return (data.message?.content ?? '').trim();
  } finally {
    clearTimeout(t);
  }
}
