import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';
import { emit } from './brain/events';
import { showNotification } from './notifications';

/**
 * Focus sessions: a fixed stretch of work on one thing, with Ultron quiet
 * until it ends. Built because the operator studies badly at home - the point
 * is structure, not nagging, so nothing here scolds and a session that gets
 * abandoned simply ends.
 *
 * While a session runs, proactive chatter and non-urgent reminders are held
 * (see `quiet`), and the HUD shows the time left.
 */

export interface FocusSession {
  subject: string;
  startedAt: number;
  endsAt: number;
  /** Set when it finished or was stopped. */
  endedAt?: number;
  finished?: boolean;
}

export interface FocusState {
  active: FocusSession | null;
  /** Minutes left, rounded up. */
  left: number;
  streak: number;
  todayMinutes: number;
  /** Finished sessions, newest first. */
  recent: FocusSession[];
}

interface Store { sessions: FocusSession[] }

let current: FocusSession | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;

const file = () => path.join(app.getPath('userData'), 'focus.json');

function read(): Store {
  try {
    const raw = JSON.parse(fs.readFileSync(file(), 'utf8')) as Partial<Store>;
    return { sessions: Array.isArray(raw.sessions) ? raw.sessions.slice(-200) : [] };
  } catch {
    return { sessions: [] };
  }
}

function write(s: Store): void {
  try { fs.writeFileSync(file(), JSON.stringify(s)); } catch { /* best-effort */ }
}

const dayOf = (ms: number) => new Date(ms).toDateString();

/** Days in a row, counting back from today (or yesterday, if nothing is done yet today). */
export function streakFrom(sessions: FocusSession[], now = Date.now()): number {
  const days = new Set(sessions.filter((s) => s.finished).map((s) => dayOf(s.startedAt)));
  if (!days.size) return 0;
  const DAY = 86_400_000;
  let n = 0;
  // Today not counting yet is normal - start from yesterday so a streak is not lost before bedtime.
  let cursor = days.has(dayOf(now)) ? now : now - DAY;
  while (days.has(dayOf(cursor))) {
    n++;
    cursor -= DAY;
  }
  return n;
}

export function focusState(): FocusState {
  const { sessions } = read();
  const today = sessions.filter((s) => dayOf(s.startedAt) === dayOf(Date.now()) && s.finished);
  return {
    active: current,
    left: current ? Math.max(0, Math.ceil((current.endsAt - Date.now()) / 60_000)) : 0,
    streak: streakFrom(sessions),
    todayMinutes: today.reduce((n, s) => n + Math.round(((s.endedAt ?? s.endsAt) - s.startedAt) / 60_000), 0),
    recent: [...sessions].reverse().slice(0, 8),
  };
}

/** True while a session is running - proactive chatter and soft reminders wait. */
export function quiet(): boolean {
  return Boolean(current && Date.now() < current.endsAt);
}

export function startFocus(subject: string, minutes = 25): FocusState {
  const mins = Math.min(Math.max(Math.round(minutes) || 25, 5), 120);
  if (current) stopFocus(false);
  current = { subject: subject.trim().slice(0, 80) || 'study', startedAt: Date.now(), endsAt: Date.now() + mins * 60_000 };
  timer = setTimeout(() => finish(), mins * 60_000);
  const s = focusState();
  emit('focus:changed', s);
  return s;
}

function finish(): void {
  if (!current) return;
  const done: FocusSession = { ...current, endedAt: Date.now(), finished: true };
  const store = read();
  store.sessions.push(done);
  write(store);
  current = null;
  if (timer) { clearTimeout(timer); timer = null; }
  const mins = Math.round((done.endedAt! - done.startedAt) / 60_000);
  const state = focusState();
  showNotification('Focus session done', `${mins} minutes on ${done.subject}. How far did you get?`);
  // The HUD speaks the check-in and opens the conversation on it.
  emit('focus:done', { subject: done.subject, minutes: mins, streak: state.streak });
  emit('focus:changed', state);
}

/** Ends the session early. `keep` records the part that was done. */
export function stopFocus(keep = true): FocusState {
  if (!current) return focusState();
  if (keep) {
    const store = read();
    store.sessions.push({ ...current, endedAt: Date.now(), finished: Date.now() - current.startedAt >= 5 * 60_000 });
    write(store);
  }
  current = null;
  if (timer) { clearTimeout(timer); timer = null; }
  const s = focusState();
  emit('focus:changed', s);
  return s;
}
