import { AsyncLocalStorage } from 'node:async_hooks';
import type { Settings } from '../store';
import type { Provider } from './types';

/*
 * The privacy wall. Agents search the web, and the departments hold sleep, food, injuries
 * and grades - so who the operator is never goes out in a search, a page address or a
 * browser-agent task. Checked here, in code, on every outgoing call (team.ts runTool),
 * not just asked for in a prompt. And private work only goes to AI services that neither
 * keep nor train on what they're sent - or to the local model, which sends nothing anywhere.
 */

/** Name parts that are also ordinary words - removing them would break normal searches ("max heart rate"). */
const COMMON_WORDS = new Set([
  'max', 'will', 'mark', 'grace', 'hope', 'joy', 'rose', 'may', 'june', 'april', 'art', 'bill', 'frank', 'pat', 'sky',
  'sage', 'river', 'faith', 'ray', 'rich', 'chase', 'hunter', 'mason', 'page', 'ivy', 'jack', 'drew', 'dean', 'cole',
  'lane', 'reed', 'wade', 'grant', 'miles', 'chance', 'summer', 'autumn', 'dawn', 'eve', 'king', 'young', 'brown',
  'green', 'white', 'black', 'gray', 'grey', 'long', 'short', 'small', 'little', 'baker', 'cook', 'smith', 'turner',
  'hall', 'wood', 'woods', 'hill', 'stone', 'park', 'field', 'banks', 'rivers', 'bell', 'price', 'fox', 'wolf',
  'the', 'and', 'van', 'von', 'der', 'del', 'de', 'la', 'le',
]);

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** A whole-word match for a name or term, possessive included ("Shae's"). Any case, unless told otherwise. */
function phrase(term: string, exactCase = false): RegExp {
  const body = term.trim().split(/\s+/).map(escape).join('\\s+');
  const start = /^\w/.test(term.trim()) ? '\\b' : '';
  const end = /\w$/.test(term.trim()) ? "(?:['’]s)?\\b" : '';
  return new RegExp(`${start}${body}${end}`, exactCase ? 'g' : 'gi');
}

function has(text: string, re: RegExp): boolean {
  re.lastIndex = 0;
  const hit = re.test(text);
  re.lastIndex = 0;
  return hit;
}

/** What identifies the operator: their name (and each distinctive part of it) plus the terms they registered. */
export function identityOf(s: Pick<Settings, 'profile'> & { privacy?: Partial<Settings['privacy']> }): RegExp[] {
  const out: string[] = [];
  const name = (s.profile?.name ?? '').trim();
  if (name) {
    out.push(name);
    for (const part of name.split(/\s+/)) if (part.length >= 3 && !COMMON_WORDS.has(part.toLowerCase())) out.push(part);
  }
  for (const t of s.privacy?.terms ?? []) if (typeof t === 'string' && t.trim().length >= 2) out.push(t.trim());
  // Longest first, so a full name or an email goes before the first name inside it. A one-word name that is
  // also an everyday word ("Max") only counts written as a name - "max heart rate" is a normal search.
  return [...new Set(out)]
    .sort((a, b) => b.length - a.length)
    .map((t) => phrase(t, !/\s/.test(t) && COMMON_WORDS.has(t.toLowerCase())));
}

const EMAIL = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g;

/** Takes the operator's identity out of a piece of text. */
export function scrub(text: string, ids: RegExp[]): { text: string; removed: number } {
  let removed = 0;
  // An email address with the operator's name in it goes whole - not just the name, leaving "@gmail.com" behind.
  let out = text.replace(EMAIL, (m) => (ids.some((re) => has(m, re)) ? (removed++, ' ') : m));
  for (const re of ids) out = out.replace(re, () => { removed++; return ' '; });
  if (removed) {
    out = out
      .replace(/\s{2,}/g, ' ')
      .replace(/\s+([,.?!;:])/g, '$1')
      .replace(/^[\s,.;:'’"-]+|[\s,;:'’"-]+$/g, '')
      .trim();
  }
  return { text: out, removed };
}

/** True when an address carries the operator's identity in what it sends (its query or fragment). */
function urlLeaks(url: string, ids: RegExp[]): boolean {
  let tail: string;
  try {
    const u = new URL(url);
    tail = `${u.search} ${u.hash}`;
  } catch {
    const q = url.indexOf('?');
    tail = q >= 0 ? url.slice(q) : '';
  }
  let decoded = tail.replace(/\+/g, ' ');
  try { decoded = decodeURIComponent(decoded); } catch { /* keep it as it is */ }
  return ids.some((re) => has(decoded, re));
}

/* What each outgoing tool sends out: words (searched for, or handed to a browser agent) and addresses. */
const TEXT_ARGS: Record<string, string[]> = {
  google_search: ['question'],
  web_search: ['query'],
  deep_research: ['question'],
  youtube_search: ['query'],
  play_on_youtube: ['query'],
  encyclopedia_lookup: ['query'],
  ask_wolfram: ['query'],
  browser_agent: ['task'],
  youtube_transcript: ['video'],
  // Its task goes to the model service it runs on (DeepSeek or OpenRouter).
  deepseek_harness: ['task'],
};
const URL_ARGS: Record<string, string[]> = {
  read_webpage: ['url'],
  // Reads any link (12 Oct 2026) - an address carrying his identity is stopped like any other.
  read_link: ['url'],
  browser_open: ['url'],
  read_feed: ['url'],
  browser_agent: ['start_url'],
  youtube_transcript: ['video'],
};

export const OUTBOUND_TOOLS = new Set([...Object.keys(TEXT_ARGS), ...Object.keys(URL_ARGS)]);
/** Every argument the wall checks, per tool (a test holds these to the tools' real parameters). */
export const OUTBOUND_ARGS: Record<string, string[]> = Object.fromEntries(
  [...OUTBOUND_TOOLS].map((t) => [t, [...new Set([...(TEXT_ARGS[t] ?? []), ...(URL_ARGS[t] ?? [])])]]),
);

const isUrl = (v: string) => /^https?:\/\//i.test(v.trim());

export type Guarded =
  | { ok: true; args: Record<string, unknown>; removed: number }
  | { ok: false; error: string };

/**
 * Checks one outgoing call. Words: the operator's identity is taken out, and a search that
 * was only about them is stopped. Addresses: one that would send their identity is stopped
 * (a page's own path is fine - it's the query that gets sent and logged).
 */
export function guardOutbound(tool: string, args: Record<string, unknown>, ids: RegExp[]): Guarded {
  if (!ids.length || !OUTBOUND_TOOLS.has(tool)) return { ok: true, args, removed: 0 };
  for (const key of URL_ARGS[tool] ?? []) {
    const v = args[key];
    if (typeof v === 'string' && isUrl(v) && urlLeaks(v, ids)) {
      return { ok: false, error: 'Privacy wall: that address would send the operator\'s name or personal details to the site. Use an address without them - their own data comes from their connected apps and memory, not the web.' };
    }
  }
  let next = args;
  let removed = 0;
  for (const key of TEXT_ARGS[tool] ?? []) {
    const v = args[key];
    if (typeof v !== 'string' || isUrl(v)) continue;
    const r = scrub(v, ids);
    if (!r.removed) continue;
    if (!/[\p{L}\p{N}]{2,}/u.test(r.text)) {
      return { ok: false, error: 'Privacy wall: that search was about the operator themselves, and personal details never go into a web search. Their own data comes from their connected apps and memory.' };
    }
    next = { ...next, [key]: r.text };
    removed += r.removed;
  }
  return { ok: true, args: next, removed };
}

/* ── Which AI services may see private data ─────────────────────────── */

/** The free services trusted with private data (the local model always is). */
export function trustedClouds(s: { privacy?: Partial<Settings['privacy']> }): Set<string> {
  return new Set(s.privacy?.trusted ?? []);
}

/** May this provider (and, for 'cloud', this service) see a private request? */
export function trustedFor(p: Provider, s: { privacy?: Partial<Settings['privacy']> }, cloudId?: string): boolean {
  if (p === 'ollama') return true;
  const t = trustedClouds(s);
  if (p === 'gemini') return t.has('gemini');
  return cloudId ? t.has(cloudId) : false;
}

export const NO_PRIVATE_BRAIN =
  'Private data (health, grades, injuries) only goes to the local model or to a service trusted not to keep it, and none of them is available right now. Start the local model (Ollama), or mark a service as trusted with private data in Settings.';

/* ── Data stays in its lane ─────────────────────────────────────────── */

/**
 * Notes that hold private data: health logs, injuries, sleep, food, grades, teacher feedback,
 * what he watches and plays, Helios's intel about all of it - and the HQ areas that hold the
 * same. Web-facing agents (Argus, Daedalus, Helios) don't get these in their context, and
 * they only ever reach a brain trusted with private data.
 */
const PRIVATE_PATHS = [
  /^(Health|School|Media|Brains|Intel)\//i,
  /^(Journal|Team Runs)\/Private\//i,
  /^Memory\/(Health|School)\//i,
  /^HQ\/(health-fitness|school|finances|personal)\//i,
];

export function isPrivateRel(rel: string): boolean {
  const r = rel.replace(/\\/g, '/');
  return PRIVATE_PATHS.some((re) => re.test(r));
}

/** Agents that work on the open web - they never get private notes unless the task itself needs them. */
export const WEB_FACING = new Set(['argus', 'daedalus', 'helios']);

/*
 * A request that touched private data stays private to the end: every model call made while
 * it runs (the lead, the planner, the specialists, a tool that summarises with a model) goes
 * only to a trusted brain. A box, so the run can mark itself private once it knows.
 */
const scope = new AsyncLocalStorage<{ private: boolean }>();

/** Runs fn in its own privacy scope - starts not private. */
export function withPrivacyScope<T>(fn: () => Promise<T>): Promise<T> {
  return scope.run({ private: false }, fn);
}

/** From here to the end of this request, every model call is private. */
export function markPrivate(): void {
  const box = scope.getStore();
  if (box) box.private = true;
}

/** True inside a request that has been marked private. */
export function inPrivateScope(): boolean {
  return scope.getStore()?.private === true;
}
