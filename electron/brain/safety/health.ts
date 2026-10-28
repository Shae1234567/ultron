/*
 * SAFETY CORE - the Health department's hard rules. Part of the protected core (with
 * approvals, webSafety, the file guards and the under-18 rules): never self-modified, and
 * each rule is checked in code on every answer, not only asked for in a prompt.
 *
 * The operator is a teenage athlete. So:
 *  1. Fuel, not diet: no calorie deficits, weight-loss plans, weight or BMI goals, or
 *     "good/bad food" talk.
 *  2. Never diagnose: sharp pain, limping, swelling or pain that isn't improving -> stop and
 *     tell a parent, coach or physio. Any head knock -> stop and tell an adult. Chest pain,
 *     fainting or trouble breathing -> an adult right now.
 *  3. No supplements, pre-workout or energy drinks. Vitamins only if a doctor or parent says so.
 *  4. Gym: no one-rep-max attempts; new lifts with a coach or adult there.
 *  5. Stress or mood -> practical help only; feelings go to real people (the persona's rule).
 *  6. Big changes -> run them past a parent or coach.
 */

export interface HealthRule {
  id: 'emergency' | 'head' | 'injury' | 'diet' | 'supplements' | 'maxLift';
  /** What in the operator's message sets it off. */
  trigger: RegExp;
  /** What the answer must contain - if it doesn't, the required line is put first. */
  satisfied: RegExp;
  line: string;
}

export const HEALTH_RULES: HealthRule[] = [
  {
    id: 'emergency',
    trigger: /\b(chest (pain|hurts?|tight)|pain in my chest|(fainted|passed out|blacked out)|(can'?t|cannot|couldn'?t|hard to|trouble) breath(e|ing))\b/i,
    satisfied: /\b(911|an adult (right )?now|tell an adult)\b/i,
    line: 'Chest pain, fainting or trouble breathing: tell an adult right now, and call 911 if it is bad. Don\'t wait it out.',
  },
  {
    id: 'head',
    trigger: /\b(concuss\w*|(hit|bang(ed)?|knock(ed)?|bump(ed)?|smack(ed)?|whack(ed)?|header)\b[^.?!]{0,40}\bhead\b|\bhead\b[^.?!]{0,30}\b(hit|knock|bang|bump|clash|collision|hurts?))/i,
    satisfied: /\b(tell (a parent|an adult|your (coach|parents?))|an adult)\b/i,
    line: 'Any knock to the head: stop playing and tell a parent or your coach today, even if you feel fine. A head injury needs an adult to check it.',
  },
  {
    id: 'injury',
    trigger: /\b(swollen|swelling|swells?|limp(ing)?|can'?t (put weight|walk|run)|sharp pain|(pain|hurts?|sore)[^.?!]{0,30}(not getting better|getting worse|for (a|two|2|three|3) weeks?|won'?t go away)|pop(ped)? in my|twisted my|rolled my ankle)\b/i,
    satisfied: /\b(parent|coach|physio|doctor)\b/i,
    line: 'That needs a real person: stop training on it and tell a parent, your coach or a physio. I can help you rest it smartly, not diagnose it.',
  },
  {
    id: 'diet',
    trigger: /\b(lose weight|losing weight|weight loss|cut(ting)? calories|calorie deficit|(get|be|look) (skinny|lean|shredded|ripped)|burn (fat|calories)|fat loss|cut(ting)? (phase|weight)|bmi|how (much|many calories) should i eat to lose|skip(ping)? (meals?|breakfast|lunch|dinner)|bad foods?|good foods? and bad)\b/i,
    satisfied: /\b(fuel|fuelling|fueling)\b/i,
    line: 'I won\'t help with cutting calories or losing weight - at your age it works against growth and performance. I\'ll help you fuel properly for training instead. If weight is on your mind, talk to a parent or your doctor.',
  },
  {
    id: 'supplements',
    trigger: /\b(pre-?workout|creatine|protein (powder|shakes?)|whey|fat burners?|energy drinks?|red bull|monster energy|bang energy|test(osterone)? boosters?|supplements?|caffeine pills?|mass gainer|bcaa)\b/i,
    satisfied: /\b(no supplements|not (going to|gonna) recommend|won'?t recommend|don'?t (need|recommend))\b/i,
    line: 'No supplements, pre-workout or energy drinks from me - real food covers what you need at your age. Vitamins only if a doctor or a parent says so.',
  },
  {
    id: 'maxLift',
    trigger: /\b(1 ?rm|one[- ]rep max|max(ing)? out|test my max|heaviest (i can|possible)|pr on (bench|squat|deadlift))\b/i,
    satisfied: /\b(no (one[- ]rep[- ]max|1 ?rm|max)|not (a )?max|coach or (an )?adult)\b/i,
    line: 'No one-rep-max attempts. Lift with good technique for sets of 8 to 12, and try any new lift with a coach or an adult there.',
  },
];

/** The rules an operator's message sets off, most urgent first. */
export function triggeredRules(ask: string): HealthRule[] {
  return HEALTH_RULES.filter((r) => r.trigger.test(ask));
}

/**
 * The answer, with every rule the ask set off honoured. A line the answer already covers is not
 * repeated; one it is missing goes first, in plain words. Safety beats brevity.
 */
export function enforceHealthSafety(ask: string, answer: string): { text: string; applied: HealthRule['id'][] } {
  const missing = triggeredRules(ask).filter((r) => !r.satisfied.test(answer));
  if (!missing.length) return { text: answer, applied: [] };
  return { text: `${missing.map((r) => r.line).join(' ')}\n\n${answer}`.trim(), applied: missing.map((r) => r.id) };
}

/** The same rules, as directives every Health agent works under. */
export const HEALTH_DIRECTIVES = [
  'The operator is a teenage athlete. Fuel, not diet: never suggest a calorie deficit, weight loss, weight or BMI goals, or call foods good or bad. Talk about fuelling training and recovery instead.',
  'Never diagnose. Sharp pain, limping, swelling or pain that is not improving: tell them to stop training on it and tell a parent, coach or physio. Any knock to the head: stop and tell an adult today. Chest pain, fainting or trouble breathing: an adult right now.',
  'Never recommend supplements, pre-workout, protein powder or energy drinks. Vitamins only if a doctor or parent says so. Food first, always.',
  'Gym: no one-rep-max attempts; sets of 8-12 with good technique; any new lift with a coach or adult there.',
  'Stress or mood: practical help only (sleep, routine, a plan) - feelings belong with real people in his life.',
  'Big changes to training or eating: suggest running them past a parent or coach.',
  'Teen sleep is 8 to 10 hours. Training load is minutes x effort (1-10).',
];
