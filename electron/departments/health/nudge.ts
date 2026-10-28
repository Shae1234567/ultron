import { getSettings, readDoc, writeDoc } from '../../store';
import { emit } from '../../brain/events';
import { isoDay, load, type HealthDoc } from './store';

/*
 * Hypnos' wind-down nudge: half an hour before he needs to be in bed, on school nights and on
 * nights before a morning practice or game. "In bed by" is worked back from the wake time -
 * the one he set, or his usual weekday wake from the log - with 8-10 hours (9 by default) and
 * 15 minutes to fall asleep. Once a night at most; not sent when he has been away from the PC
 * for a while (he may already be in bed). Its switch is on the Health app's Sleep page.
 */

const DOC = 'departments/health-nudge.json';
const FALL_ASLEEP = 15;
const LEAD = 30;
const DAY = 86_400_000;

export interface NudgeSettings { bedtimeNudge: boolean; wake: string; hours: number }
export const NUDGE_DEFAULTS: NudgeSettings = { bedtimeNudge: true, wake: '', hours: 9 };

const toMin = (hhmm: string) => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + (m || 0); };
const fromMin = (mins: number) => { const m = ((Math.round(mins) % 1440) + 1440) % 1440; return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`; };

export function settings(): NudgeSettings {
  const s = (getSettings() as { health?: Partial<NudgeSettings> }).health ?? {};
  return {
    bedtimeNudge: s.bedtimeNudge !== false,
    wake: typeof s.wake === 'string' && /^\d{2}:\d{2}$/.test(s.wake) ? s.wake : '',
    hours: typeof s.hours === 'number' && s.hours >= 8 && s.hours <= 10 ? s.hours : NUDGE_DEFAULTS.hours,
  };
}

/** His usual weekday wake time from the last three weeks of logged nights, or 7:00. */
export function usualWake(doc: Pick<HealthDoc, 'sleep'>, now: Date): string {
  const since = isoDay(new Date(now.getTime() - 21 * DAY));
  const wakes = doc.sleep
    .filter((s) => s.date >= since && ![0, 6].includes(new Date(`${s.date}T12:00:00`).getDay()))
    .map((s) => toMin(s.wake))
    .filter((m) => m >= 4 * 60 && m <= 11 * 60)
    .sort((a, b) => a - b);
  if (wakes.length < 2) return '07:00';
  return fromMin(Math.round(wakes[Math.floor(wakes.length / 2)] / 5) * 5);
}

export interface TonightPlan { wake: string; bed: string; remindAt: string; at: number; why: string }

/**
 * Tonight's plan, or null when there is nothing to remind about (a Friday or Saturday night with
 * no morning game or practice). Before 4 am "tonight" has already started, so there is none.
 */
export function tonightPlan(now = new Date(), s: NudgeSettings = settings(), doc: Pick<HealthDoc, 'sleep' | 'schedule'> = load()): TonightPlan | null {
  if (now.getHours() < 4) return null;
  const tomorrow = new Date(now.getTime() + DAY);
  const day = tomorrow.getDay();
  const morning = doc.schedule.filter((x) => x.day === day && toMin(x.start) < 12 * 60).sort((a, b) => toMin(a.start) - toMin(b.start))[0];
  const schoolNight = day >= 1 && day <= 5;
  if (!schoolNight && !morning) return null;
  let wake = s.wake || usualWake(doc, now);
  let why = '';
  if (morning) {
    // Up 90 minutes before a morning session, if that is earlier than usual.
    const early = fromMin(Math.floor((toMin(morning.start) - 90) / 5) * 5);
    if (toMin(early) < toMin(wake)) { wake = early; }
    why = ` - ${morning.kind}${morning.sport ? ` (${morning.sport})` : ''} at ${morning.start}`;
  }
  const bedMin = toMin(wake) - s.hours * 60 - FALL_ASLEEP;
  const bed = fromMin(bedMin);
  const remindMin = bedMin - LEAD;
  // Minutes are counted from tomorrow's midnight (negative = this evening), so one sum covers both.
  const base = new Date(now); base.setHours(0, 0, 0, 0);
  const at = base.getTime() + (remindMin + 1440) * 60_000;
  return { wake, bed, remindAt: fromMin(remindMin), at, why };
}

export function nudgeText(p: TonightPlan, hours: number): string {
  return `Hypnos: time to wind down. In bed by ${p.bed} gives you ${hours} hours before ${p.wake}${p.why}. Screens off soon.`;
}

let timer: ReturnType<typeof setInterval> | null = null;

/** Checks once a minute; sends at most one nudge a night. */
export function startBedtimeNudge(opts: { idleSeconds: () => number; notify: (title: string, body: string) => void }): void {
  if (timer) return;
  const tick = () => {
    const s = settings();
    if (!s.bedtimeNudge) return;
    const now = new Date();
    const plan = tonightPlan(now, s);
    if (!plan || now.getTime() < plan.at || now.getTime() > plan.at + 20 * 60_000) return;
    const sent = readDoc<{ last?: string }>(DOC, {});
    if (sent.last === isoDay(now)) return;
    writeDoc(DOC, { last: isoDay(now) });
    // Away from the PC for 20+ minutes: probably already winding down - don't ping an empty room.
    if (opts.idleSeconds() > 20 * 60) return;
    const text = nudgeText(plan, s.hours);
    opts.notify('Ultron - bedtime', text.replace(/^Hypnos: /, ''));
    emit('health:nudge', { text });
  };
  timer = setInterval(tick, 60_000);
}
