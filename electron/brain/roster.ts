import { AGENTS, SPECIALISTS } from './agents';
import { actsInApp } from './intent';
import type { PlanStep } from './plan';
import type { AgentId, JsonSchema, ToolSpec } from './types';
import type { Department } from '../departments/registry';

/*
 * Who a team run may assign, as data: the shared team for Ultron's own runs, or a
 * department's head and experts plus the shared team. One engine (team.ts) runs both -
 * these build its plan and review schemas and check what the planner sends back.
 */

export const ASSEMBLE_TEAM: ToolSpec = {
  name: 'assemble_team',
  description: 'Hand a task to your specialist team (web research, the operator\'s files/PC, their connected apps, tasks/reminders, long-term memory, analysis). They plan, work in parallel, and report back to you.',
  parameters: {
    type: 'object',
    properties: {
      objective: { type: 'string', description: 'The complete objective with every detail the team needs: what, who, when, where, constraints, and what the finished result should be.' },
      specialist: {
        type: 'string',
        enum: SPECIALISTS,
        description: 'Optional, and much faster: if ONE specialist can clearly do the whole job, name them to skip planning (argus = web research or browsing, hephaestus = files/PC, hermes = connected apps and D2L, chronos = tasks/reminders, mnemosyne = memory, athena = analysis, daedalus = doing or building things on websites). Leave empty when the job needs several of them.',
      },
    },
    required: ['objective'],
  },
};

/** Offered to Ultron only once at least one department is built. */
export function consultDepartmentSpec(depts: Department[]): ToolSpec {
  return {
    name: 'consult_department',
    description: 'Hand something to one of your departments. Each has a head, its own experts, its own data and memory, and borrows your shared team when it needs to.',
    parameters: {
      type: 'object',
      properties: {
        department: {
          type: 'string',
          enum: depts.map((d) => d.id),
          description: depts.map((d) => `${d.id} = ${d.head.name}'s department: ${[d.head, ...d.specialists].map((m) => m.job).join('; ')}`).join('. '),
        },
        objective: { type: 'string', description: 'The complete request with every detail the department needs.' },
        quick: { type: 'boolean', description: 'true for a simple question the head can answer alone from the department\'s own data, in seconds ("what should I eat before practice?", "how did I sleep this week?"). Leave it off for real work: a new plan, research, anything with several parts.' },
      },
      required: ['department', 'objective'],
    },
  };
}

export function planSchema(roster: AgentId[]): JsonSchema {
  return {
    type: 'object',
    properties: {
      steps: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            agent: { type: 'string', enum: roster },
            task: { type: 'string' },
            depends_on: { type: 'array', items: { type: 'string' } },
            done_when: { type: 'string' },
          },
          required: ['id', 'agent', 'task'],
        },
      },
      review: { type: 'boolean' },
      note: { type: 'string' },
    },
    required: ['steps'],
  };
}

export function reviewSchema(roster: AgentId[]): JsonSchema {
  return {
    type: 'object',
    properties: {
      verdict: { type: 'string', enum: ['pass', 'revise'] },
      issues: { type: 'array', items: { type: 'string' } },
      followups: {
        type: 'array',
        items: {
          type: 'object',
          properties: { agent: { type: 'string', enum: roster }, task: { type: 'string' } },
          required: ['agent', 'task'],
        },
      },
    },
    required: ['verdict'],
  };
}

export function guessAgent(text: string, apps: string[] = []): AgentId {
  // Making something in a connected app is done through the app, not a browser.
  if (actsInApp(text, apps)) return 'hermes';
  const t = text.toLowerCase();
  if (/\b(build|make|create|design|draw|fill (in|out)|write)\b.*\b(on|in|at|using)\s+(canva|figma|codepen|jsfiddle|playcode|w3schools|excalidraw|google (docs|slides|sheets)|notion|wix|a website|the website|the site)\b/.test(t)) return 'daedalus';
  if (/\b(email|gmail|inbox|calendar|event|drive|docs?|sheet|slides|notion|spotify|song|playlist|github|repo|discord|classroom)\b/.test(t)) return 'hermes';
  if (/\b(file|folder|downloads|desktop|documents|organi[sz]e|rename|pc|computer|disk)\b/.test(t)) return 'hephaestus';
  if (/\b(remind|task|todo|to-do|schedule|deadline|plan my)\b/.test(t)) return 'chronos';
  if (/\b(remember|recall|memory|what did i)\b/.test(t)) return 'mnemosyne';
  return 'argus';
}

/**
 * The planner's JSON, made safe: only agents on the roster, unique ids, no dependency on a
 * missing or later step. An empty plan falls back to one step for the likeliest agent -
 * the department's head on a department run.
 */
export function sanitizePlan(
  raw: { steps?: unknown[]; review?: boolean; note?: string } | null,
  objective: string,
  apps: string[] = [],
  roster: AgentId[] = SPECIALISTS,
  fallback?: AgentId,
): { steps: PlanStep[]; review: boolean; note: string } {
  const steps: PlanStep[] = [];
  const ids = new Set<string>();
  for (const item of (raw?.steps ?? []).slice(0, 7)) {
    const s = item as { id?: unknown; agent?: unknown; task?: unknown; depends_on?: unknown; done_when?: unknown };
    const agent = String(s.agent ?? '').toLowerCase() as AgentId;
    const task = typeof s.task === 'string' ? s.task.trim() : '';
    if (!roster.includes(agent) || !AGENTS[agent] || !task) continue;
    let id = typeof s.id === 'string' && s.id.trim() ? s.id.trim() : `s${steps.length + 1}`;
    if (ids.has(id)) id = `s${steps.length + 1}`;
    ids.add(id);
    const deps = Array.isArray(s.depends_on) ? s.depends_on.filter((d): d is string => typeof d === 'string') : [];
    const doneWhen = typeof s.done_when === 'string' && s.done_when.trim() ? s.done_when.trim().slice(0, 240) : undefined;
    steps.push({ id, agent, task, dependsOn: deps, doneWhen });
  }
  for (const st of steps) st.dependsOn = st.dependsOn.filter((d) => d !== st.id && ids.has(d));
  // Break any dependency cycle by dropping edges that point forward in the list.
  const order = new Map(steps.map((s, i) => [s.id, i]));
  for (const st of steps) st.dependsOn = st.dependsOn.filter((d) => (order.get(d) ?? 0) < (order.get(st.id) ?? 0));
  if (!steps.length) steps.push({ id: 's1', agent: fallback ?? guessAgent(objective, apps), task: objective, dependsOn: [] });
  return { steps, review: Boolean(raw?.review) || steps.length >= 2, note: typeof raw?.note === 'string' ? raw.note : '' };
}

/** Review follow-ups for agents on this run's roster only. */
export function onRoster<T extends { agent?: string }>(items: T[], roster: AgentId[]): T[] {
  return items.filter((f) => roster.includes(f.agent as AgentId));
}
