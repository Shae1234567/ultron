/**
 * CM8's offline coach, ported.
 *
 * This is the keyword-matched knowledge base exactly as CM8 runs it: the same
 * scoring weights, the same 3.5 confidence floor, the same greeting/thanks/
 * follow-up handling, the same second-topic blending and deep dives.
 *
 * In Atlas it is the FLOOR rather than the ceiling. When the local model is
 * running, Cm8Coach sends the question to Atlas's brain with the matched topic
 * as grounding, and this offline answer is what gets shown if the brain is not
 * available. CM8's offline coach never needed a network and neither does this.
 */
import { COACH_KB } from './content';

type KbEntry = (typeof COACH_KB)[number];

export interface CoachAnswer {
  head: string;
  intro?: string;
  points?: readonly string[];
  tail?: string | null;
  cue?: string;
  jump?: readonly string[];
}

export interface CoachReply {
  reply: CoachAnswer | string;
  chips: string[];
  /** The matched topic, so a live model can be grounded in the same material. */
  topic?: KbEntry;
  confident: boolean;
}

const STOPWORDS = new Set(['the', 'a', 'an', 'and', 'or', 'but', 'if', 'to', 'of', 'in', 'on', 'at', 'is', 'are', 'am', 'was', 'were', 'be', 'been', 'do', 'does', 'did', 'i', 'you', 'my', 'me', 'it', 'this', 'that', 'for', 'with', 'so', 'how', 'what', 'when', 'where', 'why', 'can', 'should', 'would', 'could', 'will', 'get', 'got', 'have', 'has', 'had', 'about', 'from', 'then', 'than', 'there', 'their', 'they', 'not', 'no', 'yes', 'just', 'really', 'very', 'some', 'any', 'more', 'most', 'also', 'like', 'need', 'want', 'know', 'think', 'feel', 'make', 'going', 'go']);

function tokenize(s: string): string[] {
  return s.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter((w) => w && !STOPWORDS.has(w));
}

export function scoreTopics(text: string): { entry: KbEntry; score: number }[] {
  const lower = ' ' + text.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ') + ' ';
  const tokens = tokenize(text);
  return COACH_KB.map((entry) => {
    let score = 0;
    for (const k of entry.pri as readonly string[]) {
      if (k.includes(' ')) {
        if (lower.includes(' ' + k + ' ') || lower.includes(' ' + k)) score += 5;
      } else if (tokens.includes(k)) score += 4;
      else if (k.length > 5 && lower.includes(k)) score += 3;
    }
    for (const k of entry.sec as readonly string[]) {
      if (k.includes(' ')) {
        if (lower.includes(k)) score += 2;
      } else if (tokens.includes(k)) score += 1.5;
    }
    return { entry, score };
  }).sort((a, b) => b.score - a.score);
}

const FOLLOWUP = /^(why|how so|how come|more|tell me more|explain|elaborate|go on|details?|go deeper|deeper|and\?|ok\??|okay\??|what else|expand)\b/i;
const GREETING = /^(hi|hey|hello|yo|sup|hiya|good morning|good evening|morning)\b/i;
const THANKS = /\b(thanks|thank you|thx|appreciate|cheers)\b/i;

const SECOND_LABEL: Record<string, string> = {
  passing: 'passing', touch: 'your first touch', weakfoot: 'your weak foot', scanning: 'scanning',
  pressing: 'defending', fitness: 'fitness', speed: 'speed', strength: 'strength work',
  tier: 'moving up a tier', nerves: 'nerves', badgame: 'a rough game', sleep: 'sleep',
  nutrition: 'food', injury: 'an injury', shooting: 'shooting', leadership: 'communication',
  role: 'your position', school: 'school', motivation: 'consistency', film: 'watching film',
  growth: 'growing', gear: 'gear', app: 'this app',
};
const secondLabel = (id: string) => SECOND_LABEL[id] || 'that';

/** One deep dive per topic, then it resets - same as CM8. */
let lastTopic: KbEntry | null = null;
export const resetCoach = () => { lastTopic = null; };

export function offlineReply(text: string): CoachReply {
  const t = text.trim();

  if (THANKS.test(t) && t.length < 40) {
    return {
      reply: "Anytime, Shae. Go put the work in — I'll be here.",
      chips: ['What should I train today?'],
      confident: true,
    };
  }

  if (GREETING.test(t) && t.length < 25) {
    return {
      reply: {
        head: 'Hey Shae.',
        intro: 'What are we working on — passing, pressing, fitness, tiers, food, sleep, or something that happened in a game?',
      },
      chips: ['How do I get to Tier 3?', 'Build me a schedule', 'I had a bad game'],
      confident: true,
    };
  }

  const deep = lastTopic && (lastTopic as { deep?: { head: string; points: readonly string[]; cue?: string } }).deep;
  if (FOLLOWUP.test(t) && lastTopic && deep) {
    const topic = lastTopic;
    lastTopic = null;
    return {
      reply: { head: deep.head, points: deep.points, cue: deep.cue },
      chips: [...((topic as { chips?: readonly string[] }).chips || ['Tell me more'])],
      topic,
      confident: true,
    };
  }

  const scored = scoreTopics(t);
  const top = scored[0];
  const second = scored[1];

  if (!top || top.score < 3.5) {
    // No confident match - ask something genuinely useful rather than bluffing.
    const guesses: string[] = [];
    if (/\b(feel|felt|mind|head|confidence)\b/i.test(t)) guesses.push('the mental side');
    if (/\b(train|session|practice|drill)\b/i.test(t)) guesses.push('your training');
    if (/\b(game|match|played)\b/i.test(t)) guesses.push('a specific match');
    const guessLine = guesses.length ? ' Sounds like it might be about ' + guesses.join(' or ') + ' — is that right?' : '';
    return {
      reply: {
        head: "That's outside what I know offline, Shae.",
        intro: "Right now I'm running on the offline coach, which only covers the topics built into this app." + guessLine + ' Two options:',
        points: [
          'Turn the local brain on and I can answer anything — homework, science, history, whatever.',
          'Or ask me about something I do know offline: passing, touch, scanning, pressing, fitness, speed, tiers and tryouts, nerves, food, sleep, school, and the rest of the programme.',
        ],
      },
      chips: ['Passing and touch', 'Fitness and speed', 'Tier 3 and tryouts', 'Food and sleep'],
      confident: false,
    };
  }

  lastTopic = top.entry;
  const a = top.entry.a as { head: string; points: readonly string[]; cue?: string; jump?: readonly string[] };

  // Multi-topic question: blend in the second topic when it is genuinely close.
  const blend = second && second.score >= 5 && second.score >= top.score * 0.3;
  const tail = blend
    ? 'You also asked about ' + secondLabel((second.entry as { id: string }).id)
      + ' — short version: ' + (second.entry.a as { points: readonly string[] }).points[0]
    : null;

  return {
    reply: { head: a.head, points: a.points, tail, cue: a.cue, jump: a.jump },
    chips: [...((top.entry as { chips?: readonly string[] }).chips || ['Tell me more'])],
    topic: top.entry,
    confident: true,
  };
}

/**
 * Grounding for the live model: the matched topic rendered as source material,
 * so Atlas answers from the same coaching CM8 would give rather than
 * improvising a different opinion.
 */
export function groundingFor(text: string): string {
  const scored = scoreTopics(text);
  const top = scored[0];
  if (!top || top.score < 3.5) return '';
  const a = top.entry.a as { head: string; points: readonly string[]; cue?: string };
  const lines = ['CM8 coaching material for this question:', '- ' + a.head, ...a.points.map((p) => '- ' + p)];
  if (a.cue) lines.push('- ' + a.cue);
  const deep = (top.entry as { deep?: { head: string; points: readonly string[] } }).deep;
  if (deep) lines.push('- ' + deep.head, ...deep.points.map((p) => '- ' + p));
  return lines.join('\n');
}

/** Flatten an answer to plain text, for speech or for a transcript entry. */
export function answerToText(a: CoachAnswer | string): string {
  if (typeof a === 'string') return a;
  const parts = [a.head];
  if (a.intro) parts.push(a.intro);
  if (a.points) parts.push(...a.points);
  if (a.tail) parts.push(a.tail);
  if (a.cue) parts.push(a.cue);
  return parts.join('\n\n');
}
