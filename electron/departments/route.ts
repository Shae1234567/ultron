import type { DepartmentId } from '../brain/types';

/*
 * Which department a message belongs to, by its words - a hint for Ultron's routing (small
 * local models miss consult_department otherwise) and the signal that a request carries
 * private data from its first word. A miss only costs a hint; Ultron still decides.
 */

const HEALTH = new RegExp([
  // talking to its agents by name
  '\\b(asclepius|achilles|heracles|demeter|hypnos)\\b',
  // sleep
  '\\b(slept|sleep(ing)?|bedtime|went to bed|go to bed|bed (at|around)|woke( up)?|wake up|nap(ped)?|insomnia|tired all)\\b',
  // training
  '\\b(practi[cs]e|training|trained|workout|work out|worked out|gym|lifting|weights|squats?|deadlifts?|bench press|sprints?|conditioning|stretch(ing)?|warm[- ]?up|cool[- ]?down|recovery|game day|tryouts?)\\b',
  // body
  '\\b(sore|soreness|aches?|pain|hurts?|injur(y|ed|ies)|knee|ankle|hamstring|groin|shin splints?|calf|concuss\\w*|sprain(ed)?|swollen|limp(ing)?)\\b',
  // food
  '\\b(ate|eat(ing)?|food|meals?|breakfast|lunch|dinner|snacks?|protein|iron|calcium|vitamin|fib(re|er)|carbs|hydrat\\w*|nutrition|diet|calories?|supplements?|pre-?workout|energy drinks?|creatine)\\b',
].join('|'), 'i');

/*
 * Unmistakably Health's - something to log (sleep with times, a session, a meal, a sore knee) or a
 * question about his own health data. These go straight to Health: in testing (9 Oct 2026) the small
 * local model answered "I slept from 10:30 to 7" itself, got it wrong, and logged nothing.
 * Narrower than HEALTH on purpose: "training a model" or "a pain point" never land here.
 */
const CLEARLY_HEALTH = new RegExp([
  '\\b(asclepius|achilles|heracles|demeter|hypnos)\\b',
  '\\b(i slept|slept (from|at|till|until|for|in|badly|well|\\d)|went to bed|woke up at|bed (at|around) \\d)',
  '\\b(practice|game|gym|workout|training|run|sprints?)\\b[^.?!]{0,40}\\b(\\d+\\s*(min|mins|minutes|hours?|hrs?)|effort|rpe|was (brutal|hard|easy|tough))\\b',
  '\\b(i ate|i had|ate)\\b[^.?!]{0,60}\\b(for )?(breakfast|lunch|dinner|snack)\\b|\\bfor (breakfast|lunch|dinner)\\b',
  '\\b(my|the) (knee|ankle|hamstring|groin|shin|calf|back|shoulder|wrist|foot|hip|head) (is|was|feels|hurts|kills)\\b|\\b(sore|swollen|sprained|concussion|limping)\\b',
  '\\bhow (did|have) i (sleep|slept)|\\bwhat should i eat\\b|\\b(log|logged) (my )?(sleep|training|food|meal)\\b',
  // His gym program (12 Oct 2026): "what's my workout today", "where am I in the program", "fight club build".
  "\\b(what'?s|what is|whats) (my|today'?s) (workout|gym session|lift)\\b|\\b(my|the) (gym|workout|fight club) (program|plan|routine)\\b|\\bfight club (build|program|physique|body)\\b",
].join('|'), 'i');

// School's words. Kept to school things on purpose: "explain" or "a unit of measure" alone must
// not send a general question to a private department (private work runs on trusted brains only).
const SCHOOL = new RegExp([
  /\b(prometheus|chiron|sphinx|kratos)\b/.source,
  /\b(homework|assignments?|worksheets?|lab report|due (today|tomorrow|friday|monday|this week)|overdue|quiz(zes)?|unit test|midterms?|final exam|report card|my (grades?|marks?|teachers?|classes|courses)|d2l|brightspace|powerschool|mycbe)\b/.source,
  /\b(math|science|social studies|ela|french) (class|test|quiz|homework|notes|unit|teacher)\b/.source,
  /\b(studying|study for|revise for|flashcards?|quiz me|procrastinat\w*|can'?t focus|focus session)\b/.source,
].join('|'), 'i');

/*
 * Unmistakably School's: what's due, his marks, his course material, studying for a test, or a
 * School agent by name. These go straight to School, the way logging goes straight to Health.
 */
const CLEARLY_SCHOOL = new RegExp([
  /\b(prometheus|chiron|sphinx|kratos)\b/.source,
  /\bwhat('?s| is| do i have) due\b|\b(my|any) (homework|assignments?|grades?|marks?|quizzes|tests?|report card)\b|\boverdue\b/.source,
  /\b(quiz me|test me|practice (test|questions)|study (plan|for)|help me (study|revise))\b/.source,
  /\b(d2l|brightspace|powerschool|mycbe)\b/.source,
  /\bmy (math|science|social|ela|english|french) (class|unit|test|quiz|notes|homework|teacher)\b/.source,
].join('|'), 'i');

// Media, History and Projects (built 10 Oct 2026). "Atlas" and "Nike" are left out of the name lists on
// purpose: Atlas is also his other agent's name, and Nike is a shoe.
const CLEARLY_MEDIA = new RegExp([
  /\b(dionysus|theseus|morpheus|orpheus)\b/.source,
  /\b(what should i (play|watch)|my (steam|epic) (games|library)|playtime|free games? (on|from) epic|epic free game|patch notes for|new season of|when does .{2,40} come out)\b/.source,
].join('|'), 'i');
const MEDIA = /\b(steam|epic games|video games?|playtime|patch notes|trailer|release date|new season|netflix|spotify playlist|what to watch|game update)\b/i;
const CLEARLY_HISTORY = new RegExp([
  /\b(clio|calliope)\b/.source,
  /\b(deep-?dive (on|into) (the )?\w+|story of the day|on this day in history|history (video|script|channel))\b/.source,
].join('|'), 'i');
const HISTORY = /\b(empire|emperor|dynasty|mongols?|genghis|kublai|napoleon(ic)?|roman (empire|legion)|ottomans?|mughals?|byzantine|samurai|sengoku|medieval|crusades?|battle of|siege of|ancient (rome|greece|egypt)|conquest)\b/i;
const CLEARLY_PROJECTS = new RegExp([
  /\b(odysseus|talos)\b/.source,
  /\b(my (side )?projects?|project (status|tracker)|next milestone|track (a|my|this) project|paused or abandoned)\b/.source,
].join('|'), 'i');
const PROJECTS = /\b(side project|milestones?|ship it|my app idea|startup idea)\b/i;

export function clearlyFor(text: string): DepartmentId | null {
  if (CLEARLY_HEALTH.test(text)) return 'health';
  if (CLEARLY_SCHOOL.test(text)) return 'school';
  if (CLEARLY_MEDIA.test(text)) return 'media';
  if (CLEARLY_HISTORY.test(text)) return 'history';
  if (CLEARLY_PROJECTS.test(text)) return 'projects';
  return null;
}

/*
 * A follow-up belongs where the conversation already is (12 Oct 2026). His real run: "go on my D2L
 * and find biodiversity notes" went to School, then "go through the main biodiversity pdf and find
 * 2a-2c there" said nothing about school, went to the general team (no D2L tools), took 12 minutes
 * and made questions up. A message that points back at something ("the pdf", "there", "those") now
 * goes to the department the previous message went to.
 */
const POINTS_BACK = /\b(it|that|those|these|them|there|this one|the (pdf|file|doc|document|notes?|slides?|deck|presentation|section|part|unit|chapter|lesson|questions?|quiz|assignment|worksheet|reading|link|page|course|class)s?)\b/i;

export function routeWithContext(text: string, previous?: string): { dept: DepartmentId | null; clearly: boolean } {
  const own = departmentFor(text);
  // Its own words name a department; a follow-up to a message that was clearly that department is clearly it too.
  if (own) return { dept: own, clearly: clearlyFor(text) === own || (Boolean(previous) && POINTS_BACK.test(text) && clearlyFor(previous!) === own) };
  if (!previous || text.length > 400 || !POINTS_BACK.test(text)) return { dept: null, clearly: false };
  const prevClear = clearlyFor(previous);
  const prev = prevClear ?? departmentFor(previous);
  return prev ? { dept: prev, clearly: prevClear === prev } : { dept: null, clearly: false };
}

export function departmentFor(text: string): DepartmentId | null {
  const clear = clearlyFor(text);
  if (clear) return clear;
  if (HEALTH.test(text)) return 'health';
  if (SCHOOL.test(text)) return 'school';
  if (MEDIA.test(text)) return 'media';
  if (HISTORY.test(text)) return 'history';
  if (PROJECTS.test(text)) return 'projects';
  return null;
}
