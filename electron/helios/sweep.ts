import { createHash } from 'node:crypto';
import type { DepartmentId } from '../brain/types';
import { builtDepartments, departmentById } from '../departments/registry';
import { load as loadSchool } from '../departments/school/store';
import { readNote, writeNote } from '../memory/vault';
import { getSettings } from '../store';
import { DEFAULT_FEEDS, fetchFeed, onThisDay, type FeedItem } from './feeds';
import { budgetToday, DAILY_BUDGET, isoDay, load, save, spend, type HeliosDoc, type IntelItem } from './store';
import { scoreItem } from './triage';

/*
 * Helios - the background researcher (build step 5). Never a chat agent, never in the way:
 *  - every hour while Ultron is idle, a free pull: each built department's feeds, Wikipedia's
 *    "on this day" for History, and new grades on School's copy of D2L (an event, logged at once);
 *    every item scored for every department without a model;
 *  - three sweeps a day (7:00, 15:30, 20:00) that write each department's intel for the day into
 *    the vault (Intel/YYYY-MM-DD.md, private) - the department's agents read it before working;
 *  - AI only for the few items worth a sentence, only on a cloud brain (never the local model -
 *    it shares the GPU with his games), and never more than 40 calls a day. With no cloud brain,
 *    the intel is still written, as plain headlines.
 */

const SWEEPS: { name: 'morning' | 'afternoon' | 'evening'; at: number }[] = [
  { name: 'morning', at: 7 * 60 }, { name: 'afternoon', at: 15 * 60 + 30 }, { name: 'evening', at: 20 * 60 },
];
const KEEP_SCORE = 0.35;

const hash = (s: string) => createHash('sha1').update(s).digest('hex').slice(0, 16);

function interests(): string[] {
  const p = getSettings().profile;
  return [...(p?.interests ?? [])].filter((x): x is string => typeof x === 'string').slice(0, 30);
}

/** The free pull: new items from every built department's feeds, scored; new grades logged as events. */
export async function pull(now = new Date()): Promise<{ added: number; failed: string[] }> {
  const d = load();
  const depts = builtDepartments().map((x) => x.id);
  const feeds = DEFAULT_FEEDS.filter((f) => depts.includes(f.dept));
  const failed: string[] = [];
  const fresh: { dept: DepartmentId; item: FeedItem }[] = [];
  for (const f of feeds) {
    try { for (const item of await fetchFeed(f)) fresh.push({ dept: f.dept, item }); } catch (e) { failed.push(`${f.label}: ${e instanceof Error ? e.message : String(e)}`); }
  }
  if (depts.includes('history')) {
    try { for (const item of await onThisDay(now)) fresh.push({ dept: 'history', item }); } catch (e) { failed.push(`on this day: ${e instanceof Error ? e.message : String(e)}`); }
  }
  const seen = new Set(d.seen);
  let added = 0;
  for (const { dept, item } of fresh) {
    const id = hash(item.link || item.title);
    if (seen.has(id)) continue;
    seen.add(id);
    d.seen.push(id);
    // Scored for every built department, kept where it is relevant enough.
    for (const dep of depts) {
      const reqs = d.requests.filter((r) => r.dept === dep).map((r) => r.what);
      const { score, matched } = scoreItem(item, dep, interests(), reqs, now.getTime());
      const bonus = dep === dept ? 0.1 : 0;
      if (score + bonus >= KEEP_SCORE) {
        d.items.push({ id: `${id}-${dep}`, dept: dep, title: item.title, link: item.link, source: item.source, at: item.at ?? now.getTime(), score: Math.min(1, score + bonus), matched });
        added++;
      }
    }
  }
  // An event: a new grade on School's copy of D2L - logged at once, no AI needed.
  try {
    const grades = loadSchool().gradeHistory.filter((g) => g.date > (d.schoolSeen || isoDay(new Date(now.getTime() - 86_400_000))));
    for (const g of grades) d.log.push({ at: now.getTime(), dept: 'school', text: `New grade on D2L: ${g.course} ${g.grade}` });
    const last = grades.map((g) => g.date).sort().pop();
    if (last) d.schoolSeen = last;
  } catch { /* School not set up */ }
  d.lastPull = now.getTime();
  d.log.push({ at: now.getTime(), text: `Pulled ${feeds.length} feed${feeds.length === 1 ? '' : 's'}: ${added} new item${added === 1 ? '' : 's'} worth keeping${failed.length ? `, ${failed.length} feed${failed.length === 1 ? '' : 's'} didn't answer` : ''}.` });
  save(d, now.getTime());
  return { added, failed };
}

/** The best items for a department today that haven't been written up yet. Pure. */
export function picksFor(d: HeliosDoc, dept: DepartmentId, now = Date.now(), max = 6): IntelItem[] {
  const since = now - 36 * 3600_000;
  return d.items.filter((i) => i.dept === dept && i.at >= since).sort((a, b) => b.score - a.score).slice(0, max);
}

/** The headline version (no AI): one line per pick, with where it came from. Pure. */
export function plainBrief(picks: IntelItem[]): string[] {
  return picks.map((p) => `- ${p.title}${p.link ? ` ([${p.source}](${p.link}))` : ` (${p.source})`}${p.matched.length ? ` - matches: ${p.matched.slice(0, 3).join(', ')}` : ''}`);
}

type Writer = (system: string, user: string) => Promise<string>;

/** One department's brief: a few lines on why these matter to him, from public headlines only. */
async function brief(dept: DepartmentId, picks: IntelItem[], requests: string[], write: Writer | null, d: HeliosDoc, now = new Date()): Promise<{ lines: string[]; ai: boolean }> {
  if (!picks.length) return { lines: [], ai: false };
  // Charged to the sweep's own day - the 40-a-day budget is counted per day.
  if (write && spend(d, 1, now)) {
    const name = departmentById(dept)?.name ?? dept;
    try {
      const text = await write(
        [
          `You are Helios, the background researcher feeding the ${name} department of a personal assistant for a 14-year-old in Calgary (soccer player, grade 9, loves history and games).`,
          'From the headlines below, write 2 to 4 short bullet lines ("- ") on what is worth his attention and why, each ending with the source in brackets. Use only what the headlines say - never invent details, dates or scores.',
          requests.length ? `Standing requests to watch for: ${requests.join('; ')}.` : '',
          'No intro, no sign-off.',
        ].filter(Boolean).join('\n'),
        picks.map((p) => `- ${p.title} [${p.source}]${p.link ? ` <${p.link}>` : ''}`).join('\n'),
      );
      const lines = text.split('\n').map((l) => l.trim()).filter((l) => /^[-*]\s/.test(l)).map((l) => `- ${l.replace(/^[-*]\s+/, '')}`).slice(0, 5);
      if (lines.length) return { lines, ai: true };
    } catch { /* no cloud brain right now - the headline version below */ }
  }
  return { lines: plainBrief(picks), ai: false };
}

/** Writes today's intel note: one "## Department" section each, the latest sweep on top. */
function writeIntel(day: string, sections: Record<string, string[]>, label: string): void {
  const rel = `Intel/${day}.md`;
  const before = readNote(rel) ?? `---\nprivate: true\nsource: Helios\n---\n\n# Intel - ${day}\n`;
  let text = before;
  for (const [name, lines] of Object.entries(sections)) {
    if (!lines.length) continue;
    const block = `### ${label}\n${lines.join('\n')}\n`;
    const head = new RegExp(`^## ${name}[ \\t]*$`, 'm');
    if (head.test(text)) text = text.replace(head, `## ${name}\n\n${block}`);
    else text = `${text.trimEnd()}\n\n## ${name}\n\n${block}`;
  }
  writeNote(rel, text);
}

/** A sweep: every built department's picks written up into today's intel. */
export async function sweep(kind: string, write: Writer | null, now = new Date()): Promise<{ departments: number; ai: number }> {
  const d = load();
  const day = isoDay(now);
  const sections: Record<string, string[]> = {};
  let ai = 0;
  let count = 0;
  for (const dep of builtDepartments()) {
    const reqs = d.requests.filter((r) => r.dept === dep.id).map((r) => r.what);
    const r = await brief(dep.id, picksFor(d, dep.id, now.getTime()), reqs, write, d, now);
    if (r.ai) ai++;
    if (r.lines.length) { sections[dep.name] = r.lines; count++; }
  }
  const label = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')} ${kind} sweep`;
  if (count) writeIntel(day, sections, label);
  d.sweeps.push(`${day} ${kind}`);
  d.log.push({ at: now.getTime(), text: count ? `${kind[0].toUpperCase()}${kind.slice(1)} sweep: intel written for ${Object.keys(sections).join(', ')}${ai ? ` (${ai} with AI)` : ' (headlines - no cloud brain free)'}.` : `${kind[0].toUpperCase()}${kind.slice(1)} sweep: nothing new worth writing up.` });
  save(d, now.getTime());
  return { departments: count, ai };
}

/** Which sweep is due now, if any (the latest one passed today and not yet done). Pure. */
export function dueSweep(d: Pick<HeliosDoc, 'sweeps'>, now = new Date()): 'morning' | 'afternoon' | 'evening' | null {
  const mins = now.getHours() * 60 + now.getMinutes();
  const day = isoDay(now);
  const passed = SWEEPS.filter((s) => mins >= s.at);
  const last = passed[passed.length - 1];
  return last && !d.sweeps.includes(`${day} ${last.name}`) ? last.name : null;
}

export function nextSweepAt(d: Pick<HeliosDoc, 'sweeps'>, now = new Date()): number {
  const day = isoDay(now);
  for (const s of SWEEPS) {
    const at = new Date(now); at.setHours(Math.floor(s.at / 60), s.at % 60, 0, 0);
    if (at.getTime() > now.getTime() && !d.sweeps.includes(`${day} ${s.name}`)) return at.getTime();
  }
  const t = new Date(now.getTime() + 86_400_000); t.setHours(7, 0, 0, 0);
  return t.getTime();
}

export function status(now = new Date()): { budget: { used: number; cap: number }; nextSweep: number; lastPull: number; requests: HeliosDoc['requests']; log: HeliosDoc['log']; today: number } {
  const d = load();
  const start = new Date(now); start.setHours(0, 0, 0, 0);
  return {
    budget: { used: budgetToday(d, now), cap: DAILY_BUDGET },
    nextSweep: nextSweepAt(d, now),
    lastPull: d.lastPull,
    requests: d.requests,
    log: d.log.filter((l) => l.at >= start.getTime()).slice(-30),
    today: d.items.filter((i) => i.at >= start.getTime() - 12 * 3600_000).length,
  };
}

let timer: ReturnType<typeof setInterval> | null = null;
let busyRun = false;

/** Runs while Ultron is idle: an hourly pull, and the day's sweeps when their time has come. */
export function startHelios(opts: { busy: () => boolean; write: Writer }): void {
  if (timer) return;
  const tick = async () => {
    if (busyRun || opts.busy() || (getSettings() as { helios?: { on?: boolean } }).helios?.on === false) return;
    busyRun = true;
    try {
      const d = load();
      if (Date.now() - d.lastPull > 55 * 60_000) await pull();
      const due = dueSweep(load());
      if (due && !opts.busy()) await sweep(due, opts.write);
    } catch { /* a bad hour - try again next tick */ } finally {
      busyRun = false;
    }
  };
  setTimeout(() => void tick(), 4 * 60_000);
  timer = setInterval(() => void tick(), 10 * 60_000);
}
