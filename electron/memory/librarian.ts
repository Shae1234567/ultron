import { chatJson } from '../brain/llm';
import { AGENTS } from '../brain/agents';
import { brainRel, rememberInBrain } from '../brain/brains';
import { isPrivateRel } from '../brain/privacy';
import { DEPARTMENT_AGENT_IDS, type AgentId, type JsonSchema } from '../brain/types';
import { getSettings, saveSettings } from '../store';
import { isoDate, listNotes, readNote, similar, writeNote } from './vault';
import { syncIndex } from './semantic';

/*
 * Mnemosyne, the librarian. "Keep adding" makes recall worse over time unless someone tidies,
 * so once a day, while Ultron is idle (at night when it can), she:
 *  - merges facts a note holds twice, keeping the newest wording;
 *  - retires facts a newer fact has overtaken ("Tier 4" once Tier 3 results are in);
 *  - passes a fact one department agent learned to the others who need it;
 * on the brains and memory notes that changed lately. Private notes are only read by a
 * brain trusted with private data.
 */

const JOB = 'librarian';
const RECENT_MS = 8 * 86_400_000;
const MAX_REVIEWS = 12;

const isFact = (l: string) => /^\s*-\s/.test(l);
const factText = (l: string) => l.replace(/^\s*-\s*(\d{4}-\d{2}-\d{2}(?: \(unconfirmed\))?:\s*)?/, '').replace(/\s*\(source: [^)]*\)\s*$/, '').trim();

/** Facts said twice in one section become one - the later (newer) wording stays. */
export function mergeDuplicates(content: string): { content: string; merged: number } {
  const lines = content.split('\n');
  const section: string[] = [];
  let current = '';
  for (const l of lines) {
    if (/^## /.test(l)) current = l;
    section.push(current);
  }
  const drop = new Set<number>();
  for (let i = 0; i < lines.length; i++) {
    if (!isFact(lines[i]) || /^## Corrections\b/.test(section[i])) continue;
    const fi = factText(lines[i]);
    for (let j = i + 1; j < lines.length && j < i + 400; j++) {
      if (section[j] !== section[i] || !isFact(lines[j]) || drop.has(j)) continue;
      if (similar(fi, factText(lines[j]))) { drop.add(i); break; }
    }
  }
  if (!drop.size) return { content, merged: 0 };
  return { content: lines.filter((_, i) => !drop.has(i)).join('\n'), merged: drop.size };
}

const STALE_SCHEMA: JsonSchema = {
  type: 'object',
  properties: { stale: { type: 'array', items: { type: 'object', properties: { old: { type: 'string' }, newer: { type: 'string' } }, required: ['old', 'newer'] } } },
  required: ['stale'],
};

/** Asks a model which facts a newer fact in the same note has overtaken, and retires them. */
export async function retireStale(rel: string): Promise<number> {
  const content = readNote(rel);
  if (!content) return 0;
  const facts = content.split('\n').filter(isFact).map((l) => l.trim());
  if (facts.length < 2) return 0;
  const r = await chatJson<{ stale?: { old?: string; newer?: string }[] }>({
    system: [
      'You are Mnemosyne, the librarian of an AI assistant\'s memory. Below are the dated facts from one note, oldest first.',
      'List the facts that a NEWER fact in the same list has clearly overtaken - the same thing, changed since (a new team tier, a new bedtime, a plan that was replaced, a result that came in).',
      'Only when the newer fact plainly replaces the older one. Two facts that can both be true are not stale. When unsure, leave it.',
      'Copy "old" and "newer" exactly as written in the list, without the date. Return {"stale": []} when nothing is overtaken.',
    ].join('\n'),
    messages: [{ role: 'user', content: facts.slice(-120).join('\n') }],
    schema: STALE_SCHEMA,
    temperature: 0,
    tier: 'fast',
    effort: 'low',
    private: isPrivateRel(rel),
  });
  let next = content;
  let retired = 0;
  const reasons: string[] = [];
  for (const s of (r?.stale ?? []).slice(0, 10)) {
    const old = String(s.old ?? '').trim();
    const newer = String(s.newer ?? '').trim();
    if (old.length < 4 || !newer || similar(old, newer)) continue;
    // The newer fact must really be in the note, and come after the old one.
    const lines = next.split('\n');
    const oi = lines.findIndex((l) => isFact(l) && factText(l) === old);
    const ni = lines.findIndex((l) => isFact(l) && factText(l) === newer);
    if (oi < 0 || ni <= oi) continue;
    lines.splice(oi, 1);
    next = lines.join('\n');
    reasons.push(newer.slice(0, 120));
    retired++;
  }
  if (!retired) return 0;
  const today = isoDate();
  if (!/^## Corrections\b/m.test(next)) next = next.replace(/\s*$/, '\n\n## Corrections\n');
  // The retired wording is not kept, so search can't bring it back - only what replaced it.
  next = next.replace(/\s*$/, '\n') + `- ${today}: the librarian retired ${retired} fact${retired > 1 ? 's' : ''} a newer one overtook (now: ${reasons.join('; ')})\n`;
  writeNote(rel, next.replace(/^updated: .*$/m, `updated: ${today}`));
  return retired;
}

const SHARE_SCHEMA: JsonSchema = {
  type: 'object',
  properties: { share: { type: 'array', items: { type: 'object', properties: { fact: { type: 'string' }, to: { type: 'array', items: { type: 'string' } } }, required: ['fact', 'to'] } } },
  required: ['share'],
};

/** Facts one department agent learned that another needs ("games are Saturday mornings" - Hypnos and Achilles). */
export async function shareAcross(agent: AgentId, others: AgentId[]): Promise<number> {
  const content = readNote(brainRel(agent));
  if (!content || !others.length) return 0;
  const facts = content.split('\n').filter(isFact).map(factText).slice(-60);
  if (!facts.length) return 0;
  const r = await chatJson<{ share?: { fact?: string; to?: string[] }[] }>({
    system: [
      `You are Mnemosyne, the librarian. These are facts ${AGENTS[agent].name} (${AGENTS[agent].title}) learned about the operator.`,
      'Which of them would another agent below genuinely need to do its own job well? Only clear cases - most facts stay where they are.',
      `Agents: ${others.map((o) => `${o} (${AGENTS[o].summary})`).join('; ')}.`,
      'Copy each fact exactly. Return {"share": []} when none.',
    ].join('\n'),
    messages: [{ role: 'user', content: facts.map((f) => `- ${f}`).join('\n') }],
    schema: SHARE_SCHEMA,
    temperature: 0,
    tier: 'fast',
    effort: 'low',
    private: true,
  });
  let added = 0;
  for (const s of (r?.share ?? []).slice(0, 8)) {
    const fact = String(s.fact ?? '').trim();
    if (!facts.some((f) => f === fact)) continue; // only facts that really are in the brain
    for (const to of (s.to ?? []).map((t) => String(t).toLowerCase() as AgentId)) {
      if (to !== agent && others.includes(to)) added += rememberInBrain(to, [fact], `shared by ${AGENTS[agent].name}`);
    }
  }
  return added;
}

export interface LibrarianReport { merged: number; retired: number; shared: number; notes: number }

/** One round of tidying. */
export async function tidy(now = Date.now()): Promise<LibrarianReport> {
  const recent = listNotes().filter((n) => (n.folder === 'Brains' || n.folder === 'Memory') && now - n.mtime < RECENT_MS);
  const report: LibrarianReport = { merged: 0, retired: 0, shared: 0, notes: 0 };
  const touched = new Set<string>();
  for (const n of recent) {
    const content = readNote(n.rel);
    if (!content) continue;
    const m = mergeDuplicates(content);
    if (m.merged) {
      writeNote(n.rel, m.content);
      report.merged += m.merged;
      touched.add(n.rel);
    }
  }
  for (const n of recent.sort((a, b) => b.mtime - a.mtime).slice(0, MAX_REVIEWS)) {
    // A private note with no trusted brain to read it is simply skipped tonight.
    const retired = await retireStale(n.rel).catch(() => 0);
    if (retired) { report.retired += retired; touched.add(n.rel); }
  }
  const live = DEPARTMENT_AGENT_IDS as readonly AgentId[];
  for (const a of live) {
    const shared = await shareAcross(a, live.filter((o) => o !== a)).catch(() => 0);
    report.shared += shared;
  }
  report.notes = touched.size;
  if (touched.size) await syncIndex([...touched]).catch(() => {});
  return report;
}

/** Due: once a day, at night when the PC is on then - or any time once it has waited two days. */
export function due(now: Date, last: number): boolean {
  const since = now.getTime() - last;
  if (since < 20 * 3600_000) return false;
  const h = now.getHours();
  return h >= 22 || h < 6 || since > 48 * 3600_000;
}

let timer: ReturnType<typeof setInterval> | null = null;
let busy = false;

/** Checks every half hour; tidies only while nothing else is running. */
export function startLibrarian(isRunning: () => boolean): void {
  if (timer) return;
  const tick = async () => {
    if (busy || isRunning() || !due(new Date(), Number(getSettings().jobs[JOB] ?? 0))) return;
    busy = true;
    try {
      await tidy();
      saveSettings({ jobs: { [JOB]: Date.now() } });
    } catch { /* tidying is best-effort; it tries again next time */ } finally {
      busy = false;
    }
  };
  timer = setInterval(() => { void tick(); }, 30 * 60_000);
}
