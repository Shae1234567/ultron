import { getSecret, hasSecret, setCustomSecret, type CustomSecret, type SecretName } from './secrets';
import { getSettings, saveSettings } from './store';
import { CREDITS_RETRY_MS, health, resetHealth, saveHealth, type Verdict } from './cloudHealth';
import { LlmError } from './brain/types';
import { keyHint, wrongBox } from './keyShapes';

/**
 * The free AI services Ultron can borrow a bigger brain from. They all speak
 * the OpenAI Chat Completions API, so one client (providers/openaiCompat.ts)
 * covers every one of them - only the address, the key and the model differ.
 *
 * Model names change constantly, so nothing here hard-codes one: each service
 * is asked for its own list and the best chat model is picked by name. A
 * service whose address or key is wrong simply reports itself unavailable,
 * and Ultron moves to the next.
 *
 * One account per service. Ultron never signs up, and never holds two
 * accounts at one service to get more free quota - that breaks their terms.
 */

export interface CloudDef {
  id: string;
  label: string;
  secret: SecretName | CustomSecret;
  /** Where its model list is, when it isn't `<baseUrl>/models` (GitHub Models keeps it elsewhere). */
  modelsUrl?: string;
  /** A model to use when the service has no model list Ultron can read. */
  model?: string;
  /** Added by the operator, not built in - it can be removed. */
  custom?: boolean;
  baseUrl: string;
  /** Where the operator gets a key. */
  signup: string;
  /** What the free tier gives, in plain words. */
  free: string;
  /** Models to reach for first when the service lists them - the cheaper one on a paid service. */
  prefer?: string[];
  /** Works with no key at all (an anonymous free tier); a key, if pasted, only raises its limits. */
  noKey?: boolean;
  /** Its model list mixes free and paid models: only the free ones are used. */
  freeOnly?: boolean;
}

export const CLOUDS: CloudDef[] = [
  {
    id: 'groq', label: 'Groq', secret: 'GROQ_API_KEY', baseUrl: 'https://api.groq.com/openai/v1',
    signup: 'https://console.groq.com/keys',
    free: 'Free: big open models (Llama, Qwen), very fast, generous daily limit.',
  },
  {
    id: 'openrouter', label: 'OpenRouter', secret: 'OPENROUTER_API_KEY', baseUrl: 'https://openrouter.ai/api/v1',
    signup: 'https://openrouter.ai/keys',
    free: 'Free: a rotating set of models (DeepSeek and others), smaller daily cap.',
  },
  {
    id: 'nvidia', label: 'NVIDIA', secret: 'NVIDIA_API_KEY', baseUrl: 'https://integrate.api.nvidia.com/v1',
    signup: 'https://build.nvidia.com',
    free: 'Free, no card: 80+ big models (DeepSeek, Llama, Qwen, Nemotron). The most generous of these.',
  },
  {
    id: 'huggingface', label: 'Hugging Face', secret: 'HUGGINGFACE_API_KEY', baseUrl: 'https://router.huggingface.co/v1',
    // The pre-filled form: a plain token will NOT work here, it needs the
    // "Make calls to Inference Providers" permission, and this link ticks it.
    signup: 'https://huggingface.co/settings/tokens/new?ownUserPermissions=inference.serverless.write&tokenType=fineGrained',
    free: 'Free, no card: 130+ models (Qwen, DeepSeek, GLM) through one key, a few hundred requests an hour.',
  },
  {
    // Paid per use (V4.1 Flash: about $0.30 per million tokens in, $1.20 out - Oct 2026). It sits after the
    // free services by default; Settings can move it up. DeepSeek may keep and learn from what it is sent,
    // so it is never trusted with private data.
    id: 'deepseek', label: 'DeepSeek', secret: 'DEEPSEEK_API_KEY', baseUrl: 'https://api.deepseek.com/v1',
    signup: 'https://platform.deepseek.com/api_keys',
    free: 'Paid per use (cheap): DeepSeek V4.1 Flash and V4 Pro. Only used if you add a key and credit.',
    prefer: ['deepseek-flash', 'deepseek-chat'],
  },
  {
    id: 'openai', label: 'OpenAI', secret: 'OPENAI_API_KEY', baseUrl: 'https://api.openai.com/v1',
    signup: 'https://platform.openai.com/api-keys',
    free: 'Paid per use - no free tier. Only used if you add a key.',
  },
];

/*
 * Services the operator can add with one paste (10 Oct 2026). Free allowances from current third-party
 * round-ups - each is shown with its own sign-up page, where the real numbers are. Any other service that
 * speaks the OpenAI chat API can be added by its address too.
 */
export const PRESETS: Omit<CloudDef, 'secret' | 'custom'>[] = [
  { id: 'cerebras', label: 'Cerebras', baseUrl: 'https://api.cerebras.ai/v1', signup: 'https://cloud.cerebras.ai',
    free: 'Free: about 1M tokens a day, very fast (hundreds of tokens a second).' },
  { id: 'mistral', label: 'Mistral', baseUrl: 'https://api.mistral.ai/v1', signup: 'https://console.mistral.ai/api-keys',
    free: 'Free "Experiment" plan: a large monthly allowance, rate-limited. Needs a phone number to sign up.' },
  { id: 'sambanova', label: 'SambaNova', baseUrl: 'https://api.sambanova.ai/v1', signup: 'https://cloud.sambanova.ai/apis',
    free: 'Free: big open models, but only about 20 requests a day per model.' },
  { id: 'github', label: 'GitHub Models', baseUrl: 'https://models.github.ai/inference', modelsUrl: 'https://models.github.ai/catalog/models',
    model: 'openai/gpt-4.1-mini', signup: 'https://github.com/settings/personal-access-tokens/new',
    free: 'Free with a GitHub account: GPT, Llama, Phi and more, about 50-150 requests a day. The key is a GitHub token with the "Models" permission.' },
  // From github.com/mnfst/awesome-free-llm-apis (read 10 Oct 2026). The three with no key were each sent a real
  // request that day and answered. ModelScope and SiliconFlow are left out: both need Chinese real-name ID checks.
  { id: 'kilo', label: 'Kilo Code', baseUrl: 'https://api.kilo.ai/api/gateway', signup: 'https://app.kilo.ai/profile', noKey: true, freeOnly: true,
    prefer: ['nvidia/nemotron-3-super-120b-a12b:free', 'nvidia/nemotron-3-ultra-550b-a55b:free', 'stepfun/step-5-preview-free'],
    free: 'Free, NO key needed: a rotating pool of free models (Nemotron, StepFun and more), about 200 requests an hour. It may log prompts, so it never gets private data.' },
  { id: 'llm7', label: 'LLM7.io', baseUrl: 'https://api.llm7.io/v1', signup: 'https://token.llm7.io', noKey: true, freeOnly: true,
    prefer: ['DeepSeek-V4-Flash-0731', 'GLM-5.3-Flash', 'gpt-oss:20b'],
    free: 'Free, NO key needed for its "turbo" models (DeepSeek V4 Flash, GLM, gpt-oss); a free token from token.llm7.io raises the limits.' },
  { id: 'ovh', label: 'OVHcloud AI Endpoints', baseUrl: 'https://oai.endpoints.kepler.ai.cloud.ovh.net/v1', signup: 'https://www.ovhcloud.com/en/public-cloud/ai-endpoints/catalog/', noKey: true,
    prefer: ['gpt-oss-120b', 'Qwen3.5-397B-A17B', 'Qwen3.8-27B', 'Meta-Llama-3_3-70B-Instruct'],
    free: 'Free, NO key needed: 20+ open models hosted in the EU, but only 2 requests a minute per model - a useful backup.' },
  { id: 'zai', label: 'Z AI (GLM)', baseUrl: 'https://api.z.ai/api/paas/v4', signup: 'https://z.ai/manage-apikey/apikey-list', model: 'glm-4.7-flash',
    prefer: ['glm-4.7-flash', 'glm-4.5-flash'],
    free: 'Free GLM-4.7-Flash (a strong reasoning model), one request at a time. Needs a free account.' },
  { id: 'cohere', label: 'Cohere', baseUrl: 'https://api.cohere.ai/compatibility/v1', signup: 'https://dashboard.cohere.com/api-keys', model: 'command-a-03-2025',
    prefer: ['command-a-03-2025', 'command-r-plus-08-2024', 'command-r7b-12-2024'],
    free: 'Free "Trial" key: Command A and R models, about 1,000 calls a month, non-commercial use only. A Canadian company.' },
  { id: 'ollama-cloud', label: 'Ollama Cloud', baseUrl: 'https://ollama.com/v1', signup: 'https://ollama.com/settings/keys', model: 'gpt-oss:120b',
    prefer: ['gpt-oss:120b', 'qwen3.5:397b', 'deepseek-v4-flash'],
    free: 'Free tier with session and weekly limits: big cloud models (gpt-oss 120B, Qwen 3.5 397B, DeepSeek V4) - runs on Ollama\'s servers, not your GPU.' },
  { id: 'cloudflare', label: 'Cloudflare Workers AI', baseUrl: 'https://api.cloudflare.com/client/v4/accounts/{account_id}/ai/v1', signup: 'https://dash.cloudflare.com/profile/api-tokens',
    model: '@cf/meta/llama-3.3-70b-instruct-fp8-fast', prefer: ['@cf/openai/gpt-oss-120b', '@cf/meta/llama-3.3-70b-instruct-fp8-fast'],
    free: 'Free: 10,000 "neurons" a day across 60+ models. Needs your Cloudflare account ID as well as an API token (Workers AI permission).' },
  { id: 'aion', label: 'Aion Labs', baseUrl: 'https://api.aionlabs.ai/v1', signup: 'https://www.aionlabs.ai/app/api-keys/', model: 'aion-labs/aion-3.0-mini',
    free: 'Free: 20,000 tokens a day, 15 a minute - small, but made for storytelling (Calliope can use it).' },
];

export interface CustomCloud { id: string; label: string; baseUrl: string; model?: string; modelsUrl?: string; signup?: string; free?: string; noKey?: boolean; freeOnly?: boolean; prefer?: string[] }

const customSecret = (id: string) => `CUSTOM_${id.toUpperCase().replace(/[^A-Z0-9]/g, '_')}` as CustomSecret;

/** Every service: the built-in ones, then the ones the operator added. */
export function allClouds(): CloudDef[] {
  const added = (getSettings().customClouds ?? []).map((c): CloudDef => ({
    id: c.id, label: c.label, baseUrl: c.baseUrl, model: c.model, modelsUrl: c.modelsUrl,
    signup: c.signup ?? '', free: c.free ?? 'Added by you.', secret: customSecret(c.id), custom: true,
    noKey: c.noKey, freeOnly: c.freeOnly, prefer: c.prefer,
  }));
  return [...CLOUDS, ...added.filter((a) => !CLOUDS.some((b) => b.id === a.id))];
}

export function cloudDef(id: string): CloudDef | undefined {
  return allClouds().find((c) => c.id === id);
}

/** A short id from a name ("My Server" -> "my-server"). */
export const slugOf = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30);

/** Only real addresses: https anywhere, or http on this computer (a local server). */
export function validServiceUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' || (u.protocol === 'http:' && /^(localhost|127\.0\.0\.1|\[::1\])$/.test(u.hostname));
  } catch {
    return false;
  }
}

/** Adds a service (a preset, or any OpenAI-compatible address), saves its key, and tests it for real. */
export async function addCloud(input: { preset?: string; label?: string; baseUrl?: string; model?: string; key: string; accountId?: string }): Promise<{ ok: boolean; id?: string; detail?: string; error?: string }> {
  const preset = PRESETS.find((p) => p.id === input.preset);
  const label = (preset?.label ?? input.label ?? '').trim();
  let baseUrl = (preset?.baseUrl ?? input.baseUrl ?? '').trim().replace(/\/+$/, '').replace(/\/chat\/completions$/, '');
  // Cloudflare's address carries the account it bills to.
  if (baseUrl.includes('{account_id}')) {
    const acct = (input.accountId ?? '').trim();
    if (!/^[0-9a-f]{32}$/i.test(acct)) return { ok: false, error: 'Paste your Cloudflare account ID too (32 letters and numbers, on the Workers AI page of the dashboard).' };
    baseUrl = baseUrl.replace('{account_id}', acct);
  }
  if (!label) return { ok: false, error: 'Give the service a name.' };
  if (!validServiceUrl(baseUrl)) return { ok: false, error: 'The address must start with https:// (or http://localhost for a server on this PC).' };
  if (!input.key.trim() && !preset?.noKey) return { ok: false, error: 'Paste the key.' };
  const id = preset?.id ?? slugOf(label);
  if (!id) return { ok: false, error: 'Give the service a name with letters or numbers in it.' };
  if (CLOUDS.some((c) => c.id === id)) return { ok: false, error: `${label} is already built in - paste its key in its own row.` };
  const misplaced = input.key.trim() ? wrongBox(id, input.key) : null;
  if (misplaced) return { ok: false, error: misplaced };
  try {
    if (input.key.trim()) setCustomSecret(customSecret(id), input.key);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
  const entry: CustomCloud = {
    id, label, baseUrl, model: input.model?.trim() || preset?.model, modelsUrl: preset?.modelsUrl,
    signup: preset?.signup, free: preset?.free, noKey: preset?.noKey, freeOnly: preset?.freeOnly, prefer: preset?.prefer,
  };
  saveSettings({ customClouds: [...(getSettings().customClouds ?? []).filter((c) => c.id !== id), entry] });
  state.delete(id);
  const v = await verifyCloud(id);
  saveHealth();
  return v.ok
    ? { ok: true, id, detail: `${label} added - using ${v.model}.${v.error ? ` (${v.error})` : ''}` }
    : { ok: false, id, error: `${label} was added, but ${v.error ?? 'it did not answer.'} You can fix the key in its row, or remove it.` };
}

/** Removes a service the operator added, and its key. Built-in services can only be turned off. */
export function removeCloud(id: string): boolean {
  const def = cloudDef(id);
  if (!def?.custom) return false;
  setCustomSecret(def.secret as CustomSecret, null);
  saveSettings({ customClouds: (getSettings().customClouds ?? []).filter((c) => c.id !== id) });
  state.delete(id);
  return true;
}

/** Saves (or replaces) the key of any service, built in or added, and tests it. */
export async function setCloudKey(id: string, value: string): Promise<{ ok: boolean; detail?: string; error?: string }> {
  const def = cloudDef(id);
  if (!def) return { ok: false, error: 'Unknown service.' };
  if (!def.custom) return { ok: false, error: 'Built-in services save through their own key box.' };
  const misplaced = value.trim() ? wrongBox(id, value) : null;
  if (misplaced) return { ok: false, error: misplaced };
  try {
    setCustomSecret(def.secret as CustomSecret, value);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
  state.delete(id);
  const v = await verifyCloud(id);
  saveHealth();
  return v.ok ? { ok: true, detail: `${def.label} connected - using ${v.model}.` } : { ok: false, error: v.error ?? `${def.label} did not accept the key.` };
}

/* ------------------------------------------------------------ picking a model */

/**
 * Not chat models: embeddings, audio, images, safety classifiers, and reward
 * models (they score other models' answers and return a number, not a reply -
 * NVIDIA lists several right next to its chat models).
 */
const NOT_CHAT = /(embed|whisper|tts|audio|speech|moderation|guard|rerank|reward|dall-?e|stable-?diffusion|flux|sora|image|vision-only|bge|clip)/i;

/**
 * How good a model's NAME looks, without knowing the model. Families first,
 * then size, then version - so a list Ultron has never seen still sorts sensibly.
 */
const FAMILY = /(deepseek|qwen|llama|glm|gemma|mixtral|mistral|command|nemotron|minimax|kimi|phi|yi|gpt|claude|grok)/;

/** A model that reasons at length before it answers (slow to its first word). */
export function isSlowThinker(name: string): boolean {
  return /(^|[-/_ .])(r1|qwq|qvq)([-:_ .]|$)|thinking|reason(ing|er)|magistral/i.test(name);
}

export function rankModel(name: string): number {
  const n = name.toLowerCase();
  // Not a chat model at all - never usable, whatever else the name says.
  if (NOT_CHAT.test(n)) return -Infinity;
  let score = 0;
  // A known family, plus how new it is. Version-driven rather than a fixed list, so a
  // model released after this code was written still sorts sensibly: "deepseek-v4.1"
  // beats "deepseek-v3" without anyone updating a table here.
  const fam = FAMILY.exec(n);
  if (fam) {
    score += 20;
    const version = new RegExp(`${fam[1]}[-_ ]?v?(\\d+(?:\\.\\d+)?)`).exec(n);
    if (version) score += Math.min(Number(version[1]), 6) * 3;
  }
  // The current frontier names, on top of the family bonus.
  if (/\b(gpt-5|o3|o4|claude|opus|sonnet)\b/.test(n)) score += 15;
  // Size, when the name says it.
  const size = /(\d{2,3})\s*b\b/.exec(n);
  if (size) score += Math.min(Number(size[1]) / 4, 30);
  // "Instruct"/"chat" builds follow instructions; raw base models do not.
  if (/(instruct|chat|-it\b)/.test(n)) score += 8;
  // OpenRouter marks its free models; on a free plan those are the ones that work.
  if (/:free$/.test(n)) score += 25;
  // Small, fast, cheap variants are the fallback, not the first choice.
  if (/(mini|nano|tiny|small|1b|3b|7b|8b|lite|flash-?8b)/.test(n)) score -= 12;
  // 12 Oct 2026: models that think out loud before answering (R1, QwQ, "thinking" builds) can sit
  // a minute before the first word - fine for a hard proof, too slow for Ultron's everyday replies.
  if (isSlowThinker(n)) score -= 18;
  if (/(preview|experimental|alpha|beta)/.test(n)) score -= 5;
  return score;
}

/** The best chat models from a service's list, best first. A weak chat model still counts - it is a fallback. */
export function bestModels(names: string[], max = 6): string[] {
  return names
    .map((name) => ({ name, score: rankModel(name) }))
    .filter((m) => Number.isFinite(m.score))
    .sort((a, b) => b.score - a.score || a.name.length - b.name.length)
    .slice(0, max)
    .map((m) => m.name);
}

/* --------------------------------------------- what a refusal actually means */

/**
 * A failing call says one of five quite different things, and only ONE of them
 * is the operator's problem to fix. Conflating them is what made every service
 * read as "KEY REFUSED" when the keys were perfectly good.
 */
export type CloudFailure = 'refused' | 'noCredits' | 'rateLimited' | 'deadModel' | 'hiccup';

/**
 * "You have no remaining credits", "insufficient_quota" and friends. These
 * come back on a 402 but also on a 429, so the wording is checked as well as
 * the status - a key that is simply out of free allowance is NOT a bad key.
 */
const NO_CREDITS =
  /(no remaining credits|insufficient[_ ]?quota|insufficient credit|exceeded your current quota|purchase (pre-?paid )?credits|payment required|requires? (a )?(paid|pro)\b|add (a )?payment|billing)/i;

export function classifyFailure(status: number, body = ''): CloudFailure {
  // Order matters: only the service rejecting the key itself is "refused", and a
  // credits message outranks the generic rate limit it often arrives as.
  if (status === 401 || status === 403) return 'refused';
  if (status === 402 || NO_CREDITS.test(body)) return 'noCredits';
  if (status === 429) return 'rateLimited';
  if (status === 404 || status === 410) return 'deadModel';
  return 'hiccup';
}

/* ------------------------------------------------------------ live state */

export interface CloudState {
  id: string;
  label: string;
  /** A key is saved for it. */
  configured: boolean;
  /** The operator switched it off in Settings. */
  off: boolean;
  /** null = not checked yet. */
  valid: boolean | null;
  models: string[];
  model: string | null;
  error?: string;
  /** Set while its free daily allowance is used up. */
  restingUntil?: number;
  /**
   * The key is fine but the free credits behind it are spent. Separate from
   * `valid: false` on purpose: there is no new key to paste, so this must never
   * be shown as something the operator has to fix.
   */
  outOfCredits?: number;
  checkedAt?: number;
}

const state = new Map<string, CloudState>();

/** A service is usable when it has a key - or needs none. */
export const hasKey = (def: Pick<CloudDef, 'noKey' | 'secret'>): boolean => Boolean(def.noKey) || hasSecret(def.secret);

/** The auth header, or none for a keyless service with no token pasted. */
function authFor(def: CloudDef): Record<string, string> {
  const k = getSecret(def.secret);
  return k ? { Authorization: `Bearer ${k}` } : {};
}

interface ModelEntry { id?: string; isFree?: boolean; tier?: string; pricing?: { prompt?: string | number; completion?: string | number } }

/** Free by the list's own say: flagged free, a free tier, a ":free" name, or priced at zero. Pure. */
export function isFreeModel(m: ModelEntry): boolean {
  const id = String(m.id ?? '');
  if (m.isFree === true || /[:/-]free$/i.test(id)) return true;
  if (m.tier && /^(turbo|free)$/i.test(m.tier)) return true;
  const p = m.pricing;
  return Boolean(p && Number(p.prompt) === 0 && Number(p.completion) === 0 && p.prompt !== undefined && p.completion !== undefined);
}

function base(def: CloudDef): CloudState {
  return { id: def.id, label: def.label, configured: hasKey(def), off: false, valid: null, models: [], model: null };
}

function get(def: CloudDef): CloudState {
  let s = state.get(def.id);
  if (!s) state.set(def.id, (s = base(def)));
  s.configured = hasKey(def);
  s.off = getSettings().clouds?.[def.id]?.off === true;
  // Spent credits are remembered on disk, so this survives a restart and expires by itself.
  const until = health().credits[def.id];
  s.outOfCredits = until && until > Date.now() ? until : undefined;
  return s;
}

/** Asks a service which models it has. Cached for 6 hours. */
export async function refreshCloud(id: string, force = false): Promise<CloudState> {
  const def = cloudDef(id);
  if (!def) throw new Error(`Unknown service ${id}`);
  const s = get(def);
  if (!s.configured) {
    s.valid = null;
    s.models = [];
    s.model = null;
    s.error = undefined;
    return s;
  }
  if (!force && s.checkedAt && Date.now() - s.checkedAt < 6 * 3600_000) return s;
  const url = def.modelsUrl ?? `${(getSettings().clouds?.[id]?.baseUrl || def.baseUrl).replace(/\/$/, '')}/models`;
  try {
    const res = await fetch(url, { headers: authFor(def), signal: AbortSignal.timeout(20_000) });
    // No model list at this address (some services only serve chat): its known model is enough.
    if (res.status === 404 && def.model) {
      s.models = [def.model];
      s.valid = s.valid === false ? null : s.valid;
      s.error = undefined;
      s.checkedAt = Date.now();
      s.model = chosenModel(id);
      return s;
    }
    if (!res.ok) {
      // ONLY the service actually rejecting the key means the key is wrong. Everything else -
      // a blip, a rate limit, spent credits - leaves the verdict alone, so a good key is never
      // branded "refused" and left that way.
      const why = classifyFailure(res.status, await res.text().catch(() => ''));
      if (why === 'refused') {
        s.valid = false;
        s.error = 'The key was rejected.';
      } else if (why === 'noCredits') {
        restService(id, Date.now() + CREDITS_RETRY_MS);
        s.error = `${def.label}'s free credits are used up for now. Nothing to fix - Ultron will try it again later.`;
      } else {
        s.error = `Could not check just now - ${def.label} answered ${res.status}.`;
      }
      s.checkedAt = Date.now();
      return s;
    }
    // Most services answer { data: [...] }; GitHub's catalog is a plain list.
    const body = await res.json() as { data?: ModelEntry[] } | ModelEntry[];
    const all = Array.isArray(body) ? body : body.data ?? [];
    // A list that mixes free and paid models: only the free ones (calling a paid one would fail).
    const list = def.freeOnly ? all.filter(isFreeModel) : all;
    const names = list.map((m) => String(m.id ?? '')).filter(Boolean);
    if (!names.length && def.model) names.push(def.model);
    if (names.length) {
      s.models = names;
      s.valid = true;
      s.error = undefined;
    } else {
      // Answered, but with nothing usable. That is not a bad key either.
      s.error = `${def.label} listed no models just now.`;
    }
  } catch (e) {
    s.error = e instanceof Error ? e.message : String(e);
  }
  s.checkedAt = Date.now();
  s.model = chosenModel(id);
  return s;
}

/**
 * The model this service should use: the operator's pick, then whatever last
 * really answered, then the best on offer.
 *
 * Remembering the one that worked is the whole point - NVIDIA ranks a model
 * first that it will not serve, so without this every session opened by
 * spending a call on a 404.
 */
export function chosenModel(id: string): string | null {
  const s = state.get(id);
  if (!s) return null;
  const h = health();
  const picked = getSettings().clouds?.[id]?.model?.trim();
  const ok = (m: string | undefined): m is string =>
    Boolean(m) && !h.dead.includes(`${id}:${m}`) && (h.rest[`${id}:${m}`] ?? 0) <= Date.now();
  if (picked && ok(picked)) return picked;
  // Only if the service still lists it - or has not been asked yet this launch.
  const proven = h.good[id];
  // A remembered model that thinks at length before answering gives way to a quick one on the same service.
  const quicker = proven && isSlowThinker(proven) && bestModels(s.models).some((m) => ok(m) && !isSlowThinker(m));
  if (ok(proven) && !quicker && (!s.models.length || s.models.includes(proven))) return proven;
  // A paid service starts on its cheaper model; the ranking would pick the biggest.
  const prefer = cloudDef(id)?.prefer?.find((m) => s.models.includes(m) && ok(m));
  if (prefer) return prefer;
  return bestModels(s.models).find(ok) ?? null;
}

/** The models worth racing: the one Ultron would pick, then the next best that aren't dead or resting. */
export function raceCandidates(id: string, n: number): string[] {
  const s = state.get(id);
  const first = chosenModel(id);
  if (!s || !first) return [];
  const h = health();
  const ok = (m: string) => !h.dead.includes(`${id}:${m}`) && (h.rest[`${id}:${m}`] ?? 0) <= Date.now();
  return [...new Set([first, ...bestModels(s.models, 12)])].filter(ok).slice(0, n);
}

/** Records that this model really answered, so it is reached for first next time. */
export function rememberGood(id: string, model: string): void {
  const h = health();
  if (h.good[id] === model) return;
  h.good[id] = model;
  saveHealth();
}

/**
 * Models a service lists but will not actually serve. NVIDIA's catalogue
 * includes deprecated models (HTTP 410) and ones routed elsewhere (404), so
 * "it is in /models" is not a promise it works. Kept on disk, because
 * re-discovering it every launch cost a wasted call every time.
 */
export function retireModel(id: string, model: string): void {
  const h = health();
  const k = `${id}:${model}`;
  if (!h.dead.includes(k)) h.dead.push(k);
  if (h.good[id] === model) delete h.good[id];
  saveHealth();
}

export function isDead(id: string, model: string): boolean {
  return health().dead.includes(`${id}:${model}`);
}

/** Marks a model as out of free quota until the given time (its daily limit). */
export function restModel(id: string, model: string, untilMs: number): void {
  const h = health();
  h.rest[`${id}:${model}`] = untilMs;
  // A per-minute limit clears long before the next launch, so only a rest worth
  // remembering is written down - otherwise a busy minute means a disk write per call.
  if (untilMs - Date.now() > 5 * 60_000) saveHealth();
  const s = state.get(id);
  if (s && !bestModels(s.models).some((m) => (h.rest[`${id}:${m}`] ?? 0) <= Date.now())) s.restingUntil = untilMs;
}

/**
 * The key is good but the free credits behind it are spent. Kept usable and
 * re-tried on its own, so it comes back by itself when the allowance renews
 * and the operator never has to touch it.
 */
export function restService(id: string, untilMs: number): void {
  const h = health();
  h.credits[id] = untilMs;
  saveHealth();
  const s = state.get(id);
  if (s) {
    s.outOfCredits = untilMs;
    s.restingUntil = untilMs;
    s.valid = true;
  }
}

/** Services ready to answer right now, in the order they should be tried. */
export function readyClouds(): CloudState[] {
  const order = getSettings().clouds ?? {};
  const all = allClouds();
  return all
    .map((def) => get(def))
    // A service whose free credits are spent is skipped rather than tried and failed -
    // calling it only to be refused wasted a hop on every single request.
    .filter((s) => s.configured && !s.off && s.valid !== false && !s.outOfCredits && Boolean(chosenModel(s.id)))
    .sort((a, b) => (order[a.id]?.rank ?? all.findIndex((c) => c.id === a.id)) - (order[b.id]?.rank ?? all.findIndex((c) => c.id === b.id)));
}

export function anyCloudConfigured(): boolean {
  return allClouds().some((def) => hasKey(def));
}

/** Everything the Settings and System panels show about the services. */
export function cloudStatus(): (CloudState & { free: string; signup: string; secret: SecretName | CustomSecret; custom?: boolean; keyHint?: string })[] {
  return allClouds().map((def) => {
    const s = get(def);
    // A refused key, described by its shape alone (never its value): wrong box, cut short, or simply dead.
    const hint = s.configured && s.valid === false ? keyHint(def.id, getSecret(def.secret)) : undefined;
    return { ...s, model: chosenModel(def.id), free: def.free, signup: def.signup, secret: def.secret, custom: def.custom, keyHint: hint };
  });
}

/** Asks every service that has a key which models it has. */
export async function refreshAllClouds(force = false): Promise<void> {
  await Promise.all(allClouds().filter((d) => hasKey(d)).map((d) => refreshCloud(d.id, force).catch(() => undefined)));
}

/**
 * Proves every service with a key, with one real one-token call each.
 *
 * Listing models was not enough and that was the whole trouble: Hugging Face
 * serves its catalogue happily while refusing every actual call for want of
 * credits, so the panel said READY and the first real question failed. NVIDIA
 * lists models it will not serve, so the model shown was one that 404s. A
 * handful of one-token calls at start-up buys a panel that tells the truth.
 */
export async function proveAllClouds(): Promise<void> {
  const now = Date.now();
  const h = health();
  const worth = allClouds().filter((d) => {
    if (!hasKey(d) || getSettings().clouds?.[d.id]?.off === true) return false;
    // One that has already said it is out of credits does not need asking again this launch.
    // The watch picks it up once the window passes; asking now only wastes a call.
    if ((h.credits[d.id] ?? 0) > now) return false;
    return true;
  });
  await Promise.all(worth.map((d) => verifyCloud(d.id).catch(() => undefined)));
  saveHealth();
}

/** The address a service is called at - the operator may override it in Settings (for a local server). */
export function baseUrlOf(id: string): string {
  return (getSettings().clouds?.[id]?.baseUrl || cloudDef(id)?.baseUrl || '').replace(/\/$/, '');
}

export function keyOf(id: string): string {
  const def = cloudDef(id);
  return def ? getSecret(def.secret) : '';
}

export function markInvalid(id: string, message: string): void {
  const s = state.get(id);
  if (s) {
    s.valid = false;
    s.error = message;
  }
}

/* ─────────────────────────────── proving a key, honestly ── */

/** How long a model gets to start answering a check. A hung model is a model problem, not the key's. */
const PROBE_TIMEOUT_MS = 15_000;
/** And how long the whole check may take before Ultron says "couldn't tell yet" rather than guessing. */
const VERIFY_BUDGET_MS = 60_000;

export type ProbeKind = 'ok' | CloudFailure | 'timeout';

/**
 * What one chat call really said. Some services answer 200 and put the real
 * error inside the body ("Upstream error: Service temporarily overloaded"), so
 * a 200 alone is not a success - that is how an overloaded model once got
 * remembered as the good one.
 */
export async function probeModel(id: string, model: string): Promise<{ kind: ProbeKind; status: number; message: string }> {
  try {
    const res = await fetch(`${baseUrlOf(id)}/chat/completions`, {
      method: 'POST',
      headers: { ...(keyOf(id) ? { Authorization: `Bearer ${keyOf(id)}` } : {}), 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, messages: [{ role: 'user', content: 'hi' }], max_tokens: 1, stream: false }),
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    const text = await res.text().catch(() => '');
    let inner: { code?: unknown; message?: unknown } | undefined;
    try { inner = (JSON.parse(text) as { error?: { code?: unknown; message?: unknown } }).error ?? undefined; } catch { /* not JSON */ }
    const message = String(inner?.message ?? text).replace(/\s+/g, ' ').trim().slice(0, 200);
    if (res.ok && !inner) return { kind: 'ok', status: res.status, message: '' };
    const status = res.ok ? Number(inner?.code) || 500 : res.status;
    return { kind: classifyFailure(status, message), status, message };
  } catch (e) {
    const err = e instanceof Error ? e : new Error(String(e));
    const timedOut = err.name === 'TimeoutError' || err.name === 'AbortError' || /time ?out|aborted/i.test(err.message);
    return { kind: timedOut ? 'timeout' : 'hiccup', status: 0, message: timedOut ? 'no answer in time' : err.message };
  }
}

/**
 * Where a service will say whether the key itself is good, separate from any one model.
 * NVIDIA has no such endpoint (its model list is public), so it gets the two-model test instead.
 */
const KEY_CHECK: Record<string, string> = {
  openrouter: 'https://openrouter.ai/api/v1/key',
  groq: '/models',
  openai: '/models',
  huggingface: 'https://huggingface.co/api/whoami-v2',
  deepseek: 'https://api.deepseek.com/user/balance',
};

/** true = the service vouches for the key, false = it refuses it, null = can't tell this way. */
export async function keyCheck(id: string): Promise<boolean | null> {
  const where = KEY_CHECK[id];
  // Pointed at a local or other server: the public endpoint would be asking about the wrong thing.
  if (!where || (where.startsWith('http') && getSettings().clouds?.[id]?.baseUrl)) return null;
  try {
    const res = await fetch(where.startsWith('/') ? `${baseUrlOf(id)}${where}` : where, {
      headers: { Authorization: `Bearer ${keyOf(id)}` },
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    if (res.ok) return true;
    if (res.status === 401 || res.status === 403) return false;
    return null;
  } catch {
    return null;
  }
}

/**
 * A 401 or 403 from one model is not proof the key is bad: a model can be
 * closed to an account, region-locked, or turn one prompt away, while the key
 * works everywhere else. So before Ultron ever says "key refused" it asks the
 * service about the key itself, or tries a second model. Only a second refusal
 * counts.
 */
export async function confirmRefused(id: string, failedModel: string, firstWords: string): Promise<{ refused: boolean; reason: string; works?: string }> {
  const vouch = await keyCheck(id);
  if (vouch === true) return { refused: false, reason: `the key checks out; only ${failedModel} turned it away` };
  if (vouch === false) return { refused: true, reason: firstWords };
  const other = bestModels(state.get(id)?.models ?? []).find((m) => m !== failedModel && usableModel(id, m));
  if (!other) return { refused: false, reason: `only ${failedModel} turned it away, and there was no second model to ask` };
  const second = await probeModel(id, other);
  if (second.kind === 'refused') return { refused: true, reason: second.message || firstWords };
  return { refused: false, reason: `${other} took the same key`, works: second.kind === 'ok' ? other : undefined };
}

function usableModel(id: string, m: string): boolean {
  const h = health();
  return !h.dead.includes(`${id}:${m}`) && (h.rest[`${id}:${m}`] ?? 0) <= Date.now();
}

/** A model that stops answering is no longer the one to go to first. */
export function forgetGood(id: string, model: string): void {
  const h = health();
  if (h.good[id] !== model) return;
  delete h.good[id];
  saveHealth();
}

function setVerdict(id: string, state: Verdict['state'], model?: string, reason?: string): void {
  health().verdict[id] = { state, model, reason, at: Date.now() };
  saveHealth();
}

/**
 * Proves a key really works, by asking a model for one token - and keeps
 * asking down the list until one answers, because "this model is busy, gone
 * or hung" says nothing about the key.
 *
 * Listing models is NOT proof: NVIDIA and others serve their list to anyone,
 * so a mistyped key would otherwise read as connected.
 */
export async function verifyCloud(id: string): Promise<{ ok: boolean; model?: string; error?: string }> {
  const def = cloudDef(id);
  if (!def) return { ok: false, error: 'Unknown service.' };
  await refreshCloud(id, true);
  const s = get(def);
  if (s.valid === false) {
    // The model list itself turned the key away. Ask once more before believing it.
    const vouch = await keyCheck(id);
    if (vouch !== true) { setVerdict(id, 'refused', undefined, s.error); return { ok: false, error: s.error }; }
    s.valid = null;
    s.error = undefined;
  }
  const started = Date.now();
  const tried: string[] = [];
  let lastProblem = '', rested = false;

  // The race (10 Oct 2026): NVIDIA's remembered model started hanging, and asking models one at a time
  // spent 15 s on each hanger before reaching one that answers in under a second. Ask the top three at
  // once and keep the fastest that answers; whatever failed is set aside the same way as below.
  const contenders = raceCandidates(id, 3);
  if (contenders.length > 1) {
    const probes = contenders.map(async (model) => {
      const t0 = Date.now();
      const p = await probeModel(id, model);
      return { model, p, ms: Date.now() - t0 };
    });
    // The first good answer wins at once - a hanging model is not waited for (that was its whole cost).
    const finished: Awaited<(typeof probes)[number]>[] = [];
    const winner = await new Promise<Awaited<(typeof probes)[number]> | undefined>((resolve) => {
      let left = probes.length;
      for (const pr of probes) {
        void pr.then((r) => {
          finished.push(r);
          if (r.p.kind === 'ok') resolve(r);
          else if (--left === 0) resolve(undefined);
        });
      }
    });
    const settle = (results: Awaited<(typeof probes)[number]>[]) => { for (const r of results) {
      if (r === winner) continue;
      if (r.p.kind === 'ok') continue;
      if (r.p.kind === 'deadModel') { retireModel(id, r.model); tried.push(r.model); continue; }
      // A refusal only counts as the model's when another model proved the key works; otherwise the
      // careful path below asks the service about the key before deciding anything.
      if (r.p.kind === 'refused') {
        if (winner) { restModel(id, r.model, Date.now() + 24 * 3600_000); forgetGood(id, r.model); }
        continue;
      }
      if (r.p.kind === 'noCredits') continue;
      if (r.p.kind === 'rateLimited') rested = true;
      restModel(id, r.model, Date.now() + (r.p.kind === 'rateLimited' ? 10 : 20) * 60_000);
      forgetGood(id, r.model);
      tried.push(r.model);
      lastProblem = `${r.model}: ${r.p.kind === 'timeout' ? 'no answer in time' : r.p.message || `answered ${r.p.status}`}`;
    } };
    if (winner) {
      s.valid = true; s.error = undefined; s.outOfCredits = undefined; s.restingUntil = undefined;
      rememberGood(id, winner.model);
      setVerdict(id, 'ready', winner.model);
      // What has already answered is dealt with now; the slower ones when they finish - nobody waits for them.
      const now = [...finished];
      settle(now);
      void Promise.all(probes).then((rs) => { settle(rs.filter((r) => !now.includes(r))); saveHealth(); });
      return { ok: true, model: winner.model };
    }
    settle(await Promise.all(probes));
  }

  while (Date.now() - started < VERIFY_BUDGET_MS && tried.length < 8) {
    const model = chosenModel(id);
    if (!model || tried.includes(model)) break;
    tried.push(model);
    const p = await probeModel(id, model);
    if (p.kind === 'ok') {
      s.valid = true; s.error = undefined; s.outOfCredits = undefined; s.restingUntil = undefined;
      rememberGood(id, model);
      setVerdict(id, 'ready', model);
      return { ok: true, model };
    }
    if (p.kind === 'deadModel') { retireModel(id, model); continue; }
    if (p.kind === 'noCredits') {
      restService(id, Date.now() + CREDITS_RETRY_MS);
      setVerdict(id, 'noCredits', model, p.message);
      return { ok: true, model, error: `The key works, but ${def.label}'s free credits are used up. Nothing to fix - Ultron checks again later and uses the others meanwhile.` };
    }
    if (p.kind === 'refused') {
      const c = await confirmRefused(id, model, p.message);
      if (c.refused) {
        const why = `${def.label} refused the key${c.reason ? `: "${c.reason}"` : '.'}`;
        markInvalid(id, why);
        setVerdict(id, 'refused', model, c.reason);
        return { ok: false, error: why };
      }
      // That one model is closed to this key. The key is fine: set the model aside for a day.
      restModel(id, model, Date.now() + 24 * 3600_000);
      forgetGood(id, model);
      if (c.works) {
        s.valid = true; s.error = undefined;
        rememberGood(id, c.works);
        setVerdict(id, 'ready', c.works, c.reason);
        return { ok: true, model: c.works };
      }
      lastProblem = `${model} turned it away`;
      continue;
    }
    // Busy, rate-limited, hung or a blip: this model sits out a while and the next one is asked.
    if (p.kind === 'rateLimited') rested = true;
    restModel(id, model, Date.now() + (p.kind === 'rateLimited' ? 10 : 20) * 60_000);
    forgetGood(id, model);
    lastProblem = `${model}: ${p.kind === 'timeout' ? 'no answer in time' : p.message || `answered ${p.status}`}`;
  }
  // Nothing answered right now - but nothing refused the key either, so the verdict stays open.
  const why = rested
    ? `The key works; ${def.label}'s free models are busy right now. Ultron keeps checking.`
    : `Couldn't get an answer from ${def.label} just now (${lastProblem || 'no models to try'}). Nothing points at the key; Ultron keeps checking.`;
  if (rested) s.valid = true;
  s.error = why;
  setVerdict(id, rested ? 'resting' : 'unreachable', undefined, lastProblem);
  return { ok: rested, error: why };
}

/**
 * Re-checks the services that might have recovered, so a used-up allowance or a
 * bad moment heals on its own. Without this, a service knocked out at 9am stayed
 * knocked out until Ultron was restarted or a button was pressed by hand.
 */
export async function recheckRecoverable(): Promise<void> {
  const now = Date.now();
  const due = allClouds().filter((def) => {
    const s = state.get(def.id);
    if (!hasKey(def) || getSettings().clouds?.[def.id]?.off === true) return false;
    if (!s) return true;
    // A key the service itself refused is re-checked too, just far less often: the operator
    // may have fixed it at the service's own site, and then it should come back by itself.
    if (s.valid === false) return !s.checkedAt || now - s.checkedAt > 6 * 3600_000;
    if (s.outOfCredits) return s.outOfCredits <= now;
    if (s.restingUntil && s.restingUntil > now) return false;
    return Boolean(s.error) || !s.checkedAt || now - s.checkedAt > 6 * 3600_000;
  });
  for (const def of due) {
    const s = state.get(def.id);
    if (s?.valid === false || s?.outOfCredits) { s.valid = null; s.outOfCredits = undefined; s.restingUntil = undefined; delete health().credits[def.id]; }
    await verifyCloud(def.id).catch(() => undefined);
  }
  if (due.length) saveHealth();
}

let watchTimer: ReturnType<typeof setInterval> | null = null;

/** Every half hour, quietly - so the operator never has to press anything. */
export function startCloudWatch(): void {
  if (watchTimer) return;
  watchTimer = setInterval(() => { void recheckRecoverable().catch(() => undefined); }, 30 * 60_000);
  watchTimer.unref?.();
}

export function stopCloudWatch(): void {
  if (watchTimer) clearInterval(watchTimer);
  watchTimer = null;
}

/** Tests only. */
export function resetClouds(): void {
  state.clear();
  resetHealth();
}

export { LlmError };
export { CREDITS_RETRY_MS };
