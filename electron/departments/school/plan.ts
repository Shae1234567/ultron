/*
 * Kratos' study blocks: work back from a due date (or a test) and spread the work in short
 * blocks across the days before it - after school, around practices and games, never the
 * night before only, and never past a sensible bedtime. Structure, not nagging: the plan is a
 * set of tasks with reminders that he can move or drop.
 */

export interface Busy { day: number; start: string; minutes: number; what: string }
export interface Block { start: Date; minutes: number; label: string }

const toMin = (hhmm: string) => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + (m || 0); };

/** Study windows: weekdays 16:00-20:30, weekends 10:00-12:00 and 14:00-18:00. */
const WINDOWS: Record<'weekday' | 'weekend', [number, number][]> = {
  weekday: [[16 * 60, 20 * 60 + 30]],
  weekend: [[10 * 60, 12 * 60], [14 * 60, 18 * 60]],
};

/**
 * Spreads `totalMinutes` of study into blocks of `blockMinutes` between now and the due time,
 * at most two blocks a day, skipping time taken by practices or games (with 30 minutes either
 * side), finishing the day before when the due time is early in the morning. Pure.
 */
export function planBlocks(now: Date, due: Date, totalMinutes: number, blockMinutes = 30, busy: Busy[] = [], label = 'Study'): Block[] {
  const blocks: Block[] = [];
  const need = Math.max(1, Math.round(totalMinutes / blockMinutes));
  const days: Date[] = [];
  for (let d = new Date(now); d < due && days.length < 21; d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1)) days.push(new Date(d.getFullYear(), d.getMonth(), d.getDate()));
  // Fill evenly: walk the days repeatedly, one block per day per pass, latest-safe first never.
  const perDay = new Map<number, number>();
  let pass = 0;
  while (blocks.length < need && pass < 2) {
    for (const d of days) {
      if (blocks.length >= need) break;
      const weekend = d.getDay() === 0 || d.getDay() === 6;
      const taken = blocks.filter((b) => b.start.toDateString() === d.toDateString());
      if ((perDay.get(d.getTime()) ?? 0) > pass) continue;
      const busyToday = busy.filter((b) => b.day === d.getDay()).map((b) => [toMin(b.start) - 30, toMin(b.start) + b.minutes + 30] as [number, number]);
      let placed = false;
      for (const [ws, we] of WINDOWS[weekend ? 'weekend' : 'weekday']) {
        for (let m = ws; m + blockMinutes <= we && !placed; m += 15) {
          const start = new Date(d.getFullYear(), d.getMonth(), d.getDate(), Math.floor(m / 60), m % 60);
          const end = start.getTime() + blockMinutes * 60_000;
          if (start.getTime() < now.getTime() + 10 * 60_000) continue;
          if (end > due.getTime() - 60 * 60_000) continue;
          if (busyToday.some(([bs, be]) => m < be && m + blockMinutes > bs)) continue;
          if (taken.some((b) => Math.abs(b.start.getTime() - start.getTime()) < (blockMinutes + 60) * 60_000)) continue;
          blocks.push({ start, minutes: blockMinutes, label });
          perDay.set(d.getTime(), (perDay.get(d.getTime()) ?? 0) + 1);
          placed = true;
        }
        if (placed) break;
      }
    }
    pass++;
  }
  return blocks.sort((a, b) => a.start.getTime() - b.start.getTime());
}
