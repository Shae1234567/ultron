import { readDoc, writeDoc } from '../../store';
import { emit } from '../../brain/events';
import { readNote, safeName, writeNote } from '../../memory/vault';

/*
 * The History department's own record: deep-dives (started, finished - its "is it helping?"
 * number), and which stories of the day were already told. The writing itself lives in the
 * vault as History/<Topic>.md (not private - this is his hobby, not his data), readable in
 * Obsidian next to everything else.
 */

export interface DeepDive { topic: string; rel: string; empire?: string; status: 'started' | 'finished'; started: number; finished?: number; sections: string[] }
export interface HistoryDoc { v: 1; dives: DeepDive[]; told: string[] }

const DOC = 'departments/history.json';
export const EMPIRES = ['Mongol Empire', 'Roman Empire', 'Napoleonic Empire', 'Mughal Empire', 'Ottoman Empire'];

export function load(): HistoryDoc {
  const d = readDoc<Partial<HistoryDoc>>(DOC, { v: 1, dives: [], told: [] });
  return { v: 1, dives: Array.isArray(d.dives) ? d.dives : [], told: Array.isArray(d.told) ? d.told : [] };
}
function save(d: HistoryDoc): void {
  writeDoc(DOC, { ...d, told: d.told.slice(-400) });
  emit('history:changed', { at: Date.now() });
}

export const diveRel = (topic: string) => `History/${safeName(topic)}.md`;

export function startDive(topic: string, empire?: string, now = Date.now()): DeepDive {
  const d = load();
  const t = topic.trim().slice(0, 80);
  const have = d.dives.find((x) => x.topic.toLowerCase() === t.toLowerCase());
  if (have) return have;
  const dive: DeepDive = { topic: t, rel: diveRel(t), empire: empire?.trim() || undefined, status: 'started', started: now, sections: [] };
  if (!readNote(dive.rel)) {
    writeNote(dive.rel, `---\nsource: History department\nempire: "${(dive.empire ?? '').replace(/"/g, "'")}"\nstarted: ${new Date(now).toISOString().slice(0, 10)}\nstatus: started\n---\n\n# ${t}\n`);
  }
  d.dives.push(dive);
  save(d);
  return dive;
}

/** Adds or replaces one "## Section" of a deep-dive note. */
export function writeSection(topic: string, section: string, content: string): DeepDive | { error: string } {
  const d = load();
  const dive = d.dives.find((x) => x.topic.toLowerCase() === topic.trim().toLowerCase());
  if (!dive) return { error: `No deep-dive called "${topic}" - start it first.` };
  const name = section.trim().replace(/^#+\s*/, '').slice(0, 60);
  if (!name) return { error: 'Which section?' };
  const before = readNote(dive.rel) ?? `# ${dive.topic}\n`;
  const block = `## ${name}\n\n${content.trim().slice(0, 20_000)}\n`;
  const re = new RegExp(`^## ${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[ \\t]*\\n[\\s\\S]*?(?=^## |(?![\\s\\S]))`, 'm');
  const after = re.test(before) ? before.replace(re, `${block}\n`) : `${before.trimEnd()}\n\n${block}`;
  writeNote(dive.rel, after);
  if (!dive.sections.includes(name)) dive.sections.push(name);
  save(d);
  return dive;
}

export function finishDive(topic: string, now = Date.now()): DeepDive | { error: string } {
  const d = load();
  const dive = d.dives.find((x) => x.topic.toLowerCase() === topic.trim().toLowerCase());
  if (!dive) return { error: `No deep-dive called "${topic}".` };
  dive.status = 'finished';
  dive.finished = now;
  const text = readNote(dive.rel);
  if (text) writeNote(dive.rel, text.replace(/^status: started$/m, `status: finished ${new Date(now).toISOString().slice(0, 10)}`));
  save(d);
  return dive;
}

export function markTold(key: string): void {
  const d = load();
  if (!d.told.includes(key)) { d.told.push(key); save(d); }
}

/** History's number: deep-dives finished (this month, and all time). Pure. */
export function historyNumber(d: HistoryDoc, now = Date.now()): { month: number; total: number; open: DeepDive[] } {
  const start = new Date(now); start.setDate(1); start.setHours(0, 0, 0, 0);
  return {
    month: d.dives.filter((x) => x.status === 'finished' && (x.finished ?? 0) >= start.getTime()).length,
    total: d.dives.filter((x) => x.status === 'finished').length,
    open: d.dives.filter((x) => x.status === 'started'),
  };
}

export function historySnapshotText(d: HistoryDoc = load(), now = Date.now()): string {
  const n = historyNumber(d, now);
  return [
    'HISTORY DATA:',
    `- His top five, by entertainment value: ${EMPIRES.join(', ')} (Tang, Byzantine and Sengoku-Meiji Japan as honourable mentions). History is his hobby - stories, battles, drama - not schoolwork.`,
    `- Deep-dives: ${n.total} finished (${n.month} this month)${n.open.length ? `; in progress: ${n.open.map((x) => `${x.topic}${x.sections.length ? ` (${x.sections.join(', ')})` : ''}`).join('; ')}` : '; none in progress'}.`,
    '- His notes: deep-dives are in the vault under History/; the HQ history folder has his empire rankings.',
  ].join('\n');
}
