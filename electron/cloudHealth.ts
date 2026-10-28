import { readDoc, writeDoc } from './store';

/**
 * What Ultron has learned the hard way about the free AI services, kept on
 * disk so it is not re-learned on every launch.
 *
 * Why this exists: NVIDIA's /models list includes models it will not actually
 * serve, so the best-ranked name 404s. That was discovered fresh every single
 * start-up - a wasted round trip before hopping to one that works, and a
 * real failure if the 404 landed mid-answer. The same went for a service out
 * of its free credits: asked again on every check, and reported as broken.
 *
 * Nothing secret goes in here - only service ids, model names and times.
 */

export interface CloudHealth {
  /** service id -> the model that last really answered. Tried first. */
  good: Record<string, string>;
  /** "id:model" the service lists but will not serve (404/410). */
  dead: string[];
  /** "id:model" -> when its used-up allowance comes back. */
  rest: Record<string, number>;
  /** service id -> when a whole service's free credits are worth trying again. */
  credits: Record<string, number>;
  /**
   * service id -> the last verdict and the service's own words for it. Kept so a
   * "key refused" can be checked against what was actually said, not guessed at.
   */
  verdict: Record<string, Verdict>;
}

export interface Verdict {
  state: 'ready' | 'refused' | 'noCredits' | 'resting' | 'unreachable';
  model?: string;
  reason?: string;
  at: number;
}

const FILE = 'cloud-health.json';

/** A service out of free credits is re-tried this often, so it heals itself. */
export const CREDITS_RETRY_MS = 6 * 3600_000;

const fresh = (): CloudHealth => ({ good: {}, dead: [], rest: {}, credits: {}, verdict: {} });

let cache: CloudHealth | null = null;

export function health(): CloudHealth {
  if (!cache) {
    const raw = readDoc<Partial<CloudHealth>>(FILE, {});
    cache = {
      good: raw.good && typeof raw.good === 'object' ? { ...raw.good } : {},
      dead: Array.isArray(raw.dead) ? [...raw.dead] : [],
      rest: raw.rest && typeof raw.rest === 'object' ? { ...raw.rest } : {},
      credits: raw.credits && typeof raw.credits === 'object' ? { ...raw.credits } : {},
      verdict: raw.verdict && typeof raw.verdict === 'object' ? { ...raw.verdict } : {},
    };
    prune(cache);
  }
  return cache;
}

/** Drops anything whose time has passed, so the file cannot grow without end. */
export function prune(h: CloudHealth): void {
  const now = Date.now();
  for (const [k, until] of Object.entries(h.rest)) if (!(until > now)) delete h.rest[k];
  for (const [k, until] of Object.entries(h.credits)) if (!(until > now)) delete h.credits[k];
  // A dead model can come back when a service re-deploys it, so this is not kept forever
  // either - the newest entries are the ones that matter.
  if (h.dead.length > 200) h.dead = h.dead.slice(-200);
}

export function saveHealth(): void {
  if (!cache) return;
  prune(cache);
  try {
    writeDoc(FILE, cache);
  } catch {
    // Losing this only costs one extra probe next launch - never worth failing a call over.
  }
}

/** Tests. */
export function resetHealth(): void {
  cache = fresh();
}
