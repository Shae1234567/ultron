import type { AgentPersona } from '../services/ai';

/**
 * A specialist is an AgentPersona plus display metadata for the UI. The
 * persona itself (name/role/directives) is what actually changes model
 * behaviour - everything else here is just for the grid/detail cards.
 */
/**
 * Each value beyond 'persona' maps to a real fetch conversation.ts runs
 * before the model answers - never claim LIVE in the UI for one that isn't
 * wired to an actual dispatch case there.
 */
export type SpecialistCapability =
  | 'persona' | 'research' | 'weather' | 'on-this-day' | 'github' | 'notion'
  // 'agentic' specialists run the multi-step tool-calling loop (see
  // services/agentLoop.ts) instead of the single pre-fetch below - they can
  // actually search the web, open pages, and touch indexed files mid-reply.
  | 'agentic';

export interface Specialist extends AgentPersona {
  /** One line shown on the card - what this specialist is actually for. */
  summary: string;
  capability: SpecialistCapability;
  /** Tool groups this specialist may call, when capability is 'agentic'. See services/tools.ts. */
  tools?: string[];
}
