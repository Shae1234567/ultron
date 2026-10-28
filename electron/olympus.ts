import { emit } from './brain/events';
import { builtDepartments } from './departments/registry';
import { load as loadHealth, type HealthDoc } from './departments/health/store';
import { snapshot } from './departments/health/summary';
import { load as loadSchool, type SchoolDoc } from './departments/school/store';
import { schoolNumber } from './departments/school/summary';
import { readNote, writeNote } from './memory/vault';
import { getSettings, saveSettings } from './store';

/*
 * Olympus - the council working together (build step 6), worked out from the departments' own
 * data, so it costs no AI calls and never needs the local model:
 *  - clashes: a game the day before a quiz, practice the evening before something is due first
 *    thing, late nights before early practices - said as information, never nagging;
 *  - a line from each seated department in the morning briefing;
 *  - the Sunday review: each department's number for the week, next week's top three, and a
 *    plain word when a department has gone unused for two weeks. Written to the vault (private)
 *    and shown in Ultron.
 */

const DAY = 86_400_000;
const WD = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const toMin = (hhmm: string) => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + (m || 0); };
const dayStart = (t: number) => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); };

export interface Clash { when: number; text: string }

/** Clashes in the next 7 days between Health's schedule and School's deadlines. Pure. */
export function clashes(health: Pick<HealthDoc, 'schedule' | 'sleep'>, school: Pick<SchoolDoc, 'cache'>, now = Date.now()): Clash[] {
  const out: Clash[] = [];
  const c = school.cache;
  const deadlines = [
    ...(c?.due ?? []).filter((d) => !d.completed && d.due).map((d) => ({ at: Date.parse(d.due!), what: `${d.course} ${d.type === 'quiz' ? 'quiz' : ''} "${d.name}"`.replace(/\s+/g, ' ') })),
    ...(c?.quizzes ?? []).filter((q) => q.start).map((q) => ({ at: Date.parse(q.start!), what: `${q.course} quiz "${q.name}"` })),
  ].filter((x) => x.at > now && x.at < now + 8 * DAY);
  for (let i = 0; i < 7; i++) {
    const day = dayStart(now) + i * DAY;
    const wd = new Date(day).getDay();
    for (const s of health.schedule.filter((x) => x.day === wd)) {
      const start = day + toMin(s.start) * 60_000;
      if (start < now) continue;
      const end = start + s.minutes * 60_000;
      const label = `${s.kind}${s.sport ? ` (${s.sport})` : ''}`;
      // A game, then something due or a quiz the next day: the studying has to happen before.
      if (s.kind === 'game') {
        const next = deadlines.filter((d) => d.at >= end && d.at < dayStart(day) + 2 * DAY + 12 * 3600_000);
        for (const d of next) out.push({ when: start, text: `${WD[wd]}'s ${label} is right before the ${d.what} (${WD[new Date(d.at).getDay()]}) - get the studying done the day before the game.` });
      }
      // An evening session the night before something due first thing.
      if (toMin(s.start) >= 16 * 60) {
        const morning = deadlines.filter((d) => d.at > end && d.at <= dayStart(day) + DAY + 12 * 3600_000);
        for (const d of morning) out.push({ when: start, text: `${label[0].toUpperCase()}${label.slice(1)} on ${WD[wd]} evening, and the ${d.what} is due ${WD[new Date(d.at).getDay()]} morning - finish it before you go.` });
      }
      // An early session after a week of late nights.
      if (toMin(s.start) < 9 * 60) {
        const recent = health.sleep.filter((x) => Date.parse(`${x.date}T12:00:00`) >= now - 7 * DAY);
        const late = recent.filter((x) => { const b = toMin(x.bed); return b >= 23 * 60 + 30 || b < 4 * 60; });
        if (recent.length >= 3 && late.length >= Math.ceil(recent.length / 2)) {
          out.push({ when: start, text: `${label[0].toUpperCase()}${label.slice(1)} at ${s.start} on ${WD[wd]}, and most nights this week you were in bed after 11:30 - an earlier night before it pays off.` });
        }
      }
    }
  }
  const seen = new Set<string>();
  return out.filter((x) => (seen.has(x.text) ? false : (seen.add(x.text), true))).sort((a, b) => a.when - b.when).slice(0, 4);
}

/** One line per seated department for the morning briefing. */
export function briefingLines(now = Date.now()): string[] {
  const lines: string[] = [];
  const built = builtDepartments().map((d) => d.id);
  const health = loadHealth();
  const school = loadSchool();
  for (const c of clashes(health, school, now).slice(0, 2)) lines.push(`Heads up: ${c.text}`);
  if (built.includes('health')) {
    const s = snapshot(new Date(now), health);
    if (!s.empty) {
      const n = s.number;
      lines.push(n.nightsLogged ? `Health: ${n.nightsOver8} of ${n.nightsLogged} logged nights over eight hours this week${s.flags[0] ? `; ${s.flags[0].text.split('.')[0].toLowerCase()}` : ''}.` : 'Health: no sleep logged this week yet.');
    }
  }
  if (built.includes('school') && school.cache?.signedIn) {
    const c = school.cache;
    const next = c.due.filter((d) => !d.completed && d.due && Date.parse(d.due) > now).sort((a, b) => Date.parse(a.due!) - Date.parse(b.due!))[0];
    if (c.overdue.length) lines.push(`School: ${c.overdue.length} overdue, starting with ${c.overdue[0].name}.`);
    else if (next) lines.push(`School: next up is ${next.name} for ${next.course}, due ${WD[new Date(next.due!).getDay()]}.`);
  }
  return lines;
}

export interface Review { date: string; text: string }

/** The Sunday review, from each department's real numbers. Pure apart from what it is given. */
export function buildReview(health: HealthDoc, school: SchoolDoc, built: string[], now = Date.now()): Review {
  const date = new Date(now).toISOString().slice(0, 10);
  const parts: string[] = [`# Sunday review - ${date}`, ''];
  const unused: string[] = [];
  if (built.includes('health')) {
    const s = snapshot(new Date(now), health);
    const n = s.number;
    const top: string[] = [];
    if (n.nightsLogged && n.nightsOver8 < n.nightsLogged) top.push('Lights out early enough on school nights for 8+ hours (the Sleep page plans it from your wake time).');
    if (s.flags.some((f) => f.kind === 'jump')) top.push('Keep training load steady - this week jumped.');
    if (s.flags.some((f) => f.kind === 'pain' || f.kind === 'head')) top.push('Follow up on the sore spot on the Body page - and tell an adult if it is not improving.');
    if (s.food?.short.length) top.push(`Fuel: more ${s.food.short.slice(0, 2).map((x) => x.label.replace(/ \(.*\)/, '')).join(' and ')} (Demeter's list has foods to ask for).`);
    if (top.length < 3) top.push('Log sleep each morning - it is what makes the readiness call work.');
    const logged = [...health.sleep, ...health.training, ...health.food, ...health.checkins].filter((e) => e.at >= now - 14 * DAY).length;
    if (!logged) unused.push('Health');
    parts.push('## Health (Asclepius)', `- This week: ${n.nightsLogged ? `${n.nightsOver8} of ${n.nightsLogged} logged nights with 8+ hours` : 'no nights logged'}; ${n.sessions} training session${n.sessions === 1 ? '' : 's'}, load ${n.load}.`, ...top.slice(0, 3).map((t, i) => `${i + 1}. ${t}`), '');
  }
  if (built.includes('school')) {
    const n = schoolNumber(school, now);
    const c = school.cache;
    const next = (c?.due ?? []).filter((d) => !d.completed && d.due && Date.parse(d.due) > now && Date.parse(d.due) < now + 8 * DAY).sort((a, b) => Date.parse(a.due!) - Date.parse(b.due!));
    const top = [
      ...(c?.overdue ?? []).slice(0, 1).map((d) => `Hand in ${d.name} (${d.course}) - it is overdue.`),
      ...next.slice(0, 3).map((d) => `${d.name} (${d.course}) - due ${WD[new Date(d.due!).getDay()]}.`),
      ...n.trend.filter((t) => t.change !== null && t.change < 0).slice(0, 1).map((t) => `${t.course} dipped ${Math.abs(t.change!)} - ask Prometheus what the feedback says to work on.`),
    ];
    if (!c) unused.push('School (D2L not read yet)');
    parts.push('## School (Prometheus)', `- This week: ${n.total ? `${n.onTime} of ${n.total} assignments in on time over 8 weeks` : 'no assignments due lately'}${n.trend.length ? `; ${n.trend.map((t) => `${t.course} ${t.grade}`).join(', ')}` : ''}.`, ...(top.length ? top.slice(0, 3) : ['Nothing due next week - a good week to get ahead or review.']).map((t, i) => `${i + 1}. ${t}`), '');
  }
  const cl = clashes(health, school, now);
  if (cl.length) parts.push('## Clashes next week', ...cl.map((x) => `- ${x.text}`), '');
  if (unused.length) parts.push('## Not used', `- ${unused.join(', ')}: nothing in two weeks. Worth fixing, or worth switching off - your call.`, '');
  parts.push('## Ultron', `- ${built.length} department${built.length === 1 ? '' : 's'} reported. Homework first, then everything else.`);
  return { date, text: parts.join('\n') };
}

/** Writes the review once each Sunday evening (when idle) and tells the screen. */
export function startSundayReview(busy: () => boolean): void {
  const tick = () => {
    const now = new Date();
    if (now.getDay() !== 0 || now.getHours() < 18 || busy()) return;
    const key = now.toDateString();
    if (getSettings().jobs['sunday-review'] && new Date(Number(getSettings().jobs['sunday-review'])).toDateString() === key) return;
    saveSettings({ jobs: { 'sunday-review': Date.now() } });
    const r = buildReview(loadHealth(), loadSchool(), builtDepartments().map((d) => d.id));
    writeNote(`Intel/Sunday review ${r.date}.md`, `---\nprivate: true\nsource: Olympus\n---\n\n${r.text}\n`);
    emit('council:review', r);
  };
  setTimeout(tick, 5 * 60_000);
  setInterval(tick, 20 * 60_000);
}

/** The latest review, if one has been written. */
export function latestReview(now = new Date()): Review | null {
  for (let i = 0; i < 8; i++) {
    const d = new Date(now.getTime() - i * DAY);
    if (d.getDay() !== 0) continue;
    const date = d.toISOString().slice(0, 10);
    const text = readNote(`Intel/Sunday review ${date}.md`);
    if (text) return { date, text: text.replace(/^---[\s\S]*?---\s*/, '') };
  }
  return null;
}
