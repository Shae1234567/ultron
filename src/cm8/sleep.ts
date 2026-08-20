/**
 * CM8's sleep optimiser and reminder plumbing, ported.
 *
 * The maths is the same on both sides: 90-minute cycles plus a 15-minute
 * allowance for actually falling asleep, and 4-6 cycles offered so the
 * recommended 8-10 hour window for a 14-year-old is always among the options.
 *
 * Reminders come in two flavours on purpose, because they fail differently:
 *   - notifications fire instantly but only while the app is running;
 *   - a calendar file works with everything closed, because the OS owns the
 *     alarm. Slower to set up, far more reliable.
 */
import { fmt, type Plan } from './planner';

export type SleepMode = 'tosleep' | 'towake';

export interface SleepOption {
  time: string;
  mins: number;
  cycles: number;
  hours: number;
  inRange: boolean;
}

const CYCLE = 90;
const LATENCY = 15;

export function sleepOptions(input: string, mode: SleepMode): SleepOption[] {
  const [hh, mm] = input.split(':').map(Number);
  if (Number.isNaN(hh) || Number.isNaN(mm)) return [];
  const base = hh * 60 + mm;
  const out: SleepOption[] = [];
  for (let cycles = 4; cycles <= 6; cycles++) {
    const span = LATENCY + cycles * CYCLE;
    const mins = mode === 'tosleep' ? base + span : base - span;
    const hours = span / 60;
    out.push({
      time: fmt(mins),
      mins: ((mins % 1440) + 1440) % 1440,
      cycles,
      hours,
      // The 8-10 hour band recommended for his age, with a little tolerance.
      inRange: hours >= 7.9 && hours <= 10.1,
    });
  }
  return out;
}

/* ---------- calendar files ---------- */
const pad = (n: number) => String(n).padStart(2, '0');
const stamp = (d: Date) =>
  `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;
const esc = (s: string) => String(s || '').replace(/[\\,;]/g, (m) => '\\' + m).replace(/\n/g, '\\n');

/** One alarm for a wake-up time, for tomorrow morning. */
export function wakeReminderIcs(mins: number, cycles: number): string {
  const now = new Date();
  const at = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, mins, 0);
  if (at.getTime() <= now.getTime()) at.setDate(at.getDate() + 1);
  const end = new Date(at.getTime() + 15 * 60000);
  return [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Shae CM8//Coach App//EN', 'CALSCALE:GREGORIAN',
    'BEGIN:VEVENT',
    'UID:cm8-wake-' + now.getTime() + '@shae-cm8',
    'DTSTAMP:' + stamp(now),
    'DTSTART:' + stamp(at),
    'DTEND:' + stamp(end),
    'SUMMARY:' + esc(`Shae CM8 — Wake-up (${cycles} sleep cycles)`),
    'DESCRIPTION:' + esc('Optimal wake-up between sleep cycles, from the CM8 sleep optimiser.'),
    'BEGIN:VALARM', 'ACTION:DISPLAY', 'TRIGGER:PT0M', 'DESCRIPTION:' + esc('Wake up'), 'END:VALARM',
    'END:VEVENT', 'END:VCALENDAR',
  ].join('\r\n');
}

/** The whole built day, one alarmed event per item. */
export function planIcs(plan: Plan): string {
  const now = new Date();
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Shae CM8//Coach App//EN', 'CALSCALE:GREGORIAN'];
  plan.events.forEach((e, i) => {
    // Anything before wake-up belongs to tomorrow, not this morning.
    const abs = e.start < plan.wokeAt ? e.start + 1440 : e.start;
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, abs, 0);
    const end = new Date(start.getTime() + 20 * 60000);
    lines.push(
      'BEGIN:VEVENT',
      'UID:cm8-' + now.getTime() + '-' + i + '@shae-cm8',
      'DTSTAMP:' + stamp(now),
      'DTSTART:' + stamp(start),
      'DTEND:' + stamp(end),
      'SUMMARY:' + esc(e.title + (e.badge ? ' (' + e.badge + ')' : '')),
      'DESCRIPTION:' + esc(e.note),
      'BEGIN:VALARM', 'ACTION:DISPLAY', 'TRIGGER:PT0M', 'DESCRIPTION:' + esc(e.title), 'END:VALARM',
      'END:VEVENT',
    );
  });
  lines.push('END:VCALENDAR');
  return lines.join('\r\n');
}

export function downloadIcs(ics: string, filename: string) {
  const blob = new Blob([ics], { type: 'text/calendar' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  // Revoke on the next tick - revoking immediately can cancel the download.
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

/* ---------- in-app notifications ---------- */
let timers: ReturnType<typeof setTimeout>[] = [];

export function clearReminders() {
  timers.forEach(clearTimeout);
  timers = [];
}

export async function notificationsAllowed(): Promise<boolean> {
  if (typeof Notification === 'undefined') return false;
  if (Notification.permission === 'granted') return true;
  if (Notification.permission === 'denied') return false;
  try {
    return (await Notification.requestPermission()) === 'granted';
  } catch {
    return false;
  }
}

/**
 * Queues the rest of today's plan as notifications. Only future events, and
 * only while the app stays open - which is exactly why the calendar export
 * exists alongside it.
 */
export function scheduleReminders(plan: Plan): number {
  clearReminders();
  const now = new Date();
  const nowMins = now.getHours() * 60 + now.getMinutes();
  let queued = 0;
  for (const e of plan.events) {
    const abs = e.start < plan.wokeAt ? e.start + 1440 : e.start;
    const delta = abs - nowMins;
    if (delta <= 0 || delta > 18 * 60) continue;
    timers.push(setTimeout(() => {
      try {
        // eslint-disable-next-line no-new
        new Notification('CM8 · ' + e.title, { body: e.note, tag: 'cm8-' + e.start });
      } catch { /* notifications can be revoked mid-session */ }
    }, delta * 60000));
    queued++;
  }
  return queued;
}

export const remindersQueued = () => timers.length;
