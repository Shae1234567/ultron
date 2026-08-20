import { useStore, useSttStore } from '../state/store';
import type { ChatMessage } from '../types';
import { buildSystemPrompt, cancelAIResponse, getAIResponse, newRequestId } from './ai';
import type { Specialist } from '../agents/types';
import { speak, stopSpeaking } from './speech';
import { getStream, startMic, stopMic } from './audio';
import { startRecording, stopRecording } from './recorder';
import { ensureModel, transcribe } from './stt';
import { ultron } from './bridge';
import { researchMulti, formatResearchContext } from './research';
import type { ResearchSource } from '../types';

/**
 * Conversation orchestration. Lives outside React so the push-to-talk key
 * handler, the composer and the news module can all drive the same pipeline.
 */

// llama3.2's context window is 128k tokens - 12 turns was leaving most of
// that unused. More history means Ultron actually remembers the start of a
// long conversation instead of visibly forgetting it a few exchanges in.
const HISTORY_TURNS = 24;
let activeRequestId: string | null = null;

function historyMessages(): ChatMessage[] {
  const { transcript } = useStore.getState();
  return transcript
    .filter((t) => (t.who === 'you' || t.who === 'ultron') && !t.error && t.text.trim())
    .slice(-HISTORY_TURNS)
    .map((t) => ({ role: t.who === 'you' ? ('user' as const) : ('assistant' as const), content: t.text }));
}

export function isBusy(): boolean {
  return activeRequestId !== null;
}

export function cancelCurrent(): void {
  if (activeRequestId) {
    cancelAIResponse(activeRequestId);
    activeRequestId = null;
  }
  // Escape used to only stop generation/speech - if the operator was mid
  // push-to-talk, the mic kept recording and the release still ran the full
  // transcribe-and-submit pipeline as though nothing happened.
  if (pttActive) {
    pttActive = false;
    stopRecording().catch(() => {});
    stopMic();
  }
  stopSpeaking();
  useStore.getState().setBusy(false);
  useStore.getState().setCoreState('idle');
}

/** Runs a prompt through the brain, streams it into the transcript, then speaks it. */
export async function submitMessage(
  text: string,
  opts: { speakReply?: boolean; agent?: Specialist } = {},
): Promise<void> {
  const trimmed = text.trim();
  // Also refuses while push-to-talk is recording - otherwise a text send that
  // lands mid-recording claims activeRequestId, and the transcribed voice
  // message that follows silently no-ops when it finds the slot already taken.
  if (!trimmed || activeRequestId || pttActive) return;

  const store = useStore.getState();
  const { ollama, settings, memory, pushEntry, appendToEntry, finishEntry, setCoreState, setBusy } = store;

  pushEntry({ who: 'you', text: trimmed });

  if (!ollama?.running) {
    pushEntry({
      who: 'system',
      text: 'Brain offline. Ollama is not responding on ' + (ollama?.host ?? 'localhost:11434') + '. Open SETTINGS for setup steps.',
      error: true,
    });
    store.setOverlay({ kind: 'ollama' });
    return;
  }
  if (!ollama.modelInstalled) {
    pushEntry({
      who: 'system',
      text: `Model "${ollama.activeModel}" is not installed. Run: ollama pull ${ollama.activeModel}`,
      error: true,
    });
    store.setOverlay({ kind: 'ollama' });
    return;
  }

  const agent = opts.agent ?? store.activeAgent ?? undefined;

  setCoreState('thinking');
  setBusy(true);
  const replyId = pushEntry({ who: 'ultron', text: '', streaming: true });
  const requestId = newRequestId();
  activeRequestId = requestId;

  // Specialist live capabilities land here, BEFORE the history/user turns -
  // a system message placed after the user's turn breaks llama3.2's chat
  // template (observed: the model echoed the literal token "assistant"
  // instead of answering). Each case is a real fetch, never a fake one -
  // if it fails, the block says so plainly rather than inventing an answer.
  const systemBlocks = [buildSystemPrompt(settings, memory, agent)];
  let sources: ResearchSource[] = [];
  switch (agent?.capability) {
    case 'research': {
      sources = await researchMulti(trimmed);
      systemBlocks.push(formatResearchContext(sources, trimmed));
      break;
    }
    case 'weather': {
      const place = settings?.profile.location || 'Calgary, Alberta, Canada';
      const w = await ultron.research.weather(place);
      systemBlocks.push(
        w
          ? `LIVE WEATHER - ${w.place} right now: ${w.tempC}°C (feels like ${w.feelsLikeC}°C), ${w.condition}, wind ${w.windKph} km/h, ${w.isDay ? 'daytime' : 'night'}. Use this for any training/outdoor-safety advice.`
          : 'LIVE WEATHER: the fetch failed just now. Tell the operator plainly you could not reach the weather service. Do not state a temperature, condition, or forecast of any kind - you have none.',
      );
      break;
    }
    case 'on-this-day': {
      const events = await ultron.research.onThisDay();
      systemBlocks.push(
        events.length
          ? `LIVE ON THIS DAY (today's real date, oldest first):\n${events.map((e) => `${e.year}: ${e.text}`).join('\n')}`
          : 'LIVE ON THIS DAY: the feed returned nothing just now. Tell the operator plainly that nothing came back. Do not name a historical event, year, or figure for today - you have none to draw from.',
      );
      break;
    }
    case 'github': {
      const connected = await ultron.github.hasToken();
      if (!connected) {
        // A small model demonstrably will invent plausible-sounding repo
        // names here if this reads as a passive fact instead of a direct
        // order - observed live: asked "what repos am I working on" with no
        // token connected, it fabricated two fake project names rather than
        // saying it had nothing. This block is deliberately blunt and
        // repeats the instruction because of that, not out of caution alone.
        systemBlocks.push(
          'LIVE GITHUB: NOT CONNECTED. You have zero repo or issue data - none was fetched, ' +
          'none exists in this conversation. If asked about repos, issues, pull requests, or ' +
          'GitHub activity, your entire answer must be that GitHub is not connected yet and it ' +
          'can be connected from Systems -> Connectors -> GitHub. Under no circumstances invent, ' +
          'guess, or name a repo, project, or issue - you have not seen any and must not pretend ' +
          'otherwise.',
        );
        break;
      }
      const [repos, work] = await Promise.all([ultron.github.repos(6), ultron.github.openWork(8)]);
      const repoLines = repos.length
        ? repos.map((r) => `${r.fullName}${r.private ? ' (private)' : ''} - updated ${r.updatedAt}${r.description ? ` - ${r.description}` : ''}`).join('\n')
        : '(none visible to this token)';
      const workLines = work.length
        ? work.map((i) => `${i.isPullRequest ? 'PR' : 'Issue'} in ${i.repo}: ${i.title}`).join('\n')
        : '(nothing open right now)';
      systemBlocks.push(
        `LIVE GITHUB - real data just fetched, this is the complete list, nothing else exists:\n\n` +
        `Recently updated repos:\n${repoLines}\n\nOpen issues/PRs:\n${workLines}\n\n` +
        'Only reference repos/issues that appear above. Do not add, embellish, or invent any not listed here.',
      );
      break;
    }
    case 'notion': {
      const connected = await ultron.notion.hasToken();
      if (!connected) {
        // Same failure mode as GitHub, same fix: a blunt, repeated, imperative
        // block, because a passive statement was demonstrably not enough to
        // stop the model inventing plausible-sounding content.
        systemBlocks.push(
          'LIVE NOTION: NOT CONNECTED. You have zero page or database data - none was fetched, ' +
          'none exists in this conversation. If asked about notes, pages, or anything in Notion, ' +
          'your entire answer must be that Notion is not connected yet and it can be connected ' +
          'from Systems -> Connectors -> Notion. Under no circumstances invent, guess, or name a ' +
          'page, note, or database - you have not seen any and must not pretend otherwise.',
        );
        break;
      }
      const items = await ultron.notion.search(8);
      const itemLines = items.length
        ? items.map((i) => `${i.type === 'database' ? 'Database' : 'Page'}: ${i.title} - last edited ${i.lastEditedTime}`).join('\n')
        : '(nothing shared with this integration yet)';
      systemBlocks.push(
        `LIVE NOTION - real data just fetched, this is the complete list, nothing else exists:\n\n` +
        `${itemLines}\n\n` +
        'Only reference pages/databases that appear above. Do not add, embellish, or invent any not listed here. ' +
        'Note this only covers pages the operator has explicitly shared with the integration - absence from this ' +
        'list does not mean the page does not exist in their Notion, only that it has not been shared yet.',
      );
      break;
    }
    default:
      break;
  }

  const messages: ChatMessage[] = [
    { role: 'system', content: systemBlocks.join('\n\n') },
    ...historyMessages(),
  ];

  try {
    let sawFirstToken = false;
    const full = await getAIResponse(messages, {
      requestId,
      onToken: (token) => {
        if (!sawFirstToken) { sawFirstToken = true; }
        appendToEntry(replyId, token);
      },
    });
    activeRequestId = null;
    setBusy(false);
    finishEntry(replyId, sources.length ? { sources } : undefined);

    const reply = full.trim();
    if (!reply) { setCoreState('idle'); return; }

    if (opts.speakReply === false) { setCoreState('idle'); return; }

    setCoreState('speaking');
    const voice = useStore.getState().settings?.voice;
    // Web Speech's onend/onerror are documented to sometimes never fire (focus
    // changes, sleep/wake). Without a watchdog that leaves coreState stuck on
    // 'speaking' - [ESC] shown - with no sound and no way out but a manual cancel.
    const speakWatchdog = setTimeout(() => {
      if (useStore.getState().coreState === 'speaking') setCoreState('idle');
    }, Math.max(8000, reply.length * 90));
    speak(reply, {
      voiceName: voice?.name,
      rate: voice?.rate,
      pitch: voice?.pitch,
      onEnd: () => {
        clearTimeout(speakWatchdog);
        if (useStore.getState().coreState === 'speaking') setCoreState('idle');
      },
      onError: () => { clearTimeout(speakWatchdog); setCoreState('idle'); },
    });
  } catch (e) {
    activeRequestId = null;
    setBusy(false);
    const message = e instanceof Error ? e.message : String(e);
    // A cancellation is user-initiated, not a failure - cancelCurrent() already
    // reset coreState, so just drop the half-written entry quietly.
    if (message === 'cancelled') {
      finishEntry(replyId, { text: '(cancelled)' });
      return;
    }
    finishEntry(replyId, { error: true, text: `[failed] ${message}` });
    setCoreState('idle');
    void ultron.ollama.status().then(useStore.getState().setOllama);
  }
}
/* ── Push to talk (local Whisper) ───────────────────────────────────────
   Web Speech recognition is a Google-hosted service that Electron builds
   cannot reach, so speech-to-text runs locally instead: record the clip,
   resample it, and transcribe it with Whisper in a worker. Free, offline
   after the first model download, and it actually works here.            */

let pttActive = false;
let modelWarned = false;

export const isPushToTalkActive = () => pttActive;

/** Optional warm-up so the first real utterance is not stuck behind a download. */
export function preloadSpeechModel(): void {
  void ensureModel().catch(() => {
    /* status is reported through the stt store */
  });
}

export async function beginPushToTalk(): Promise<void> {
  if (pttActive || activeRequestId) return;
  const store = useStore.getState();

  pttActive = true;
  stopSpeaking();

  const mic = await startMic();
  if (!mic.ok) {
    pttActive = false;
    store.pushEntry({ who: 'system', text: `Microphone unavailable: ${mic.error}`, error: true });
    return;
  }

  const stream = getStream();
  if (!stream || !startRecording(stream)) {
    pttActive = false;
    stopMic();
    store.pushEntry({ who: 'system', text: 'Could not start the recorder on this machine.', error: true });
    return;
  }

  // Begin fetching the model now if it is not resident yet.
  const sttState = useSttStore.getState();
  if (sttState.stt === 'unknown') {
    if (!modelWarned) {
      modelWarned = true;
      store.pushEntry({
        who: 'system',
        text: 'Loading the local Whisper model on first use. This downloads once, then runs offline.',
      });
    }
    preloadSpeechModel();
  }

  store.setCoreState('listening');
}

export function endPushToTalk(): void {
  if (!pttActive) return;
  pttActive = false;
  void finishPushToTalk();
}

async function finishPushToTalk(): Promise<void> {
  const store = useStore.getState();
  let audio: Float32Array | null = null;
  try {
    audio = await stopRecording();
  } catch {
    audio = null;
  }
  stopMic();

  if (!audio) {
    if (store.coreState === 'listening') store.setCoreState('idle');
    return;
  }

  store.setCoreState('thinking');
  useSttStore.getState().setStt('transcribing');

  try {
    const text = (await transcribe(audio)).trim();
    useSttStore.getState().setStt('ok');

    // Whisper emits these for silence or noise - not worth sending to the brain.
    const noise = /^[\s.,!?-]*(\[[^\]]*\]|\([^)]*\))?[\s.,!?-]*$/i;
    if (!text || noise.test(text)) {
      store.setCoreState('idle');
      return;
    }
    await submitMessage(text);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    useSttStore.getState().setStt('unavailable', message);
    store.pushEntry({ who: 'system', text: `Transcription failed: ${message}`, error: true });
    store.setCoreState('idle');
  }
}
