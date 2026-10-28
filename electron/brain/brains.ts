import { AGENTS } from './agents';
import { isPrivateRel, WEB_FACING } from './privacy';
import type { AgentId, DepartmentId } from './types';
import { departmentById } from '../departments/registry';
import { isoDate, readNote, similar, writeNote } from '../memory/vault';
import { redactSecrets } from '../memory/redact';
import { searchMemory, syncIndex, type MemoryHit } from '../memory/semantic';
import * as hindsight from '../hindsight';

/*
 * The brains, in three layers, all in Ultron's own vault (readable in Obsidian):
 *  1. Own brain - Brains/<Name>.md, what one agent has learned about the operator in its area.
 *     Always in that agent's prompt; written after a run, confirmed facts only.
 *  2. Department notes - Health/, School/... plans, log summaries, course material.
 *  3. The shared brain - everything: every brain, every department's notes, Helios's intel,
 *     the journal, the profile, and the operator's HQ files (indexed read-only). Searched
 *     before every piece of work.
 * An agent starts work with its own brain + the shared brain's best hits for the task +
 * today's intel for its department, inside a size budget.
 */

export function brainRel(agent: AgentId): string {
  return `Brains/${AGENTS[agent].name}.md`;
}

const LEARNED = '## Learned';

function newBrain(agent: AgentId): string {
  const a = AGENTS[agent];
  const dept = a.department ? departmentById(a.department) : undefined;
  return [
    '---',
    'type: brain',
    `agent: ${a.id}`,
    ...(dept ? [`department: ${dept.id}`] : []),
    `created: ${isoDate()}`,
    `updated: ${isoDate()}`,
    'tags: [ultron/brain]',
    '---',
    `# ${a.name}'s brain`,
    '',
    `What ${a.name} (${a.title}${dept ? `, ${dept.name}` : ''}) has learned about the operator. Confirmed facts only - edit or delete anything here and ${a.name} works from your version.`,
    '',
    LEARNED,
    '',
  ].join('\n');
}

/** The facts in a brain, oldest first, as written ("2026-10-09: ..."). */
function factsIn(content: string): string[] {
  return content.split('\n').filter((l) => /^\s*-\s/.test(l)).map((l) => l.replace(/^\s*-\s*/, '').trim());
}

const factText = (line: string) => line.replace(/^\d{4}-\d{2}-\d{2}:\s*/, '').replace(/\s*\(source: [^)]*\)\s*$/, '');

/** What this agent has learned, newest kept when it is longer than the budget. */
export function readBrain(agent: AgentId, maxChars = 1800): string {
  const content = readNote(brainRel(agent));
  if (!content) return '';
  const facts = factsIn(content);
  const out: string[] = [];
  let used = 0;
  for (let i = facts.length - 1; i >= 0; i--) {
    const line = `- ${facts[i].replace(/\s*\(source: [^)]*\)\s*$/, '')}`;
    if (used + line.length + 1 > maxChars) break;
    out.unshift(line);
    used += line.length + 1;
  }
  return out.join('\n');
}

/**
 * Adds confirmed facts to an agent's own brain. A fact it already holds (in other words) is
 * skipped. Returns how many were added.
 */
export function rememberInBrain(agent: AgentId, facts: string[], source?: string, at = new Date()): number {
  const rel = brainRel(agent);
  let content = readNote(rel) ?? newBrain(agent);
  const have = factsIn(content).map(factText);
  const from = source ? ` (source: ${source})` : '';
  let added = 0;
  for (const raw of facts) {
    const fact = redactSecrets(String(raw).replace(/\s+/g, ' ').trim());
    if (fact.length < 4 || have.some((h) => similar(h, fact))) continue;
    if (!content.includes(LEARNED)) content = content.replace(/\s*$/, `\n\n${LEARNED}\n`);
    content = content.replace(/\s*$/, '\n') + `- ${isoDate(at)}: ${fact}${from}\n`;
    have.push(fact);
    added++;
  }
  if (!added) return 0;
  content = content.replace(/^updated: .*$/m, `updated: ${isoDate(at)}`);
  writeNote(rel, content);
  void syncIndex([rel]).catch(() => {});
  // Its own Hindsight bank too, when that add-on runs - the note stays the source of truth.
  void hindsight.retain(facts.join('\n'), at, `${AGENTS[agent].name}'s brain`, agent).catch(() => {});
  return added;
}

/** For the council panel: how much an agent knows, and the last thing it learned. */
export function brainStats(agent: AgentId): { facts: number; last?: { date: string; text: string } } {
  const facts = factsIn(readNote(brainRel(agent)) ?? '');
  const lastLine = facts[facts.length - 1];
  if (!lastLine) return { facts: 0 };
  const m = /^(\d{4}-\d{2}-\d{2}):\s*(.*)$/.exec(lastLine);
  return { facts: facts.length, last: m ? { date: m[1], text: factText(lastLine) } : { date: '', text: factText(lastLine) } };
}

/** Helios's notes for one department today (Intel/<date>.md, its "## <Department>" section). */
export function intelFor(dept: DepartmentId, at = new Date()): string {
  const content = readNote(`Intel/${isoDate(at)}.md`);
  const name = departmentById(dept)?.name;
  if (!content || !name) return '';
  const start = content.search(new RegExp(`^## ${name}\\b`, 'm'));
  if (start < 0) return '';
  const rest = content.slice(start).split('\n').slice(1).join('\n');
  const end = rest.search(/^## /m);
  return (end < 0 ? rest : rest.slice(0, end)).trim();
}

export interface ContextOptions {
  agent: AgentId;
  task: string;
  /** Characters for the whole block - smaller for the local model. */
  budget?: number;
  /** A web-facing agent only gets private notes when the task itself needs them. */
  allowPrivate?: boolean;
  at?: Date;
  /** For tests: the shared-brain search to use. */
  search?: (q: string, k: number) => Promise<MemoryHit[]>;
}

/** The block an agent starts work with: its own brain, today's intel for its department, and the shared brain's best hits. */
export async function brainContext(o: ContextOptions): Promise<string> {
  const budget = o.budget ?? 3600;
  const a = AGENTS[o.agent];
  const own = readBrain(o.agent, Math.floor(budget * 0.4));
  // What its own Hindsight bank links to this task (nothing when the add-on is off).
  const learned = (await hindsight.recall(o.task, 3, undefined, o.agent).catch(() => []))
    .map((m) => `- ${m.text.replace(/\s+/g, ' ').slice(0, 200)}`)
    .filter((l) => !own.includes(l.slice(2, 60)));
  const intel = a.department ? intelFor(a.department, o.at).slice(0, Math.floor(budget * 0.25)) : '';
  const privateOk = o.allowPrivate ?? !WEB_FACING.has(o.agent);
  const ownRel = brainRel(o.agent);
  const hits = (await (o.search ?? searchMemory)(o.task, 8).catch(() => [] as MemoryHit[]))
    .filter((h) => h.rel !== ownRel && (privateOk || !isPrivateRel(h.rel)));
  const parts: string[] = [];
  if (own || learned.length) parts.push(`YOUR OWN BRAIN (what you have learned about the operator - confirmed facts, newest last):\n${[own, ...learned].filter(Boolean).join('\n')}`);
  if (intel) parts.push(`FROM HELIOS TODAY (${departmentById(a.department!)?.name}):\n${intel}`);
  let left = budget - parts.join('\n\n').length - 120;
  const shared: string[] = [];
  for (const h of hits) {
    const line = `- [${h.rel.replace(/\.md$/, '')}] ${h.text.replace(/\s+/g, ' ').slice(0, 420)}`;
    if (left - line.length < 0) break;
    shared.push(line);
    left -= line.length + 1;
  }
  if (shared.length) parts.push(`FROM THE SHARED BRAIN (other agents' notes, the operator's own files, past conversations):\n${shared.join('\n')}`);
  return parts.join('\n\n');
}
