import { useStore } from '../state/store';
import { buildSystemPrompt, getAIResponseOnce } from './ai';
import { speak } from './speech';
import { ultron } from './bridge';
import type { ChatMessage } from '../types';

/**
 * Proactive engine - the part of Atlas that speaks first instead of only
 * ever answering. Two entry points:
 *
 *   initProactiveGreeting()       - one greeting, once, when the brain boots
 *   scheduleProactiveCheckIn(min) - a recurring idle check-in
 *
 * Design choices worth flagging because they are not obvious from the code:
 *
 * 1. "Never interrupt someone already mid-conversation." Both the greeting
 *    and every check-in re-check `busy` and the transcript immediately
 *    before speaking, not just at the top of a long async function. The
 *    operator drives the primary interaction; Atlas talking first is a
 *    convenience layered on top of that, not a competing voice. If the
 *    operator has already said anything, or the app is mid-request, the
 *    proactive attempt backs off entirely rather than queuing itself for
 *    "after."
 *
 * 2. "Fail silently." A proactive utterance is, by definition, something
 *    the operator did not ask for. If the brain call errors (model not
 *    loaded, timeout, whatever), the correct behavior is to say nothing -
 *    not to push a system/error entry into the transcript, which would be
 *    a bigger interruption than the failed greeting itself. Every AI call
 *    here is wrapped in try/catch that at most logs to the console.
 */

const GREETING_TIMEOUT_MS = 15_000;
const CHECK_IN_TEMPERATURE = 0.9;

let hasGreetedThisSession = false;

function timeOfDay(d: Date = new Date()): 'morning' | 'afternoon' | 'evening' | 'late night' {
  const h = d.getHours();
  if (h >= 5 && h < 12) return 'morning';
  if (h >= 12 && h < 17) return 'afternoon';
  if (h >= 17 && h < 22) return 'evening';
  return 'late night';
}

/** True if the operator has already said anything this session, or a request is in flight. */
function operatorAlreadyEngaged(): boolean {
  const { busy, transcript } = useStore.getState();
  if (busy) return true;
  return transcript.some((t) => t.who === 'you');
}

/** Speaks `text` and drops it into the transcript exactly like a normal Atlas reply. */
function sayProactively(text: string): void {
  const trimmed = text.trim();
  if (!trimmed) return;
  const { pushEntry, settings } = useStore.getState();
  pushEntry({ who: 'ultron', text: trimmed });
  const voice = settings?.voice;
  speak(trimmed, {
    voiceName: voice?.name,
    rate: voice?.rate,
    pitch: voice?.pitch,
  });
  // A no-op when the window is already focused - see notify:show's handler.
  void ultron.notify.show('Atlas', trimmed).catch(() => {});
}

function brainReady(): boolean {
  const { ollama, settings } = useStore.getState();
  return Boolean(ollama?.running && ollama.modelInstalled && settings);
}

/** Resolves once the brain is ready, or after GREETING_TIMEOUT_MS - whichever first. */
function waitForBrainReady(timeoutMs: number): Promise<boolean> {
  if (brainReady()) return Promise.resolve(true);
  return new Promise((resolve) => {
    let settled = false;
    const finish = (ready: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      unsubscribe();
      resolve(ready);
    };
    const unsubscribe = useStore.subscribe(() => {
      if (brainReady()) finish(true);
    });
    const timer = setTimeout(() => finish(false), timeoutMs);
  });
}

/**
 * Call once, early, from App.tsx. Waits for the brain to actually be usable,
 * then - if the operator hasn't already started talking - has Atlas speak a
 * short, time-aware greeting first. Gives up quietly on timeout; never nags
 * with an error, per the fail-silently design note above.
 */
export function initProactiveGreeting(): void {
  if (hasGreetedThisSession) return;
  hasGreetedThisSession = true; // claim the slot immediately - guards double-firing even under re-entrant calls

  void (async () => {
    try {
      const ready = await waitForBrainReady(GREETING_TIMEOUT_MS);
      if (!ready) return; // brain never came up in time - stay quiet, don't nag
      if (operatorAlreadyEngaged()) return; // operator beat Atlas to it - don't talk over them

      const { settings, memory } = useStore.getState();
      const tod = timeOfDay();
      // Consumed once - if a previous session left a summary, fold it in and
      // it will never surface again after this (see sessionMemory.ts).
      const pending = await ultron.sessionMemory.consume().catch(() => null);
      const instructions = [
        'PROACTIVE GREETING MODE - you are speaking FIRST, unprompted, at app boot.',
        'This is not a reply to anything the operator said - it is your own voice opening the session.',
        `It is currently ${tod} for the operator. Greet them naturally for that time of day.`,
        pending
          ? `Yesterday's session, in your own words: "${pending.text}". Mention this briefly and naturally as part of the greeting - do not just recite it verbatim, weave it in.`
          : '',
        'Keep the entire greeting under 30 words.',
        'End with exactly ONE natural, specific question inviting the operator to say what they want ' +
          'to work on or ask about right now. Do not use a generic "how can I help you today" - make it ' +
          'feel like a specific opener, grounded in whatever you actually know about them from memory or ' +
          'settings if relevant, but never invent specifics you do not have.',
        'Output only the greeting itself - no labels, no quotation marks, no stage directions.',
      ].filter(Boolean).join('\n');

      const messages: ChatMessage[] = [
        { role: 'system', content: `${buildSystemPrompt(settings, memory)}\n\n${instructions}` },
      ];

      const text = await getAIResponseOnce(messages, {
        model: settings?.ollama.model,
        temperature: 0.8,
      });

      if (operatorAlreadyEngaged()) return; // re-check - the brain call took real time
      sayProactively(text);
    } catch (e) {
      // Fail silently - see file header. A failed proactive greeting is a
      // non-event to the operator, not something worth surfacing.
      console.warn('[proactive] greeting failed, staying quiet:', e);
    }
  })();
}

/**
 * Same greeting as initProactiveGreeting(), but callable repeatedly - used
 * when the wake word ("atlas") brings the window forward from the tray, since
 * that should greet the operator again each time, not just once per process
 * lifetime. Still backs off if the operator is already mid-conversation.
 */
export function greetNow(): void {
  void (async () => {
    try {
      if (!brainReady()) return;
      if (operatorAlreadyEngaged()) return;

      const { settings, memory } = useStore.getState();
      const tod = timeOfDay();
      const instructions = [
        'PROACTIVE GREETING MODE - you are speaking FIRST, unprompted. The operator just said your ' +
          'wake word ("Atlas") to summon you - greet them like you just walked in, briefly.',
        `It is currently ${tod} for the operator.`,
        'Keep the entire greeting under 20 words.',
        'End with one short, natural question inviting them to say what they need.',
        'Output only the greeting itself - no labels, no quotation marks, no stage directions.',
      ].join('\n');

      const messages: ChatMessage[] = [
        { role: 'system', content: `${buildSystemPrompt(settings, memory)}\n\n${instructions}` },
      ];

      const text = await getAIResponseOnce(messages, { model: settings?.ollama.model, temperature: 0.8 });
      if (operatorAlreadyEngaged()) return;
      sayProactively(text);
    } catch (e) {
      console.warn('[proactive] wake-word greeting failed, staying quiet:', e);
    }
  })();
}

/**
 * Starts a recurring idle check-in every `intervalMinutes` (default 20).
 * Returns a stop function that clears the interval - call it on unmount.
 */
export function scheduleProactiveCheckIn(intervalMinutes = 20): () => void {
  const intervalMs = Math.max(1, intervalMinutes) * 60_000;

  const timer = setInterval(() => {
    void attemptCheckIn(intervalMs);
  }, intervalMs);

  return () => clearInterval(timer);
}

async function attemptCheckIn(intervalMs: number): Promise<void> {
  try {
    if (!brainReady()) return;
    if (operatorAlreadyEngaged()) return;

    const { coreState, transcript } = useStore.getState();
    if (coreState !== 'idle') return;

    const lastAt = transcript.length ? transcript[transcript.length - 1].at : 0;
    if (Date.now() - lastAt < intervalMs) return; // not actually idle long enough yet

    const { settings, memory } = useStore.getState();
    const tod = timeOfDay();
    const instructions = [
      'PROACTIVE CHECK-IN MODE - you are speaking FIRST, unprompted, after a stretch of silence.',
      'This is not a reply to anything the operator said.',
      `It is currently ${tod}. The session has been idle a while.`,
      'Keep the entire check-in under 25 words.',
      'Vary the angle each time rather than always asking the same generic thing - it can touch on ' +
        'anything relevant you might reasonably know from memory, settings, or something mentioned ' +
        'earlier in this transcript (e.g. an interest tag, a topic that came up). Never invent specifics ' +
        'you do not actually have - if you have nothing specific, keep it a plain, warm check-in instead ' +
        'of fabricating a detail.',
      'Output only the check-in itself - no labels, no quotation marks, no stage directions.',
    ].join('\n');

    const messages: ChatMessage[] = [
      { role: 'system', content: `${buildSystemPrompt(settings, memory)}\n\n${instructions}` },
    ];

    const text = await getAIResponseOnce(messages, {
      model: settings?.ollama.model,
      temperature: CHECK_IN_TEMPERATURE,
    });

    if (operatorAlreadyEngaged()) return; // re-check post-await
    sayProactively(text);
  } catch (e) {
    // Fail silently - see file header. A missed check-in is simply skipped.
    console.warn('[proactive] check-in failed, staying quiet:', e);
  }
}

/**
 * Best-effort session summary, meant to be called from a `beforeunload`
 * handler as the window closes. Not awaited/blocking by the caller - a
 * window closing is not the moment to risk hanging on a brain call. Only
 * writes a summary if the session actually had a real exchange (an empty
 * or you-never-said-anything session has nothing worth recapping tomorrow).
 */
export async function saveSessionSummaryNow(): Promise<void> {
  try {
    if (!brainReady()) return;
    const { settings, memory, transcript } = useStore.getState();
    const hadRealExchange = transcript.some((t) => t.who === 'you' && t.text.trim());
    if (!hadRealExchange) return;

    const recent = transcript
      .filter((t) => (t.who === 'you' || t.who === 'ultron') && !t.error && t.text.trim())
      .slice(-16)
      .map((t) => `${t.who === 'you' ? 'Operator' : 'Atlas'}: ${t.text}`)
      .join('\n');

    const instructions = [
      'Summarise this conversation in exactly 1-2 short sentences, third person, ' +
        'for Atlas to mention naturally tomorrow morning (e.g. "yesterday you were working on X").',
      'Output only the summary - no labels, no quotation marks.',
    ].join('\n');

    const messages: ChatMessage[] = [
      { role: 'system', content: `${buildSystemPrompt(settings, memory)}\n\n${instructions}` },
      { role: 'user', content: recent },
    ];

    const text = await getAIResponseOnce(messages, { model: settings?.ollama.model, temperature: 0.4, timeoutMs: 8000 });
    if (text.trim()) await ultron.sessionMemory.save(text.trim());
  } catch (e) {
    console.warn('[proactive] session summary failed, skipping:', e);
  }
}
