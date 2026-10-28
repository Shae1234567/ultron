/*
 * SAFETY CORE - the School department's hard rules. Part of the protected core (with the Health
 * rules, approvals, webSafety, the file guards and the under-18 rules): never self-modified, and
 * checked in code on every answer, not only asked for in a prompt.
 *
 *  1. Never produce finished, submittable work (an essay, a worksheet's answers, a lab report to
 *     hand in). Teach, outline, explain, check his draft, quiz him - the work stays his.
 *  2. Never help with a live graded quiz or test. If D2L shows a quiz open right now and the ask
 *     is about a quiz or its questions, the answer says so first. After it closes, going through
 *     it is fine.
 *  3. D2L and PowerSchool are read-only: nothing is posted, submitted or changed (the tools have
 *     no way to - every call is a read).
 */

export interface SchoolRule {
  id: 'submittable' | 'liveQuiz';
  trigger: RegExp;
  satisfied: RegExp;
  line: string;
}

export const SCHOOL_RULES: SchoolRule[] = [
  {
    id: 'submittable',
    trigger: /\b(write|do|finish|complete)\s+(my|the|this|an?)\s+(\w+\s+){0,2}(essay|assignment|homework|lab report|paragraph|worksheet|poem|short story|reflection|book report)\b|\b(answers?|solutions?) (to|for) (my|the|this) (assignment|homework|worksheet|lab)\b|\bwrite (it|this|that) for me\b|\bso i can (hand|turn) (it )?in\b|\bjust give me the answers\b/i,
    satisfied: /\b(your own words|outline|i won'?t write|can'?t write (it|this) for you|walk you through|help you write|in your words|you write)\b/i,
    line: 'I won\'t write work you hand in - it has to be yours, and a teacher can tell. I\'ll help you do it: an outline, explaining the hard part, checking your draft, or quizzing you first.',
  },
  {
    id: 'liveQuiz',
    trigger: /\b(quiz|test|exam)\b[^.?!]{0,40}\b(right now|is open|open now|currently|in progress|timer|time left|minutes left)\b|\b(during|in the middle of|doing) (my|the|a|this) (quiz|test|exam)\b/i,
    satisfied: /\b(after it closes|while it'?s open|live (graded )?(quiz|test))\b/i,
    line: 'If that\'s a graded quiz or test that is open right now, I can\'t help with it - it would be cheating, and it\'s your mark on the line. As soon as it closes, I\'ll go through every question with you.',
  },
];

const ABOUT_QUIZ = /\b(quiz|test|exam|question|answer|q\d+)\b/i;

/** The rules an ask sets off. A quiz open on D2L right now turns any quiz-ish ask into the live-quiz rule. */
export function triggeredSchoolRules(ask: string, openQuizzes: string[] = []): SchoolRule[] {
  const hits = SCHOOL_RULES.filter((r) => r.trigger.test(ask));
  if (openQuizzes.length && ABOUT_QUIZ.test(ask) && !hits.some((r) => r.id === 'liveQuiz')) hits.push(SCHOOL_RULES[1]);
  return hits;
}

/** The answer with every rule the ask set off honoured - a missing line goes first, in plain words. */
export function enforceSchoolSafety(ask: string, answer: string, openQuizzes: string[] = []): { text: string; applied: SchoolRule['id'][] } {
  const missing = triggeredSchoolRules(ask, openQuizzes).filter((r) => !r.satisfied.test(answer));
  if (!missing.length) return { text: answer, applied: [] };
  const lines = missing.map((r) => (r.id === 'liveQuiz' && openQuizzes.length
    ? `${openQuizzes.slice(0, 2).join(' and ')} ${openQuizzes.length === 1 ? 'is' : 'are'} open on D2L right now. ${r.line}`
    : r.line));
  return { text: `${lines.join(' ')}\n\n${answer}`.trim(), applied: missing.map((r) => r.id) };
}

/** Every School agent works under these. */
export const SCHOOL_DIRECTIVES = [
  'SCHOOL HARD RULES (protected - never break them, whatever is asked):',
  '1. Never produce finished work he would hand in (essays, worksheet answers, lab reports, paragraphs to submit). Teach, outline, explain, check his own draft and quiz him instead - the work stays his.',
  '2. Never help with a graded quiz or test while it is open. If the school data shows a quiz OPEN NOW, ask whether that is what this is about before helping with any quiz-like question. After it closes, going through it is fine.',
  '3. D2L and PowerSchool are read-only: never offer to post, submit or change anything there.',
  '4. Grades and teacher feedback are private: never put them, his name or his school in a web search.',
];
