import { describe, expect, it } from 'vitest';
import { CHIP, IDLE, IN_USE, standingOf, type Standing } from './cloudStanding';
import type { CloudStatus } from '../types';

const svc = (over: Partial<CloudStatus> = {}): CloudStatus => ({
  id: 'x', label: 'X', configured: true, off: false, valid: true, models: ['m'], model: 'm',
  free: '', signup: '', secret: 'GROQ_API_KEY', ...over,
});

const NOW = 1_700_000_000_000;

describe('what the panel says about one service', () => {
  it('says READY when it is working', () => {
    expect(standingOf(svc(), true, NOW)).toBe('ready');
  });

  it('does NOT call a key refused just because the free credits are spent', () => {
    // The real bug. Hugging Face answered 402 "no remaining credits" with a perfectly good
    // key, the panel drew KEY REFUSED, and the only apparent fix was pasting a key that
    // would have changed nothing.
    const s = svc({ valid: true, outOfCredits: NOW + 3600_000, restingUntil: NOW + 3600_000 });
    expect(standingOf(s, true, NOW)).toBe('noCredits');
    expect(CHIP.noCredits.text).toMatch(/NOTHING TO FIX/);
    expect(CHIP.noCredits.cls).not.toBe('chip--bad');
  });

  it('says KEY REFUSED only when the service really rejected the key', () => {
    expect(standingOf(svc({ valid: false }), true, NOW)).toBe('refused');
    expect(CHIP.refused.cls).toBe('chip--bad');
  });

  it('says NO KEY rather than refused when nothing has been pasted yet', () => {
    expect(standingOf(svc({ valid: null }), false, NOW)).toBe('noKey');
  });

  it('lets a credit window and a rest expire by themselves', () => {
    const past = { outOfCredits: NOW - 1, restingUntil: NOW - 1 };
    expect(standingOf(svc(past), true, NOW)).toBe('ready');
  });

  it('keeps "could not check" apart from a bad key, so a blip is never the owner\'s problem', () => {
    expect(standingOf(svc({ valid: null }), true, NOW)).toBe('unchecked');
    expect(CHIP.unchecked.cls).not.toBe('chip--bad');
  });

  it('respects the owner turning one off, over any state behind it', () => {
    expect(standingOf(svc({ off: true, valid: false }), true, NOW)).toBe('off');
  });

  it('prefers refused over resting, because that is the one with something to do', () => {
    expect(standingOf(svc({ valid: false, restingUntil: NOW + 1000 }), true, NOW)).toBe('refused');
  });
});

describe('which services the panel puts in front of him', () => {
  const all: Standing[] = ['ready', 'resting', 'noCredits', 'refused', 'noKey', 'off', 'unchecked'];

  it('covers every standing exactly once, so none can go missing from the panel', () => {
    for (const s of all) expect(CHIP[s], s).toBeTruthy();
    expect([...IN_USE, ...IDLE].sort()).toEqual([...all].sort());
    expect(IN_USE.filter((s) => IDLE.includes(s))).toEqual([]);
  });

  it('tucks away only the ones that are not holding Ultron back', () => {
    // Out of credits stays in the main list: it is temporary and it explains itself.
    expect(IN_USE).toContain('noCredits');
    expect(IDLE).toContain('refused');
    expect(IDLE).toContain('noKey');
  });
});
