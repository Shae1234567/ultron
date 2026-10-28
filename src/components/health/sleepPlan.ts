/*
 * Hypnos' bedtime maths - pure, so it is tested on its own. Teens need 8-10 hours
 * (the range the paediatric sleep guidelines give for 13-18). It takes about 15 minutes to
 * fall asleep, so "in bed by" is that much earlier than the sleep itself. Sleep runs in cycles
 * of about 90 minutes; waking at the end of one feels easier, so the 6-cycle time (9 hours)
 * is marked as the pick - it sits in the middle of the teen range.
 */

export const FALL_ASLEEP_MIN = 15;
export const CYCLE_MIN = 90;
export const TEEN = { min: 8, max: 10 };

export function toMin(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return (((h * 60 + (m || 0)) % 1440) + 1440) % 1440;
}

export function fromMin(mins: number): string {
  const m = ((Math.round(mins) % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

/** 23:05 -> "11:05 pm", for the friendlier lines. */
export function friendly(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number);
  const ap = h >= 12 ? 'pm' : 'am';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, '0')} ${ap}`;
}

export interface PlanRow { hours: number; bed: string; wake: string; cycles?: number; pick?: boolean }

/** To wake at `wake`: when to be in bed for 10, 9 and 8 hours of sleep. */
export function bedtimesFor(wake: string): PlanRow[] {
  const w = toMin(wake);
  return [10, 9, 8].map((hours) => ({
    hours, wake, bed: fromMin(w - hours * 60 - FALL_ASLEEP_MIN),
    cycles: (hours * 60) % CYCLE_MIN === 0 ? (hours * 60) / CYCLE_MIN : undefined,
    pick: hours === 9,
  }));
}

/** In bed at `bed`: when to wake for 8, 9 and 10 hours. */
export function wakeTimesFor(bed: string): PlanRow[] {
  const b = toMin(bed) + FALL_ASLEEP_MIN;
  return [8, 9, 10].map((hours) => ({
    hours, bed, wake: fromMin(b + hours * 60),
    cycles: (hours * 60) % CYCLE_MIN === 0 ? (hours * 60) / CYCLE_MIN : undefined,
    pick: hours === 9,
  }));
}

/** Hours between two clock times, across midnight. */
export function hoursBetween(bed: string, wake: string): number {
  let mins = toMin(wake) - toMin(bed);
  if (mins <= 0) mins += 1440;
  return Math.round((mins / 60) * 100) / 100;
}

/** "8 h 15 min" from 8.25. */
export function hm(hours: number): string {
  const total = Math.round(hours * 60);
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (!h) return `${m} min`;
  return m ? `${h} h ${m} min` : `${h} h`;
}

/** A plain read of how a week of bedtimes went - consistency matters as much as length. */
export function sleepInsights(nights: { date: string; hours: number | null; bed?: string }[], spreadMin: number | null): string[] {
  const out: string[] = [];
  const logged = nights.filter((n) => n.hours !== null);
  if (logged.length < 3) return out;
  if (spreadMin !== null && spreadMin >= 90) {
    out.push(`Your bedtime moved ${hm(spreadMin / 60)} across the week. Keeping it within about 30 minutes does more for how you feel than one long sleep-in.`);
  } else if (spreadMin !== null && spreadMin <= 45) {
    out.push('Steady bedtimes this week - that consistency is what makes sleep work.');
  }
  const weekend = logged.filter((n) => [0, 6].includes(new Date(`${n.date}T12:00:00`).getDay()));
  const weekday = logged.filter((n) => ![0, 6].includes(new Date(`${n.date}T12:00:00`).getDay()));
  if (weekend.length && weekday.length) {
    const avg = (xs: typeof logged) => xs.reduce((s, n) => s + (n.hours ?? 0), 0) / xs.length;
    const gap = avg(weekend) - avg(weekday);
    if (gap >= 1.5) out.push(`You sleep ${hm(gap)} more on weekends - a sign school nights are running short. An earlier school-night bedtime closes the gap.`);
  }
  const short = logged.filter((n) => (n.hours ?? 0) < TEEN.min).length;
  if (short >= 3) out.push(`${short} of your ${logged.length} logged nights were under ${TEEN.min} hours.`);
  return out;
}
