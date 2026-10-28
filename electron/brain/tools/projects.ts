import { addMilestone, addProject, completeMilestone, load, stalled, updateProject } from '../../departments/projects/store';
import { S, obj, str, type AgentTool } from './types';

/*
 * The Projects department's tracker tools: what he is building, the next milestone, and the
 * honest "paused or abandoned?" when something stalls. Only the tracker is written here; the
 * building itself uses Talos' tools (code, the DeepSeek harness, the shared team).
 */

const brief = (p: { name: string; goal: string; status: string; milestones: { title: string; done?: number; due?: string }[] }) => ({
  name: p.name, goal: p.goal, status: p.status,
  milestones: p.milestones.map((m) => `${m.done ? '[done] ' : ''}${m.title}${m.due ? ` (by ${m.due})` : ''}`),
});

export const projectTools: AgentTool[] = [
  {
    name: 'project_list',
    owner: 'odysseus',
    description: 'Every project he is tracking: goal, status (active, paused, shipped, abandoned), milestones, and which have stalled (untouched for two weeks).',
    parameters: obj({}),
    label: () => 'projects',
    run: async () => {
      const d = load();
      return d.projects.length
        ? { projects: d.projects.map((p) => ({ ...brief(p), stalled: stalled(p) || undefined, notes: p.notes.slice(-3), where: p.where })) }
        : { note: 'No projects yet.' };
    },
  },
  {
    name: 'project_add',
    owner: 'odysseus',
    description: 'Start tracking a project: a short name, the goal in one line ("a website for my history videos"), and optionally where it lives (a folder or link).',
    parameters: obj({ name: S('Short name'), goal: S('One line: what done looks like'), where: S('Optional folder or link') }, ['name', 'goal']),
    label: (a) => `new project ${str(a, 'name')}`,
    writes: true,
    run: async (a) => addProject(str(a, 'name'), str(a, 'goal'), str(a, 'where')),
  },
  {
    name: 'project_update',
    owner: 'odysseus',
    description: 'Update a project: its status (active, paused, shipped, abandoned), its goal, where it lives, or a progress note. Pausing or dropping a project on purpose is fine - say so honestly.',
    parameters: obj({
      name: S('The project'),
      status: S('active, paused, shipped or abandoned', { enum: ['active', 'paused', 'shipped', 'abandoned'] }),
      goal: S('A new goal line'), where: S('Folder or link'), note: S('A progress note'),
    }, ['name']),
    label: (a) => `update ${str(a, 'name')}`,
    writes: true,
    run: async (a) => updateProject(str(a, 'name'), { status: str(a, 'status'), goal: str(a, 'goal'), note: str(a, 'note'), where: str(a, 'where') }),
  },
  {
    name: 'project_milestone',
    owner: 'nike',
    description: 'Add a milestone to a project (small and shippable, with an optional date) or mark one done. Done milestones are the department\'s number.',
    parameters: obj({
      action: S('add or done', { enum: ['add', 'done'] }),
      name: S('The project'),
      milestone: S('For add: what it is; for done: its title (or part of it)'),
      due: S('For add: YYYY-MM-DD (optional)'),
    }, ['action', 'name', 'milestone']),
    label: (a) => `${str(a, 'action')} milestone ${str(a, 'milestone')}`,
    writes: true,
    run: async (a) => (str(a, 'action') === 'done'
      ? completeMilestone(str(a, 'name'), str(a, 'milestone'))
      : addMilestone(str(a, 'name'), str(a, 'milestone'), str(a, 'due'))),
  },
];
