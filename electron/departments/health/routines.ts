import { isoDay, load, type HealthDoc } from './store';
import { on as pcTrackerOn, sleepHint } from './pcActivity';

/*
 * Health's two routines, carried by Ultron's own greetings (proactive.ts) rather than extra
 * pop-ups: morning readiness in the first greeting (sleep, energy) and the 30-second evening
 * check-in (training, rough food, any pain, bedtime). Each is asked only when it hasn't been
 * logged yet, and asking is all it does - he answers, Health logs.
 */

export type GreetKind = 'boot' | 'wake' | 'checkin';

export function greetingFacts(kind: GreetKind, now = new Date(), doc: HealthDoc = load(), hint = pcTrackerOn() ? sleepHint(now) : ''): string {
  const today = isoDay(now);
  const h = now.getHours();
  if ((kind === 'boot' || kind === 'wake') && h >= 5 && h < 12 && !doc.sleep.some((s) => s.date === today)) {
    return `Health (Asclepius): no sleep is logged for last night. Ask in one short question when they went to bed and woke up, and their energy 1-5${hint ? `. Offer this guess for them to confirm or fix: ${hint}` : ''}.`;
  }
  const loggedToday = doc.checkins.some((c) => c.date === today) || doc.training.some((t) => t.date === today) || doc.food.some((f) => f.date === today);
  if (kind === 'checkin' && h >= 19 && h < 23 && !loggedToday) {
    return 'Health (Asclepius): the 30-second evening check-in is due - training today (what, minutes, effort 1-10), rough food, any pain, and bedtime. Ask for it in one line.';
  }
  return '';
}
