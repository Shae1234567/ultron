/**
 * CM8's day planner, ported.
 *
 * Takes the five answers and lays out a whole day: sleep debt, locked blocks,
 * a training window, meals timed around it, homework in genuinely free time,
 * wind-down and lights out. Two behaviours here were bugs once and are now
 * load-bearing:
 *
 *   - If a meal is already blocked out by hand, the planner does NOT schedule a
 *     second one on top of it. It moves the fuel advice onto the existing block.
 *   - If no free stretch is long enough for the session, it says so loudly
 *     instead of silently dropping training from the day.
 */
import type { TrainingLoad } from './nutrition';
import type { BusyBlock } from './memory';

export type EventType = 'sleep' | 'busy' | 'meal' | 'train' | 'focus';

export interface PlanEvent {
  start: number;
  type: EventType;
  title: string;
  note: string;
  badge?: string;
}

export interface PlanInput {
  sleptAt: string;
  wokeAt: string;
  wakeTarget: string;
  training: TrainingLoad;
  homework: number;
  busy: BusyBlock[];
  notes: string;
}

export interface Plan {
  events: PlanEvent[];
  bedtime: number;
  wakeTarget: number;
  totalNeed: number;
  cycles: number;
  lastSleep: number;
  lastHours: number;
  notes: string;
  noteAdvice: string;
  wokeAt: number;
  hwWarning: string | null;
  trainWarning: string | null;
}

/* ---------- time helpers ---------- */
export function toMins(v: string): number | null {
  if (!v) return null;
  const [h, m] = v.split(':').map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return null;
  return h * 60 + m;
}

export function fmt(mins: number): string {
  const m = (((Math.round(mins) % 1440) + 1440) % 1440);
  const h = Math.floor(m / 60);
  const ap = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m % 60).padStart(2, '0')} ${ap}`;
}

export function dur(mins: number): string {
  const h = Math.floor(mins / 60);
  const m = Math.round(mins % 60);
  return ((h ? h + 'h ' : '') + (m ? m + 'm' : (h ? '' : '0m'))).trim();
}

export function toTimeInput(mins: number): string {
  const m = (((Math.round(mins) % 1440) + 1440) % 1440);
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

interface Span { start: number; end: number }

function freeGaps(from: number, to: number, occupied: Span[]): Span[] {
  const blocks = occupied.slice().sort((a, b) => a.start - b.start);
  const gaps: Span[] = [];
  let cur = from;
  for (const b of blocks) {
    if (b.start > cur) gaps.push({ start: cur, end: Math.min(b.start, to) });
    cur = Math.max(cur, b.end);
  }
  if (to > cur) gaps.push({ start: cur, end: to });
  return gaps.filter((g) => g.end - g.start > 0);
}

const TRAIN_RE = /(practice|training|session|match|game|soccer|football|rangers|futsal|gym|badminton)/i;
const MEAL_RE = /(dinner|supper|lunch|breakfast|eat|meal)/i;

/** What Shae typed in the notes box, turned into one piece of advice. */
export function readNotes(txt: string): string {
  const t = (txt || '').toLowerCase();
  if (/(sore|tight|ache|aching|pain|hurt|injur|strain|pulled)/.test(t)) {
    return "You mentioned something sore. Treat today's session as optional, not mandatory — pain that changes how you run is a stop sign, not something to push through.";
  }
  if (/(test|exam|quiz|assignment|project|essay|due)/.test(t)) {
    return "You've got school pressure this week. Protect the homework blocks above like they're training sessions — and don't let a late-night cram wreck the sleep this plan is built on.";
  }
  if (/(sick|ill|cold|flu|run down|tired|exhaust|drained)/.test(t)) {
    return "If you're feeling run down, drop the intensity today and keep the sleep and the food exactly as planned. Training through it usually costs you the rest of the week.";
  }
  if (/(nervous|stress|anxious|worried|pressure)/.test(t)) {
    return 'Nerves are a sign it matters to you. Stick to this schedule anyway — a predictable day is the fastest way to settle your head before a big session.';
  }
  return 'Noted. If any of this changes how today actually goes, rebuild the plan — it takes twenty seconds.';
}

export function buildPlan(input: PlanInput): Plan {
  const sleptAt = toMins(input.sleptAt) ?? 23 * 60;
  const wokeAt = toMins(input.wokeAt) ?? 7 * 60;
  const wakeTarget = toMins(input.wakeTarget) ?? 7 * 60;
  const busy = (input.busy || []).slice().sort((a, b) => a.start - b.start);

  // Last night's sleep
  let lastSleep = wokeAt - sleptAt;
  if (lastSleep < 0) lastSleep += 1440;
  const lastHours = lastSleep / 60;

  // Tonight: 6 full 90-minute cycles plus 15 minutes to fall asleep = 9h15,
  // which sits in the middle of the 8-10 hour window a 14-year-old needs.
  const LATENCY = 15;
  const CYCLE = 90;
  const cycles = 6;
  const totalNeed = LATENCY + cycles * CYCLE;

  // Everything runs on "minutes since midnight today", so a bedtime past
  // midnight is simply a number over 1440. fmt() wraps it back for display.
  let bedtime = wakeTarget + 1440 - totalNeed;
  if (bedtime - wokeAt > 1200) bedtime -= 1440;
  const windDown = bedtime - 45;

  const events: PlanEvent[] = [];
  const add = (start: number, type: EventType, title: string, note: string, badge?: string) =>
    events.push({ start, type, title, note, badge });

  const occupied: { start: number; end: number; label: string }[] =
    busy.map((b) => ({ start: b.start, end: b.end, label: b.label }));

  add(wokeAt, 'sleep', 'Wake up', lastHours < 7.5
    ? 'You only got ' + dur(lastSleep) + " last night — expect today to feel heavier than it should, and don't read too much into a flat session."
    : 'You got ' + dur(lastSleep) + " last night. That's a good base to train off.",
  dur(lastSleep));

  for (const b of busy) {
    add(b.start, 'busy', b.label, 'Locked block — everything else is planned around this.', dur(b.end - b.start));
  }

  const bookedMeal = (re: RegExp) => occupied.find((b) => re.test(b.label));
  function dressBlock(block: { start: number; label: string }, note: string, badge?: string) {
    const ev = events.find((e) => e.type === 'busy' && e.start === block.start && e.title === block.label);
    if (ev) { ev.note = note; if (badge) ev.badge = badge; }
  }

  const BREAKFAST_NOTE = 'Carbs plus protein — oats, eggs, toast, fruit. Never skip this on a school plus training day.';
  const ownBreakfast = bookedMeal(/breakfast/i);
  let breakfast: number;
  if (ownBreakfast) {
    breakfast = ownBreakfast.start;
    dressBlock(ownBreakfast, BREAKFAST_NOTE, 'Fuel');
  } else {
    breakfast = wokeAt + 20;
    add(breakfast, 'meal', 'Breakfast', BREAKFAST_NOTE, 'Fuel');
  }

  /* ---- training: reuse an existing block if one already is training ---- */
  let train: Span | null = null;
  let trainWarning: string | null = null;
  const kind = input.training;
  const existing = occupied.find((b) => TRAIN_RE.test(b.label));
  if (existing && kind !== 'rest') {
    train = { start: existing.start, end: existing.end };
  } else if (kind !== 'rest') {
    const needMin = kind === 'match' ? 150 : kind === 'light' ? 45 : 75;
    const gaps = freeGaps(wokeAt + 90, windDown - 90, occupied)
      .filter((g) => g.end - g.start >= needMin + 20);
    const g = gaps.find((x) => x.start >= 15 * 60) || gaps[gaps.length - 1] || null;
    if (g) {
      train = { start: g.start + 15, end: g.start + 15 + needMin };
      occupied.push({ start: train.start, end: train.end, label: 'Training' });
      add(train.start, 'train',
        kind === 'match' ? 'Match' : kind === 'light' ? 'Light session / ball work' : 'Training session',
        kind === 'match' ? 'Arrive early and run your own warm-up before the team one starts.'
          : kind === 'light' ? 'Keep it technical and relaxed — touch, not intensity.'
            : "This is your window. Warm up properly, work hard, cool down — don't cut the ends off it.",
        dur(needMin));
    } else {
      // Nothing fits. Say so loudly rather than quietly dropping the session.
      trainWarning = "I couldn't fit "
        + (kind === 'match' ? 'a match' : kind === 'light' ? 'a light session' : 'a full session')
        + ' anywhere today — every free stretch between your blocks is shorter than the '
        + dur(needMin + 20)
        + ' it needs. Either one of those blocks moves, or today becomes a rest day and you train tomorrow instead. '
        + "Don't wedge it in with no warm-up.";
    }
  }

  /* ---- meals timed around training ---- */
  if (train) {
    const pre = train.start - 180;
    if (pre >= breakfast + 120) {
      add(pre, 'meal', 'Pre-training meal',
        "Carb-focused with some protein — pasta, rice, or a sandwich. Three hours out so it's actually digested.", '−3 hrs');
    }
    const snack = train.start - 60;
    if (snack >= breakfast + 45) {
      add(snack, 'meal', 'Light snack',
        "Banana, toast, or a granola bar plus water. Small enough that it won't sit in your stomach.", '−60 min');
    }
    add(train.end + 20, 'meal', 'Recovery snack',
      'Chocolate milk, yogurt, or a sandwich within half an hour of finishing. This is the window that actually matters.', '+30 min');
    occupied.push({ start: train.start - 70, end: train.end + 35, label: 'Training window' });
  }

  /* ---- lunch ---- */
  const noon = 12 * 60;
  const ownLunch = bookedMeal(/lunch/i);
  if (ownLunch) {
    dressBlock(ownLunch, 'Carbs, a real protein, something fresh. Log it in the Food Log after.', 'Fuel');
  } else if (noon > breakfast + 150 && noon < windDown) {
    const duringBusy = occupied.find((b) => b.start <= noon && b.end >= noon);
    if (!duringBusy) {
      add(noon, 'meal', 'Lunch', 'Carbs, a real protein, something fresh. Log it in the Food Log after.', 'Fuel');
    } else if (TRAIN_RE.test(duringBusy.label)) {
      add(duringBusy.end + 40, 'meal', 'Lunch',
        "You've just played through lunch. Get a real plate in now, not just a snack.", 'Fuel');
    } else if (!MEAL_RE.test(duringBusy.label)) {
      add(noon, 'meal', 'Lunch',
        "Pack it the night before so it's a real meal, not whatever the vending machine has left.", 'Fuel');
    }
  }

  /* ---- dinner (skip if a meal is already booked in the evening) ---- */
  const bookedDinner = occupied.find((b) => MEAL_RE.test(b.label) && b.start >= 16 * 60);
  if (bookedDinner) {
    occupied.push({ start: bookedDinner.start, end: bookedDinner.end, label: 'Dinner' });
  } else {
    let dinner = train ? Math.max(train.end + 75, 17 * 60) : 18 * 60;
    dinner = Math.min(dinner, windDown - 75);
    if (train) dinner = Math.max(dinner, train.end + 45);
    add(dinner, 'meal', 'Dinner',
      'The biggest plate of the day. Carbs, a real protein, and a handful of veg. Aim to finish a couple of hours before bed.', 'Main');
    occupied.push({ start: dinner, end: dinner + 45, label: 'Dinner' });
  }

  /* ---- homework, in genuinely free time, finished before wind-down ---- */
  let hwWarning: string | null = null;
  if (input.homework > 0) {
    let blocks = Math.max(1, Math.round(input.homework / 50));
    const chunk = Math.round(input.homework / blocks);
    const spanOf = (n: number) => n * chunk + (n - 1) * 10;
    const latestStart = windDown - 10;

    let placed: { start: number; blocks: number } | null = null;
    while (blocks > 0 && !placed) {
      const span = spanOf(blocks);
      const gaps = freeGaps(wokeAt + 60, windDown - 10, occupied)
        .filter((g) => g.end - g.start >= span + 10);
      const g = gaps.find((x) => x.start >= noon) || gaps[gaps.length - 1] || null;
      if (g && g.start + 10 + span <= latestStart) placed = { start: g.start + 10, blocks };
      else blocks--;
    }
    if (placed) {
      if (placed.blocks * chunk < input.homework) {
        hwWarning = "There isn't room for all " + dur(input.homework)
          + " of homework before wind-down today. I've placed " + dur(placed.blocks * chunk)
          + ' — the rest needs to move to tomorrow, or something else has to give.';
      }
      for (let i = 0; i < placed.blocks; i++) {
        add(placed.start + i * (chunk + 10), 'focus', 'Homework block ' + (i + 1), i === 0
          ? "Phone in another room, timer on, hardest subject first. You only have to commit to the first ten minutes — that's the whole trick."
          : "Break's over. Same rules: phone stays out of the room, timer back on.",
        dur(chunk));
      }
    } else {
      hwWarning = "Your day is genuinely full — there's no free block long enough for homework before wind-down. "
        + "Either something moves, or this goes to tomorrow morning. Don't solve it by cutting sleep.";
    }
  }

  add(windDown, 'sleep', 'Wind-down',
    'Screens off. These 45 minutes decide whether you actually fall asleep at ' + fmt(bedtime) + ' or lie there until midnight.',
    'No screens');
  add(bedtime, 'sleep', 'Lights out',
    'Target bedtime — ' + cycles + ' full sleep cycles before your alarm at ' + fmt(wakeTarget) + '.',
    dur(totalNeed));

  // Anchor the timeline at wake-up so anything past midnight sorts last.
  const key = (t: number) => (t < wokeAt ? t + 1440 : t);
  events.sort((a, b) => key(a.start) - key(b.start));

  return {
    events, bedtime, wakeTarget, totalNeed, cycles, lastSleep, lastHours,
    notes: input.notes,
    noteAdvice: input.notes ? readNotes(input.notes) : '',
    wokeAt, hwWarning, trainWarning,
  };
}
