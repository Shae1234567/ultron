import { describe, expect, it, vi } from 'vitest';

vi.mock('../../store', () => ({ readDoc: (_n: string, f: unknown) => f, writeDoc: () => {}, getSettings: () => ({ trackers: { pcActivity: true } }) }));

const { addUse, lastNight, sleepHint } = await import('./pcActivity');
const { greetingFacts } = await import('./routines');

const t = (iso: string) => new Date(iso).getTime();
const empty = { v: 1 as const, sleep: [], training: [], food: [], pain: [], checkins: [], usual: [], schedule: [], water: [], dayTypes: {} };

describe('sleep from PC use - a guess to confirm, never a log', () => {
  // Used the PC until 00:40, nothing overnight, back on at 07:05.
  let spans = addUse([], t('2026-10-08T21:00:00'));
  spans = addUse(spans, t('2026-10-08T21:15:00'));
  spans = addUse(spans, t('2026-10-09T00:40:00'));
  spans = addUse(spans, t('2026-10-09T07:05:00'));

  it('joins moments of use into stretches', () => {
    expect(spans).toHaveLength(3);
    expect(spans[0]).toEqual([t('2026-10-08T21:00:00'), t('2026-10-08T21:15:00')]);
  });

  it("finds last night's long gap", () => {
    expect(lastNight(spans, new Date('2026-10-09T08:00:00'))).toMatchObject({ pcOff: '00:40', pcOn: '07:05' });
  });

  it('suggests a bedtime, as a guess', () => {
    expect(sleepHint(new Date('2026-10-09T08:00:00'), spans)).toMatch(/last used at 00:40 .* first used at 07:05 .* bed around 00:45\? \(A guess/);
  });

  it('says nothing when the PC was off all evening (no gap to read)', () => {
    expect(sleepHint(new Date('2026-10-09T08:00:00'), [[t('2026-10-09T07:05:00'), t('2026-10-09T07:30:00')]])).toBe('');
  });
});

describe("Health's routines in the greeting", () => {
  it('morning: asks about sleep once, with the PC guess', () => {
    expect(greetingFacts('boot', new Date('2026-10-09T07:30:00'), empty, 'GUESS')).toMatch(/when they went to bed .* confirm or fix: GUESS/);
    const logged = { ...empty, sleep: [{ date: '2026-10-09' }] } as never;
    expect(greetingFacts('boot', new Date('2026-10-09T07:30:00'), logged, '')).toBe('');
  });

  it('evening: the 30-second check-in, only if nothing was logged today', () => {
    expect(greetingFacts('checkin', new Date('2026-10-09T20:00:00'), empty, '')).toMatch(/evening check-in/);
    const trained = { ...empty, training: [{ date: '2026-10-09' }] } as never;
    expect(greetingFacts('checkin', new Date('2026-10-09T20:00:00'), trained, '')).toBe('');
    expect(greetingFacts('checkin', new Date('2026-10-09T15:00:00'), empty, '')).toBe('');
  });
});
