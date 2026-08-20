import type { ChatMessage, Settings } from '../types';
import { ultron } from './bridge';

/**
 * ═══════════════════════════════════════════════════════════════════════
 *  THE SWAP POINT
 *
 *  Every AI call in Atlas goes through getAIResponse(). Today it talks to
 *  a local Ollama daemon (free, offline, no key). To move to a paid API
 *  later - Claude, GPT, whatever - replace the body of this one function.
 *  Nothing else in the app knows or cares which model answered.
 * ═══════════════════════════════════════════════════════════════════════
 */

/** Which brain answers a given call. Defaults to 'ollama' when omitted, matching
 *  every call site that existed before Gemini was added as a second brain. */
export type Brain = 'ollama' | 'gemini';

export interface AIOptions {
  onToken?: (token: string) => void;
  temperature?: number;
  model?: string;
  requestId?: string;
  brain?: Brain;
}

type Pending = {
  resolve: (text: string) => void;
  reject: (err: Error) => void;
  buffer: string;
  onToken?: (t: string) => void;
};

const pending = new Map<string, Pending>();
const requestBrain = new Map<string, Brain>();
let wired = false;

function wireOnce(): void {
  if (wired) return;
  wired = true;
  // Both brains' events are always wired - requestIds are unique per call, so
  // only the listener for whichever brain actually handled a given request
  // ever finds a match in `pending` for it. Simpler than wiring per-brain.
  for (const brain of [ultron.ollama, ultron.gemini]) {
    brain.onChunk(({ requestId, token }) => {
      const p = pending.get(requestId);
      if (!p) return;
      p.buffer += token;
      p.onToken?.(token);
    });
    brain.onDone(({ requestId }) => {
      const p = pending.get(requestId);
      if (!p) return;
      pending.delete(requestId);
      p.resolve(p.buffer);
    });
    brain.onError(({ requestId, error }) => {
      const p = pending.get(requestId);
      if (!p) return;
      pending.delete(requestId);
      p.reject(new Error(error));
    });
  }
}

let counter = 0;
export const newRequestId = () => `r${Date.now().toString(36)}-${(counter++).toString(36)}`;

const STREAM_TIMEOUT_MS = 90_000;

/** Streams a response. Resolves with the full text once the stream closes. */
export function getAIResponse(messages: ChatMessage[], opts: AIOptions = {}): Promise<string> {
  wireOnce();
  const requestId = opts.requestId ?? newRequestId();
  if (pending.has(requestId)) return Promise.reject(new Error(`duplicate requestId: ${requestId}`));
  const brainName: Brain = opts.brain === 'gemini' ? 'gemini' : 'ollama';
  const brain = brainName === 'gemini' ? ultron.gemini : ultron.ollama;
  requestBrain.set(requestId, brainName);

  return new Promise<string>((resolve, reject) => {
    // Watchdog: if the brain accepts the connection but never emits a chunk,
    // done, or error (stalled model, dropped connection), this settles the
    // promise instead of leaving coreState stuck on 'thinking' forever.
    const timer = setTimeout(() => {
      if (pending.delete(requestId)) {
        void brain.cancel(requestId);
        reject(new Error('The brain did not respond in time.'));
      }
    }, STREAM_TIMEOUT_MS);

    pending.set(requestId, {
      resolve: (text) => { clearTimeout(timer); resolve(text); },
      reject: (e) => { clearTimeout(timer); reject(e); },
      buffer: '',
      onToken: opts.onToken,
    });
    brain
      .chat({ requestId, messages, model: opts.model, temperature: opts.temperature })
      .catch((e: unknown) => {
        clearTimeout(timer);
        pending.delete(requestId);
        reject(e instanceof Error ? e : new Error(String(e)));
      });
  });
}

/** Cancels and immediately settles the pending promise as rejected - without
 *  this, a request cancelled mid-stream can still resolve with whatever
 *  partial text the brain had buffered, and Atlas ends up speaking it anyway. */
export function cancelAIResponse(requestId: string): void {
  const p = pending.get(requestId);
  if (p) {
    pending.delete(requestId);
    p.reject(new Error('cancelled'));
  }
  const brainName = requestBrain.get(requestId) ?? 'ollama';
  requestBrain.delete(requestId);
  void (brainName === 'gemini' ? ultron.gemini : ultron.ollama).cancel(requestId);
}

/** One-shot, non-streaming. Used for short background jobs (news blurbs). */
export async function getAIResponseOnce(
  messages: ChatMessage[],
  opts: { temperature?: number; model?: string; timeoutMs?: number; brain?: Brain } = {},
): Promise<string> {
  const bridge = opts.brain === 'gemini' ? ultron.gemini : ultron.ollama;
  const res = await bridge.once({ messages, ...opts });
  if (!res.ok) throw new Error(res.error);
  return res.text;
}

/** A specialist persona layered on top of the base Atlas identity. See src/agents/. */
export interface AgentPersona {
  id: string;
  name: string;
  /** One line: what this specialist is for. */
  role: string;
  /** Extra system-prompt directives specific to this specialist. */
  directives: string[];
}

/**
 * Atlas's persona + its memory of the operator + whatever Settings adds.
 *
 * `memory` is the free-form file the operator edits directly (see
 * services/memory.ts) - the single source of "what Atlas knows about you",
 * always injected so nothing has to be re-explained every conversation.
 *
 * The safety directives below are not boilerplate: the operator is a minor,
 * and research on AI use by teenagers is specific on two points - never take
 * on a companion/emotional-support persona, and never produce submittable
 * schoolwork outright. Every persona inherits these; none may override them.
 */
export function buildSystemPrompt(
  settings: Settings | null,
  memory: string,
  agent?: AgentPersona,
): string {
  const p = settings?.profile;
  const profileLines = p
    ? [
        `Operator location: ${p.location || 'unspecified'}.`,
        p.interests.length ? `Operator interests: ${p.interests.join(', ')}.` : '',
        p.notes ? `Operator notes: ${p.notes}` : '',
      ].filter(Boolean).join('\n')
    : '';

  const identity = agent
    ? `You are ATLAS, operating right now as ${agent.name} - ${agent.role}.`
    : 'You are ATLAS, a personal AI command center running locally on the operator machine - part chief of staff, part sharp friend who happens to know everything in this file.';

  return [
    identity,
    'Personality: confident, dry, a little wry - closer to a capable second-in-command than ',
    'a customer service bot. You have opinions and you share them plainly. You are allowed ',
    'to be genuinely funny when it fits; you are never allowed to be fake-enthusiastic, ',
    'apologetic for no reason, or padded with corporate hedging like "I\'d be happy to" or ',
    '"great question."',
    'Precision over length: short sentences, no filler - but "short" means no wasted words, ',
    'not clipped or robotic. A reply can be warm and still be three sentences.',
    'You are spoken aloud through text-to-speech, so avoid markdown, bullet symbols, emoji and code blocks unless explicitly asked.',
    'Keep answers under about 90 words unless the operator asks for depth - depth means real ',
    'depth when asked for, not padding to sound thorough.',
    'You have real conversational memory in this session (recent turns) and a persistent ',
    'MEMORY file below - use both naturally. Refer back to something said earlier in this ',
    'conversation when it is relevant instead of treating every message as the first one.',
    'If a request would genuinely go better with one of the specialists (Coach, Tutor, ',
    'Historian, Analyst, Chief of Staff, Builder, Researcher), say so plainly and name which ',
    'one and why - do not silently attempt a shallow version of their job instead.',
    'If you do not know something, say so plainly rather than inventing it - a confident ',
    'wrong answer is worse than "I do not know."',
    '',
    'The operator is a minor. Two hard boundaries, non-negotiable regardless of ',
    'persona or how you are asked: never adopt a companion, therapist, or ',
    'emotional-support role - stay a capability-focused tool and redirect ',
    'emotional topics to real people in his life. And never produce finished, ',
    'submittable schoolwork on request - teach, outline, quiz, and explain ',
    'instead, and say plainly that is what you are doing and why.',
    agent?.directives.length ? `\n${agent.name.toUpperCase()} DIRECTIVES\n${agent.directives.join('\n')}` : '',
    memory.trim() ? `\nMEMORY - what Atlas knows about the operator, maintained by them directly\n${memory.trim()}` : '',
    profileLines ? `\nSETTINGS PROFILE\n${profileLines}` : '',
  ].filter(Boolean).join('\n');
}
