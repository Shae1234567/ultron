import type { DepartmentId } from '../brain/types';
import type { FeedItem } from './feeds';

/*
 * Helios' hourly triage, without a model: every item is scored for each department from the
 * department's own words, the operator's interests and the standing requests. No GPU, no quota,
 * nothing sent anywhere - the AI is spent only on the few items worth a sentence.
 */

export const DEPT_WORDS: Record<DepartmentId, string[]> = {
  health: ['soccer', 'football', 'badminton', 'training', 'injury', 'injuries', 'hamstring', 'acl', 'concussion', 'sleep', 'nutrition', 'youth', 'academy', 'calgary', 'cavalry', 'canada', 'canadian', 'cpl', 'mls', 'premier league', 'champions league', 'world cup', 'fitness', 'sprint', 'recovery', 'transfer'],
  school: ['science', 'study', 'students', 'school', 'math', 'biology', 'space', 'physics', 'chemistry', 'discovery', 'research', 'climate', 'alberta', 'calgary', 'education', 'cells', 'energy', 'planet', 'nasa', 'canada'],
  media: ['game', 'games', 'release', 'trailer', 'update', 'patch', 'minecraft', 'roblox', 'steam', 'epic', 'free', 'season', 'total war', 'civilization', 'assassin', 'fortnite', 'playstation', 'ps5', 'xbox', 'nintendo', 'sequel', 'netflix', 'movie', 'series'],
  history: ['empire', 'emperor', 'battle', 'war', 'dynasty', 'mongol', 'genghis', 'khan', 'roman', 'rome', 'caesar', 'napoleon', 'mughal', 'akbar', 'ottoman', 'sultan', 'ancient', 'medieval', 'archaeolog', 'conquest', 'siege', 'legion', 'army', 'kingdom', 'treaty', 'revolution'],
  projects: ['ai', 'open source', 'javascript', 'typescript', 'electron', 'python', 'app', 'tool', 'launch', 'show hn', 'agent', 'llm', 'game dev', 'website'],
};

/** Grim on-this-day entries (crimes, disasters with deaths) aren't "a story of the day" for a 14-year-old. */
const GRIM = /\b(murder(ed)?|abduct(ed|ion)|massacre|rape|lynch|execution of|serial killer|suicide|terror(ist)? attack|school shooting)\b/i;

const words = (s: string) => s.toLowerCase();
const hits = (text: string, list: string[]) => list.filter((w) => (w.length <= 3 ? new RegExp(`\\b${w}\\b`).test(text) : text.includes(w)));

/** 0..1 for one department. Matches on the department's words count most; interests and requests lift it. Pure. */
export function scoreItem(item: Pick<FeedItem, 'title' | 'summary' | 'at'>, dept: DepartmentId, interests: string[] = [], requests: string[] = [], now = Date.now()): { score: number; matched: string[] } {
  const text = words(`${item.title} ${item.summary}`);
  if (GRIM.test(text)) return { score: 0, matched: [] };
  const own = hits(text, DEPT_WORDS[dept]);
  const mine = hits(text, interests.map(words).filter((w) => w.length > 2));
  const asked = requests.map(words).filter((r) => r.split(/\s+/).filter((w) => w.length > 2).every((w) => text.includes(w)));
  let score = Math.min(0.6, own.length * 0.2) + Math.min(0.3, mine.length * 0.15) + (asked.length ? 0.5 : 0);
  // Fresh news matters more; anything over three days old fades.
  if (item.at) score *= Math.max(0.4, 1 - Math.max(0, now - item.at) / (3 * 86_400_000));
  return { score: Math.round(Math.min(1, score) * 100) / 100, matched: [...new Set([...own, ...mine, ...asked])].slice(0, 6) };
}
