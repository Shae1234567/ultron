import { createHash } from 'node:crypto';
import { AGENTS } from './brain/agents';
import { brainStats } from './brain/brains';
import { privateBrainAvailable } from './brain/llm';
import { once } from './brain/team';
import type { AgentId } from './brain/types';
import { DEPARTMENTS, departmentById, isLiveAgent, type Department } from './departments/registry';
import { snapshot, snapshotText } from './departments/health/summary';
import { departmentData } from './departments/data';
import { load as loadSchool } from './departments/school/store';
import { schoolNumber } from './departments/school/summary';
import { phoneStatus, startPairing } from './discordGateway';
import { intelFor } from './brain/brains';
import { builtDepartments } from './departments/registry';
import { status as heliosStatus } from './helios/sweep';
import { getSettings } from './store';
import { clashes } from './olympus';
import { historyNumber, load as loadHistory } from './departments/history/store';
import { load as loadProjects, projectsNumber } from './departments/projects/store';
import { load as loadPlay, playtime } from './media/tracker';
import { load as loadHelios } from './helios/store';
import { load as loadHealthDoc } from './departments/health/store';

/*
 * What the council chamber shows, from the real registry, brains and logs - never the
 * preview's sample text. A department not built yet says so, and which build step brings it.
 * Each built head's line is generated from its real state, in its own voice, and kept until
 * that state changes.
 */

export interface SeatMember { id: string; name: string; job: string; live: boolean }
export interface SeatMetric { value: string; unit: string; nights?: (number | null)[]; target?: number; empty: boolean; extra?: string }
export interface CouncilSeat {
  id: string; name: string; seat: number; built: boolean; step: number; private: boolean;
  epithet: string; greek: Department['greek']; metricName: string;
  head: SeatMember; specialists: SeatMember[]; borrows: string[];
  brain: { facts: number; last?: { date: string; text: string; who: string } } | null;
  metric: SeatMetric | null;
}
export interface CouncilState {
  seats: CouncilSeat[];
  helios: {
    built: true; on: boolean;
    budget: { used: number; cap: number }; nextSweep: number; lastPull: number; today: number;
    requests: { id: string; dept: Department['id']; what: string; by: string; at: number }[];
    log: { at: number; dept?: Department['id']; text: string }[];
    intel: Partial<Record<Department['id'], string>>;
  };
  phone: ReturnType<typeof phoneStatus>;
}

const member = (m: { id: string; name: string; job: string }): SeatMember => ({ ...m, live: isLiveAgent(m.id) });

function healthMetric(): SeatMetric {
  const s = snapshot();
  const n = s.number;
  return {
    value: n.nightsLogged ? `${n.nightsOver8}/${n.nightsLogged}` : '-',
    unit: n.nightsLogged ? 'logged nights with 8+ hours' : 'no nights logged yet',
    nights: n.nights,
    target: 8,
    empty: s.empty,
    extra: `${n.sessions} training session${n.sessions === 1 ? '' : 's'} logged this week`,
  };
}

function brainOf(d: Department): CouncilSeat['brain'] {
  if (!d.built) return null;
  let facts = 0;
  let last: { date: string; text: string; who: string } | undefined;
  for (const m of [d.head, ...d.specialists]) {
    if (!isLiveAgent(m.id)) continue;
    const s = brainStats(m.id);
    facts += s.facts;
    if (s.last && (!last || s.last.date > last.date)) last = { ...s.last, who: m.name };
  }
  return { facts, last };
}

export function councilState(): CouncilState {
  return {
    seats: DEPARTMENTS.map((d) => ({
      id: d.id, name: d.name, seat: d.seat, built: d.built, step: d.step, private: d.private,
      epithet: d.epithet, greek: d.greek, metricName: d.metric,
      head: member(d.head), specialists: d.specialists.map(member),
      borrows: d.borrows.map((id) => AGENTS[id].name),
      brain: brainOf(d),
      metric: d.built ? metricFor(d.id) : null,
    })),
    helios: heliosState(),
    phone: phoneStatus(),
  };
}

function metricFor(id: Department['id']): SeatMetric | null {
  try {
    if (id === 'health') return healthMetric();
    if (id === 'school') return schoolMetric();
    if (id === 'history') {
      const n = historyNumber(loadHistory());
      return { value: String(n.month), unit: 'deep-dives finished this month', empty: !n.total && !n.open.length, extra: n.open.length ? `${n.open.length} in progress: ${n.open[0].topic}` : `${n.total} finished in all` };
    }
    if (id === 'projects') {
      const d = loadProjects();
      const n = projectsNumber(d);
      return { value: `${n.shipped}/${n.stalled}`, unit: 'milestones shipped / projects stalled', empty: !d.projects.length, extra: d.projects.length ? `${n.active} active` : 'no projects tracked yet' };
    }
    if (id === 'media') {
      const week = Date.now() - 7 * 86_400_000;
      const caught = loadHelios().items.filter((i) => i.dept === 'media' && i.at >= week).length;
      const mins = playtime(loadPlay()).reduce((s, w) => s + w.minutes, 0);
      return { value: String(caught), unit: 'game and screen updates caught this week', empty: !caught && !mins, extra: mins ? `${Math.round((mins / 60) * 10) / 10} h of games tracked this week` : undefined };
    }
  } catch { /* a store unreadable - show the seat without a number */ }
  return null;
}

function schoolMetric(): SeatMetric {
  const doc = loadSchool();
  const n = schoolNumber(doc);
  const moving = n.trend.filter((t) => t.change).map((t) => `${t.course} ${t.change! > 0 ? 'up' : 'down'} ${Math.abs(t.change!)}`);
  return {
    value: n.total ? `${n.onTime}/${n.total}` : '-',
    unit: n.total ? 'assignments in on time, last 8 weeks' : doc.cache?.signedIn === false ? 'D2L not signed in' : doc.cache ? 'no assignments due lately' : 'not read from D2L yet',
    empty: !doc.cache,
    extra: n.trend.length ? `${n.trend.length} course grade${n.trend.length === 1 ? '' : 's'} tracked${moving.length ? `: ${moving.slice(0, 2).join(', ')}` : ''}` : undefined,
  };
}

function heliosState(): CouncilState['helios'] {
  try {
    const st = heliosStatus();
    const intel: CouncilState['helios']['intel'] = {};
    for (const d of builtDepartments()) {
      const text = intelFor(d.id).split('\n').filter((l) => l.startsWith('- ')).slice(0, 4).join('\n');
      if (text) intel[d.id] = text;
    }
    return { built: true, on: (getSettings() as { helios?: { on?: boolean } }).helios?.on !== false, ...st, intel };
  } catch {
    return { built: true, on: false, budget: { used: 0, cap: 40 }, nextSweep: 0, lastPull: 0, today: 0, requests: [], log: [], intel: {} };
  }
}

/** What a department knows right now, as its head reads it. */
function stateText(d: Department): string {
  return d.id === 'health' ? snapshotText() : d.built ? departmentData(d.id) : '';
}

/** The line a head says when there is no brain to say it in voice - plain, and true. */
export function plainLine(d: Department, state: string): string {
  if (!d.built) return `${d.head.name} arrives in build step ${d.step}: ${d.head.job}.`;
  if (d.id === 'health') {
    if (/nothing logged (yet|before)/.test(state)) return 'No sleep logged yet. Tell me when you went to bed.';
    const m = /(\d+) of (\d+) logged nights had 8\+ hours/.exec(state);
    if (m) return `${m[1]} of ${m[2]} logged nights over eight hours this week.`;
    return 'No nights logged this week yet. Tell me when you went to bed.';
  }
  if (d.id === 'history') return /in progress: ([^;(.]+)/.exec(state)?.[1] ? `Still on ${/in progress: ([^;(.]+)/.exec(state)![1].trim()}. Shall we finish it?` : 'Pick an empire and we go deep. The Mongols are waiting.';
  if (d.id === 'projects') return /no projects tracked yet/.test(state) ? 'What are you building? Give it a name and one line for what done looks like.' : /STALLED/.test(state) ? 'Something has stalled. Paused, or abandoned? Either is fine.' : 'The route is clear. What ships next?';
  if (d.id === 'media') return /This week \(game tracker\): ([^.]+)/.exec(state)?.[1] && !/no games seen/.test(state) ? 'I saw what you played this week. Want what is coming next?' : 'Tell me what you are into and I will find what is coming.';
  if (d.id === 'school') {
    if (/not loaded yet|NOT signed in/.test(state)) return "I can't see D2L yet. Sign in from the Apps panel and I'll tell you what's due.";
    if (/OVERDUE/.test(state)) return 'Something is overdue. That comes first.';
    const due = /Due in the next 7 days: ([^(;]+)/.exec(state)?.[1]?.trim();
    return due ? `Next up: ${due}.` : 'Nothing due this week. A good week to get ahead.';
  }
  return `${d.head.name} is here.`;
}

const lines = new Map<string, { key: string; text: string; at: number }>();

/** One short line from a head, in its own voice, from its real state - cached until the state changes. */
export async function seatLine(id: string): Promise<string> {
  const d = departmentById(id);
  if (!d) return '';
  const state = stateText(d);
  if (!d.built) return plainLine(d, state);
  const key = createHash('sha1').update(state).digest('hex');
  const cached = lines.get(id);
  if (cached && cached.key === key && Date.now() - cached.at < 3 * 3600_000) return cached.text;
  // Private data is only spoken through a brain trusted with it.
  if (d.private && !(await privateBrainAvailable().catch(() => false))) return plainLine(d, state);
  const head = AGENTS[d.head.id as AgentId];
  try {
    const text = await once({
      system: [
        `You are ${head.name}, ${head.title} on Ultron's council. ${head.voice ?? ''}`,
        'Say ONE short line (at most 25 words) to the operator about where things stand, in your own voice. Use only the facts below - never invent a number.',
        'If nothing is logged, say so plainly and ask for the first thing to log. No greeting, no sign-off, no markdown.',
        '',
        state || 'No data yet.',
      ].join('\n'),
      user: 'Your line.',
      tier: 'fast',
      temperature: 0.7,
      private: d.private,
    });
    const clean = text.replace(/^["'\s]+|["'\s]+$/g, '').slice(0, 220) || plainLine(d, state);
    lines.set(id, { key, text: clean, at: Date.now() });
    return clean;
  } catch {
    return plainLine(d, state);
  }
}

/** Convene: every seated head reports in one line; the empty seats say when they arrive. */
export async function convene(): Promise<{ at: number; lines: { id: string; head: string; text: string; built: boolean }[]; summary: string }> {
  const out = await Promise.all(DEPARTMENTS.map(async (d) => ({ id: d.id, head: d.head.name, built: d.built, text: await seatLine(d.id) })));
  const seated = DEPARTMENTS.filter((d) => d.built).map((d) => d.name);
  const summary = seated.length === DEPARTMENTS.length
    ? 'Everyone has reported.'
    : `${seated.length} of ${DEPARTMENTS.length} seats are filled so far (${seated.join(', ') || 'none'}). The rest arrive in later build steps; Helios is already feeding the filled ones.`;
  let cl: string[] = [];
  try { cl = clashes(loadHealthDoc(), loadSchool()).map((c) => c.text); } catch { /* no data yet */ }
  return { at: Date.now(), lines: out.sort((a, b) => (departmentById(a.id)?.seat ?? 0) - (departmentById(b.id)?.seat ?? 0)), summary: cl.length ? `${summary} Clashes ahead: ${cl.slice(0, 2).join(' ')}` : summary };
}

export function phoneLink(): { code: string; expires: number } {
  return startPairing();
}
