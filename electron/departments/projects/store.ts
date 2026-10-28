import { readDoc, writeDoc } from '../../store';
import { emit } from '../../brain/events';

/*
 * The Projects department's tracker: each project with its goal, status and milestones. A
 * project nobody has touched in two weeks is "stalled" - and Nike asks the honest question:
 * paused on purpose, or abandoned? Both are fine; drifting is the thing to catch.
 */

export type ProjectStatus = 'active' | 'paused' | 'shipped' | 'abandoned';
export interface Milestone { id: string; title: string; due?: string; done?: number }
export interface Project { id: string; name: string; goal: string; status: ProjectStatus; started: number; touched: number; milestones: Milestone[]; notes: string[]; where?: string }
export interface ProjectsDoc { v: 1; projects: Project[] }

const DOC = 'departments/projects.json';
const STALL = 14 * 86_400_000;
const nid = (p: string) => `${p}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;

export function load(): ProjectsDoc {
  const d = readDoc<Partial<ProjectsDoc>>(DOC, { v: 1, projects: [] });
  return { v: 1, projects: Array.isArray(d.projects) ? d.projects : [] };
}
function save(d: ProjectsDoc): void {
  writeDoc(DOC, d);
  emit('projects:changed', { at: Date.now() });
}

export function find(d: ProjectsDoc, name: string): Project | undefined {
  const n = name.trim().toLowerCase();
  return d.projects.find((p) => p.id === name || p.name.toLowerCase() === n) ?? d.projects.find((p) => p.name.toLowerCase().includes(n));
}

export function addProject(name: string, goal: string, where?: string, now = Date.now()): Project | { error: string } {
  const d = load();
  if (!name.trim()) return { error: 'What is the project called?' };
  if (find(d, name)?.name.toLowerCase() === name.trim().toLowerCase()) return { error: `"${name}" is already a project.` };
  const p: Project = { id: nid('p'), name: name.trim().slice(0, 60), goal: goal.trim().slice(0, 300), status: 'active', started: now, touched: now, milestones: [], notes: [], where: where?.trim() || undefined };
  d.projects.push(p);
  save(d);
  return p;
}

export function updateProject(name: string, patch: { status?: string; goal?: string; note?: string; where?: string }, now = Date.now()): Project | { error: string } {
  const d = load();
  const p = find(d, name);
  if (!p) return { error: `No project called "${name}".` };
  if (patch.status && ['active', 'paused', 'shipped', 'abandoned'].includes(patch.status)) p.status = patch.status as ProjectStatus;
  if (patch.goal?.trim()) p.goal = patch.goal.trim().slice(0, 300);
  if (patch.where?.trim()) p.where = patch.where.trim();
  if (patch.note?.trim()) p.notes.push(`${new Date(now).toISOString().slice(0, 10)}: ${patch.note.trim().slice(0, 300)}`);
  p.notes = p.notes.slice(-40);
  p.touched = now;
  save(d);
  return p;
}

export function addMilestone(name: string, title: string, due?: string, now = Date.now()): Project | { error: string } {
  const d = load();
  const p = find(d, name);
  if (!p) return { error: `No project called "${name}".` };
  if (!title.trim()) return { error: 'What is the milestone?' };
  p.milestones.push({ id: nid('m'), title: title.trim().slice(0, 120), due: due && /^\d{4}-\d{2}-\d{2}/.test(due) ? due.slice(0, 10) : undefined });
  p.touched = now;
  save(d);
  return p;
}

export function completeMilestone(name: string, milestone: string, now = Date.now()): Project | { error: string } {
  const d = load();
  const p = find(d, name);
  if (!p) return { error: `No project called "${name}".` };
  const m = p.milestones.find((x) => x.id === milestone || x.title.toLowerCase().includes(milestone.trim().toLowerCase()));
  if (!m) return { error: `No milestone "${milestone}" in ${p.name}.` };
  m.done = now;
  p.touched = now;
  save(d);
  return p;
}

/** Stalled: active, but untouched for two weeks. Pure. */
export const stalled = (p: Project, now = Date.now()) => p.status === 'active' && now - p.touched > STALL;

/** Projects' number: milestones shipped this month vs projects stalled. Pure. */
export function projectsNumber(d: ProjectsDoc, now = Date.now()): { shipped: number; stalled: number; active: number } {
  const start = new Date(now); start.setDate(1); start.setHours(0, 0, 0, 0);
  return {
    shipped: d.projects.flatMap((p) => p.milestones).filter((m) => (m.done ?? 0) >= start.getTime()).length,
    stalled: d.projects.filter((p) => stalled(p, now)).length,
    active: d.projects.filter((p) => p.status === 'active').length,
  };
}

export function projectsSnapshotText(d: ProjectsDoc = load(), now = Date.now()): string {
  if (!d.projects.length) return 'PROJECTS DATA: no projects tracked yet. Ask what he is building or wants to build, then add it with project_add (a name and a one-line goal) and its first milestone.';
  const n = projectsNumber(d, now);
  const line = (p: Project) => {
    const open = p.milestones.filter((m) => !m.done);
    return `${p.name} [${stalled(p, now) ? 'STALLED - untouched 2+ weeks' : p.status}]: ${p.goal}${open.length ? `; next: ${open[0].title}${open[0].due ? ` (by ${open[0].due})` : ''}` : '; no open milestone'}`;
  };
  return [
    `PROJECTS DATA: ${n.active} active, ${n.shipped} milestone${n.shipped === 1 ? '' : 's'} shipped this month, ${n.stalled} stalled.`,
    ...d.projects.filter((p) => p.status !== 'abandoned').slice(0, 12).map((p) => `- ${line(p)}`),
  ].join('\n');
}
