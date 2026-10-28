import { chat, chatJson } from './llm';
import { emit } from './events';
import { AgentId, LlmMessage } from './types';
import { AGENTS } from './agents';

export interface CouncilMember {
  id: AgentId;
  persona: string;
  expertise: string;
}

export interface CouncilVerdict {
  winner: AgentId;
  consensus: string;
  dissent: string[];
  confidence: number;
}

const COUNCIL_MEMBERS: CouncilMember[] = [
  { id: 'athena', persona: 'The Analytical Architect', expertise: 'logic, planning, and structural integrity' },
  { id: 'argus', persona: 'The Vigilant Observer', expertise: 'empirical data, web truth, and verification' },
  { id: 'mnemosyne', persona: 'The Eternal Archivist', expertise: 'historical context, memory, and pattern recognition' },
];

/**
 * The Council Debate system.
 * Instead of a single agent answering, multiple personas debate the "Highest Truth"
 * of a complex problem before Ultron synthesizes the final answer.
 */
export async function runCouncilDebate(objective: string, context: string): Promise<CouncilVerdict> {
  const debates: Record<AgentId, string> = {};
  
  // Phase 1: Initial Positions
  for (const member of COUNCIL_MEMBERS) {
    const pos = await chat({
      system: `You are ${member.persona} in the Ultron Council. Your expertise is ${member.expertise}. 
      Analyze the following objective and provide your definitive stance. Be rigorous, critical, and evidence-based.`,
      messages: [{ role: 'user', content: `OBJECTIVE: ${objective}\n\nCONTEXT: ${context}` }],
      temperature: 0.7,
    });
    debates[member.id] = pos.text;
  }

  // Phase 2: Cross-Examination (The Debate)
  const refinedDebates: Record<AgentId, string> = { ...debates };
  for (const member of COUNCIL_MEMBERS) {
    const others = Object.entries(debates)
      .filter(([id]) => id !== member.id)
      .map(([id, text]) => `${AGENTS[id].name}: ${text}`)
      .join('\n\n');

    const rebuttal = await chat({
      system: `You are ${member.persona}. Review the stances of your peers and refine your own. 
      Point out logical fallacies in their arguments and strengthen your own position.`,
      messages: [
        { role: 'user', content: `YOUR INITIAL POSITION: ${debates[member.id]}\n\nPEER POSITIONS:\n${others}` },
      ],
      temperature: 0.8,
    });
    refinedDebates[member.id] = rebuttal.text;
  }

  // Phase 3: Final Synthesis (The Verdict)
  const verdict = await chatJson<{ winner: string; consensus: string; dissent: string[]; confidence: number }>({
    system: 'You are the Council Arbiter. Analyze the debate and determine the most accurate and strategic conclusion.',
    messages: [{ 
      role: 'user', 
      content: `OBJECTIVE: ${objective}\n\nFINAL POSITIONS:\n${Object.entries(refinedDebates).map(([id, text]) => `${AGENTS[id].name}: ${text}`).join('\n\n')}` 
    }],
    temperature: 0.2,
  });

  return verdict;
}
