import { AGENTS } from '../agents';
import type { AgentId, ToolSpec } from '../types';
import { V2_TOOLS, workflow } from '../workflow';
import { appTools } from './apps';
import { d2lTools } from './d2l';
import { discordTools } from './discord';
import { addonTools } from './addons';
import { fsTools } from './fs';
import { healthTools } from './health';
import { schoolTools } from './school';
import { readingTools } from './reading';
import { slidesTools } from './slides';
import { intelTools } from './intel';
import { historyTools } from './history';
import { projectTools } from './projects';
import { computerTools } from './computer';
import { mediaTools } from './media';
import { dshTools } from './dsh';
import { memoryTools } from './memory';
import { systemTools } from './system';
import { taskTools } from './tasks';
import { councilTools } from './council';
import type { AgentTool } from './types';
import { webTools } from './web';

export const ALL_TOOLS: AgentTool[] = [...webTools, ...fsTools, ...systemTools, ...appTools, ...discordTools, ...addonTools, ...d2lTools, ...taskTools, ...memoryTools, ...healthTools, ...schoolTools, ...readingTools, ...slidesTools, ...intelTools, ...historyTools, ...projectTools, ...mediaTools, ...dshTools, ...computerTools, ...councilTools];

const byName = new Map(ALL_TOOLS.map((t) => [t.name, t]));

export function getTool(name: string): AgentTool | undefined {
  return byName.get(name);
}

/**
 * The real tools a misnamed call most likely meant, with their required fields: "health_log" ->
 * "health_log_sleep (bed, wake), health_log_training (...)". A small local model that guessed a name
 * gave up and went off course on a bare "Unknown tool" (12 Oct 2026); with the names it corrects itself.
 */
export function nearTools(name: string, allowed: string[] | null): string[] {
  const pool = (allowed ?? ALL_TOOLS.map((t) => t.name)).filter((n) => byName.has(n));
  const want = name.toLowerCase().replace(/[^a-z0-9]+/g, '_');
  const words = want.split('_').filter((w) => w.length > 2);
  const score = (n: string) => {
    if (n.startsWith(want) || want.startsWith(n)) return 3;
    const hit = words.filter((w) => n.includes(w)).length;
    return hit >= 2 ? 2 : hit === 1 && words.length === 1 ? 1 : 0;
  };
  return pool
    .map((n) => ({ n, s: score(n) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s)
    .slice(0, 6)
    .map(({ n }) => {
      const req = (byName.get(n)!.parameters as { required?: string[] }).required ?? [];
      return req.length ? `${n} (${req.join(', ')})` : n;
    });
}

export function toolsFor(agent: AgentId): AgentTool[] {
  const v2 = workflow().newTools;
  return AGENTS[agent].tools
    .filter((n) => v2 || !V2_TOOLS.has(n))
    .map((n) => byName.get(n))
    .filter((t): t is AgentTool => Boolean(t));
}

export function toSpecs(tools: AgentTool[]): ToolSpec[] {
  return tools.map((t) => ({ name: t.name, description: t.description, parameters: t.parameters }));
}

export type { AgentTool, ToolContext } from './types';
