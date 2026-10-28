import { chat, chatJson } from '../llm';
import { emit } from '../events';
import { AgentId, ToolContext } from '../types';
import { runCouncilDebate } from '../council';
import type { AgentTool } from './types';

const councilTool: AgentTool = {
  name: 'call_council',
  description: 'Invoke the Council of Truth to debate a complex objective. Use this when there is no single right answer, or when multiple perspectives (analytical, empirical, historical) are needed to find the highest truth.',
  parameters: {
    type: 'object',
    properties: {
      objective: { type: 'string', description: 'The core question or goal to debate' },
      context: { type: 'string', description: 'The current evidence, reports, or context the council should consider' },
    },
    required: ['objective'],
  },
  run: async (args: any, ctx: ToolContext) => {
    const objective = String(args.objective ?? '');
    const context = String(args.context ?? 'No additional context provided.');
    
    emit(ctx.runId, { type: 'action', agent: 'ultron', text: `Calling the Council to debate: ${objective.slice(0, 80)}...`, kind: 'note' });
    
    const verdict = await runCouncilDebate(objective, context);
    
    return {
      winner: verdict.winner,
      consensus: verdict.consensus,
      dissent: verdict.dissent,
      confidence: verdict.confidence,
      report: `COUNCIL VERDICT:\\nWinner: ${verdict.winner}\\nConfidence: ${verdict.confidence * 100}%\\n\\nConsensus:\\n${verdict.consensus}\\n\\nKey Dissenting Views:\\n${verdict.dissent.join('\\n')}`
    };
  },
};

export const councilTools: AgentTool[] = [councilTool];
