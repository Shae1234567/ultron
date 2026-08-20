import { ultron } from './bridge';
import { toolsForGroups, executeTool } from './tools';

/**
 * Multi-step tool-calling loop, sitting alongside the single-shot path in
 * conversation.ts rather than replacing it. Where conversation.ts pre-fetches
 * one fixed context block before a single reply, this drives Ollama through
 * repeated tool calls until it produces a final answer or the step cap is hit.
 */

export type AgentStep =
  | { kind: 'tool_call'; tool: string; args: Record<string, unknown>; result: unknown }
  | { kind: 'final'; text: string };

type LoopMessage = { role: 'system' | 'user' | 'assistant'; content: string };

export async function runAgentLoop(
  systemPrompt: string,
  userMessage: string,
  toolGroups: string[],
  opts: { model?: string; maxSteps?: number; onStep?: (step: AgentStep) => void } = {},
): Promise<{ ok: boolean; text: string; steps: AgentStep[]; error?: string }> {
  const steps: AgentStep[] = [];
  const maxSteps = opts.maxSteps ?? 6;
  const tools = toolsForGroups(toolGroups);

  const messages: LoopMessage[] = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userMessage },
  ];

  let lastText = '';

  try {
    for (let step = 0; step < maxSteps; step++) {
      const result = await ultron.ollama.once({ messages, model: opts.model, tools } as any);

      if (!result.ok) {
        return { ok: false, text: '', steps, error: result.error };
      }

      lastText = result.text;

      // `toolCalls` is being added to the ollama.once success branch by a parallel
      // change to the bridge type; this cast is temporary and safe to tighten to a
      // real field access once that widening lands.
      const toolCalls = (result as any).toolCalls as { name: string; arguments: Record<string, unknown> }[] | undefined;

      if (toolCalls && toolCalls.length > 0) {
        for (const call of toolCalls) {
          const toolResult = await executeTool(call.name, call.arguments);
          const toolStep: AgentStep = { kind: 'tool_call', tool: call.name, args: call.arguments, result: toolResult };
          steps.push(toolStep);
          opts.onStep?.(toolStep);

          // Ollama's chat API has no dedicated 'tool' role in this codebase's message
          // type, so the call and its result are folded back in as plainly-labeled
          // assistant/user turns instead - a deliberate, compatible choice.
          messages.push({ role: 'assistant', content: 'Calling ' + call.name + '(' + JSON.stringify(call.arguments) + ')' });
          messages.push({ role: 'user', content: 'TOOL RESULT (' + call.name + '): ' + JSON.stringify(toolResult) });
        }
        continue;
      }

      const finalStep: AgentStep = { kind: 'final', text: result.text };
      steps.push(finalStep);
      opts.onStep?.(finalStep);
      return { ok: true, text: result.text, steps };
    }

    return { ok: true, text: lastText || 'Reached the step limit without a final answer.', steps };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return { ok: false, text: '', steps, error: message };
  }
}
