import { getSettings, saveSettings } from './store';
import { getSnapshot } from './dashboard';
import { emit } from './brain/events';
import { quiet } from './focus';
import { isRunning } from './brain/team';
import { listTasks } from './tasks';
import { briefingLines } from './olympus';

/**
 * The morning briefing: one short spoken rundown of the day - weather, what is
 * due at school, anything waiting in email, and the first task. It is built
 * from the Life dashboard's own data, so it costs nothing extra and never
 * invents anything; the HUD speaks it (electron has no voice of its own).
 *
 * It fires once per day, only when the operator is actually at the machine.
 */

const JOB = 'briefing';

export interface Briefing { lines: string[]; at: number }

function todayKey(now = Date.now()): string {
  return new Date(now).toDateString();
}

/** The briefing in plain sentences, or null when there is nothing worth saying. */
export function buildBriefing(now = new Date()): Briefing | null {
  const snap = getSnapshot();
  const lines: string[] = [];
  const name = getSettings().profile.name;
  const hour = now.getHours();
  const part = hour < 12 ? 'Morning' : hour < 18 ? 'Afternoon' : 'Evening';
  lines.push(`${part}${name ? `, ${name}` : ''}.`);
  // The council's line each (and any clash) - from the departments' own data, no AI.
  try { lines.push(...briefingLines(now.getTime())); } catch { /* a department's data is unreadable - the rest still go */ }

  const school = snap.sections.find((s) => s.id === 'd2l');
  if (school?.state === 'ok' && school.count && !lines.some((l) => l.startsWith('School:'))) {
    const overdue = school.groups.find((g) => g.label === 'OVERDUE');
    const due = school.groups.find((g) => /DUE/.test(g.label));
    if (overdue?.items.length) lines.push(`${overdue.items.length} thing${overdue.items.length > 1 ? 's are' : ' is'} overdue on D2L, starting with ${overdue.items[0].title}.`);
    const soon = due?.items.filter((i) => i.urgent) ?? [];
    if (soon.length) lines.push(`${soon[0].title} for ${soon[0].sub} is due within a day.`);
    else if (due?.items.length) lines.push(`${due.items.length} assignment${due.items.length > 1 ? 's' : ''} due in the next couple of weeks.`);
  }

  const mail = snap.sections.find((s) => s.id === 'gmail');
  const unread = mail?.groups[0]?.items.filter((i) => i.unread) ?? [];
  if (unread.length) lines.push(`${unread.length} unread email${unread.length > 1 ? 's' : ''}${unread[0].sub ? `, the newest from ${unread[0].sub}` : ''}.`);

  const open = listTasks('open');
  const next = open.filter((t) => t.due).sort((a, b) => Date.parse(a.due!) - Date.parse(b.due!))[0];
  if (next) lines.push(`Your next task is ${next.title}.`);
  else if (open.length) lines.push(`${open.length} task${open.length > 1 ? 's' : ''} still open.`);

  // Only the greeting: not worth interrupting anyone for.
  return lines.length > 1 ? { lines, at: Date.now() } : null;
}

let timer: ReturnType<typeof setInterval> | null = null;

/** Speaks the briefing once a day, after the hour the operator set, when they are around. */
export function startBriefing(): void {
  if (timer) return;
  const tick = () => {
    const s = getSettings();
    if (!s.briefing.on) return;
    const now = new Date();
    if (now.getHours() < s.briefing.hour) return;
    if (getSettings().jobs[JOB] && todayKey(Number(getSettings().jobs[JOB])) === todayKey()) return;
    // Never over the top of a request or a focus session.
    if (isRunning() || quiet()) return;
    const b = buildBriefing(now);
    saveSettings({ jobs: { [JOB]: Date.now() } });
    if (b) emit('briefing:ready', b);
  };
  setTimeout(tick, 90_000);
  timer = setInterval(tick, 10 * 60_000);
}

/** For the command palette and "brief me". */
export function briefingNow(): Briefing | null {
  return buildBriefing();
}
