import { describe, expect, it } from 'vitest';
import { bedtimesFor, fromMin, hm, hoursBetween, sleepInsights, toMin, wakeTimesFor } from './sleepPlan';

describe("Hypnos' bedtime maths", () => {
  it('works back from a wake time, leaving 15 minutes to fall asleep', () => {
    const rows = bedtimesFor('07:00');
    expect(rows.map((r) => [r.hours, r.bed])).toEqual([[10, '20:45'], [9, '21:45'], [8, '22:45']]);
    expect(rows.find((r) => r.pick)?.hours).toBe(9);
    expect(rows.find((r) => r.hours === 9)?.cycles).toBe(6);
  });

  it('works forward from a bedtime, across midnight', () => {
    expect(wakeTimesFor('23:30').map((r) => r.wake)).toEqual(['07:45', '08:45', '09:45']);
  });

  it('handles clock arithmetic and wording', () => {
    expect(fromMin(toMin('00:10') - 30)).toBe('23:40');
    expect(hoursBetween('23:45', '07:15')).toBe(7.5);
    expect(hm(8.25)).toBe('8 h 15 min');
    expect(hm(9)).toBe('9 h');
  });

  it('reads a week plainly', () => {
    const nights = ['2026-10-03', '2026-10-04', '2026-10-05', '2026-10-06', '2026-10-07'].map((date, i) => ({ date, hours: [9.5, 9.5, 7, 6.5, 7][i], bed: '23:00' }));
    const out = sleepInsights(nights, 110);
    expect(out.join(' ')).toMatch(/moved 1 h 50 min/);
    expect(out.join(' ')).toMatch(/more on weekends/);
    expect(out.join(' ')).toMatch(/3 of your 5 logged nights were under 8 hours/);
    expect(sleepInsights(nights.slice(0, 2), null)).toEqual([]);
  });
});
