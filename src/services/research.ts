import { ultron } from './bridge';
import type { ResearchSource } from '../types';

/** Queries Wikipedia, Wikidata, and DuckDuckGo concurrently - real multi-source research. */
export async function researchMulti(query: string): Promise<ResearchSource[]> {
  try {
    return await ultron.research.multi(query);
  } catch {
    return [];
  }
}

/** Formats every source found as a context block the model treats as ground truth. */
export function formatResearchContext(sources: ResearchSource[], query: string): string {
  if (sources.length === 0) {
    return `LIVE RESEARCH: no source found for "${query}" across Wikipedia, Wikidata, or DuckDuckGo. Say plainly you could not verify this rather than inventing an answer.`;
  }
  const blocks = sources.map(
    (s) => `[${s.source}] "${s.title}" (${s.url}):\n${s.summary}`,
  );
  return `LIVE RESEARCH - ${sources.length} source${sources.length === 1 ? '' : 's'} consulted just now:\n\n${blocks.join('\n\n')}`;
}
