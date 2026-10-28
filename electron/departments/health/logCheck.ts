/*
 * Did Health really log what he told it? A small local model will happily answer "Logged: 10:30 PM to 7 AM
 * (9 hours)" without running any log tool (12 Oct 2026, the final test) - nothing saved, and the hours wrong.
 * These checks find a reply that claims a log, or a health report nothing logged, so the agent is sent back
 * to log it for real (team.ts, agentLoop).
 */

const CLAIM = /\b(logged|recorded|saved|tracked|added (it|that|this|them|your [a-z]+ )?\s*(to|in)( your)? (log|health|tracker))\b/i;
const NEGATED = /\b(not|no|nothing|never|yet to|cannot|without)\b|n't\b/i;

/** "Logged: 10:30 to 7", "Sleep logged", "I've saved that" - but not "nothing logged yet" or "I couldn't save it". */
export function claimsLogged(reply: string): boolean {
  return reply
    .split(/(?<=[.!?\n])\s+/)
    .some((sentence) => CLAIM.test(sentence) && !NEGATED.test(sentence));
}

const TIME = /\b\d{1,2}(:\d{2})?\s*(am|pm|a\.m\.|p\.m\.)?\b/i;
const SLEEP = /\b(slept|went to (bed|sleep)|fell asleep|woke( up)?|got up|bed at|asleep at)\b/i;
const TRAINING = /\b(practi[cs]e|training|trained|gym|workout|worked out|ran|run|game|match|played|lifted|session)\b/i;
const AMOUNT = /\b\d+\s*(min|mins|minutes|h|hr|hrs|hours?|km|k)\b|\b(hard|easy|brutal|tough|light|intense)\b|\beffort\b/i;
const FOOD = /\b(ate|eaten|drank|for (breakfast|lunch|dinner|a snack))\b|\bi had (a |an |some )?[\w ]{0,25}\b(breakfast|lunch|dinner|snack|meal|sandwich|wrap|pizza|burger|pasta|rice|chicken|salad|eggs?|toast|cereal|oatmeal|yogurt|smoothie|fruit|apple|banana)\b/i;
// The lead's own wording when it hands Health the job: "Log the operator's sleep from 10:30 PM to 7 AM".
const LOG_ASK = /\blog(ging)?\b[\w' ]{0,30}\b(sleep|training|practi[cs]e|session|workout|food|meal|breakfast|lunch|dinner|snack|pain|water)\b/i;
const PAIN = /\b(my \w+ (hurts?|is sore|aches?)|sore|pain|injur(ed|y)|sprain|twisted|rolled my)\b/i;

/** A question isn't a report: "should I sleep at 10?" logs nothing. */
function isQuestion(text: string): boolean {
  const t = text.trim();
  // "did I sleep enough" asks; "did gym for 45 min" reports - a question's helper verb is followed by who it's about.
  return /\?\s*$/.test(t)
    || /^(how|what|when|where|why|which|who|tell me)\b/i.test(t)
    || /^(do|does|did|is|are|was|were|can|could|should|will|would|have|has)\s+(i|you|we|it|my|he|she|they|there|that|this)\b/i.test(t);
}

/** He told Health something to log: sleep times, a session with its length or effort, a meal, a pain. */
export function reportsHealth(text: string): boolean {
  if (isQuestion(text)) return false;
  return (SLEEP.test(text) && TIME.test(text))
    || (TRAINING.test(text) && AMOUNT.test(text))
    || FOOD.test(text)
    || PAIN.test(text)
    || LOG_ASK.test(text);
}

/** The tools that really save to the Health log. */
export function isLogTool(name: string): boolean {
  return /^health_(log_|checkin|usual_meal)/.test(name);
}
