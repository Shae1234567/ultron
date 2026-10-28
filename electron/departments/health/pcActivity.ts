import { readDoc, writeDoc, getSettings } from '../../store';

/*
 * Sleep with no watch: the closest real thing. While Ultron runs, it notes when the PC is in
 * use (Windows' own idle time, sampled every 5 minutes - nothing else is recorded). In the
 * morning, the last use before the night's long gap and the first use after it pre-fill the
 * sleep question: "PC off at 12:40, on at 7:05 - bed around 12:45?". It is only ever a
 * suggestion he confirms or fixes - a phone in bed is invisible to it - and never logged on
 * its own. Local only, private, with its own switch (Settings -> trackers).
 */

const DOC = 'departments/health-pc.json';
const KEEP_MS = 4 * 86_400_000;
/** Use within this long of the last counts as the same stretch. */
const JOIN_MS = 20 * 60_000;

export type Span = [start: number, end: number];

export function load(): Span[] {
  const d = readDoc<{ spans?: Span[] }>(DOC, {});
  return Array.isArray(d.spans) ? d.spans.filter((s) => Array.isArray(s) && s.length === 2) : [];
}

/** Adds one moment of use to the spans, joining it to the last one when close enough. Pure. */
export function addUse(spans: Span[], at: number, now = at): Span[] {
  const kept = spans.filter((s) => s[1] >= now - KEEP_MS).map((s) => [s[0], s[1]] as Span);
  const last = kept[kept.length - 1];
  if (last && at - last[1] <= JOIN_MS && at >= last[0]) last[1] = Math.max(last[1], at);
  else kept.push([at, at]);
  return kept;
}

const hhmm = (t: number) => {
  const d = new Date(t);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

/**
 * Last night as the PC saw it: the longest gap in use between 8 pm yesterday and noon today,
 * if it is at least 3 hours. Pure.
 */
export function lastNight(spans: Span[], morning: Date): { pcOff: string; pcOn: string; offAt: number; onAt: number } | null {
  const noon = new Date(morning); noon.setHours(12, 0, 0, 0);
  const evening = new Date(noon.getTime() - 16 * 3600_000); // 8 pm the day before
  const inWindow = spans.filter((s) => s[1] >= evening.getTime() && s[0] <= noon.getTime()).sort((a, b) => a[0] - b[0]);
  let best: { offAt: number; onAt: number } | null = null;
  for (let i = 0; i + 1 < inWindow.length; i++) {
    const offAt = inWindow[i][1];
    const onAt = inWindow[i + 1][0];
    if (onAt - offAt >= 3 * 3600_000 && (!best || onAt - offAt > best.onAt - best.offAt)) best = { offAt, onAt };
  }
  return best ? { ...best, pcOff: hhmm(best.offAt), pcOn: hhmm(best.onAt) } : null;
}

/** The pre-fill line, or '' when there is nothing to suggest. */
export function sleepHint(now = new Date(), spans = load()): string {
  const n = lastNight(spans, now);
  if (!n) return '';
  const bed = hhmm(n.offAt + 5 * 60_000);
  return `The PC was last used at ${n.pcOff} last night and first used at ${n.pcOn} this morning - so bed around ${bed}? (A guess from the PC only - he confirms or fixes it.)`;
}

export function on(): boolean {
  return getSettings().trackers?.pcActivity !== false;
}

let timer: ReturnType<typeof setInterval> | null = null;

/** Samples the PC's idle time every 5 minutes while the switch is on. */
export function startPcActivity(idleSeconds: () => number): void {
  if (timer) return;
  const tick = () => {
    if (!on()) return;
    const idle = idleSeconds();
    // In use within the last 10 minutes = a moment of use, at the time it really happened.
    if (idle > 600) return;
    const at = Date.now() - idle * 1000;
    writeDoc(DOC, { spans: addUse(load(), at) });
  };
  tick();
  timer = setInterval(tick, 5 * 60_000);
}

/** What the tracker has collected - shown to him in full when he asks. */
export function collected(): { from: string; to: string }[] {
  return load().map(([a, b]) => ({ from: new Date(a).toLocaleString('en-CA'), to: new Date(b).toLocaleString('en-CA') }));
}
