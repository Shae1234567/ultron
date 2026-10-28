import type { CloudStatus } from '../types';

/**
 * What one free AI service's state means, in a single word.
 *
 * Pulled out of the panel so it can be tested on its own, because getting this
 * wrong is what made Ultron look broken: a service out of free credits and a
 * service whose key had been revoked were both drawn as a red "KEY REFUSED",
 * which is only true of the second - and only the second is worth doing
 * anything about.
 */
export type Standing = 'ready' | 'resting' | 'noCredits' | 'refused' | 'noKey' | 'off' | 'unchecked';

export function standingOf(s: CloudStatus, saved: boolean, now = Date.now()): Standing {
  if (!saved) return 'noKey';
  if (s.off) return 'off';
  // Only the service rejecting the key itself. Checked before the rest, since a refused
  // key is the one case with something for its owner to do.
  if (s.valid === false) return 'refused';
  if (s.outOfCredits && s.outOfCredits > now) return 'noCredits';
  if (s.restingUntil && s.restingUntil > now) return 'resting';
  if (s.valid !== true) return 'unchecked';
  return 'ready';
}

export const CHIP: Record<Standing, { cls: string; text: string }> = {
  ready: { cls: 'chip--good', text: 'READY' },
  resting: { cls: 'chip--muted', text: 'RESTING - COMES BACK ON ITS OWN' },
  noCredits: { cls: 'chip--muted', text: 'OUT OF FREE CREDITS - NOTHING TO FIX' },
  refused: { cls: 'chip--bad', text: 'KEY REFUSED' },
  noKey: { cls: 'chip--muted', text: 'NO KEY' },
  off: { cls: 'chip--muted', text: 'OFF' },
  unchecked: { cls: 'chip--muted', text: 'COULD NOT CHECK' },
};

/** Shown in the main list: whatever Ultron is working with, resting included. */
export const IN_USE: Standing[] = ['ready', 'resting', 'noCredits', 'unchecked'];

/** Tucked away: none of these is stopping Ultron. */
export const IDLE: Standing[] = ['noKey', 'refused', 'off'];
