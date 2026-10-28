import { describe, expect, it, vi } from 'vitest';

vi.mock('./store', () => ({ readDoc: (_n: string, f: unknown) => f, writeDoc: () => {}, getSettings: () => ({ jobs: {} }), saveSettings: () => {} }));
vi.mock('./brain/events', () => ({ emit: () => {} }));
vi.mock('./memory/vault', () => ({ readNote: () => null, writeNote: () => '' }));

const { clashes, buildReview } = await import('./olympus');

// Friday 9 Oct 2026, noon.
const now = Date.parse('2026-10-09T12:00:00');
const emptyHealth = { v: 1 as const, sleep: [], training: [], food: [], water: [], pain: [], checkins: [], usual: [], schedule: [], dayTypes: {} };
const school = (due: { name: string; course: string; at: string }[], quizzes: { name: string; course: string; at: string }[] = []) => ({
  v: 1 as const, ps: null, gradeHistory: [], onTime: [], library: {},
  cache: {
    at: now, signedIn: true, overdue: [], grades: [],
    due: due.map((d) => ({ course: d.course, courseId: 1, name: d.name, due: d.at, type: 'assignment', completed: false })),
    quizzes: quizzes.map((q) => ({ course: q.course, courseId: 2, name: q.name, start: q.at, end: null, due: null, openNow: false })),
  },
});

describe('clashes', () => {
  it('a game the day before a quiz: study before the game', () => {
    const health = { ...emptyHealth, schedule: [{ id: 'g', kind: 'game' as const, sport: 'soccer', day: 6, start: '10:00', minutes: 90 }] };
    const out = clashes(health, school([], [{ name: 'Cells quiz', course: 'Science 9', at: '2026-10-11T09:00:00' }]), now);
    expect(out.map((c) => c.text)).toEqual(["Saturday's game (soccer) is right before the Science 9 quiz \"Cells quiz\" (Sunday) - get the studying done the day before the game."]);
  });

  it('evening practice the night before something due first thing', () => {
    const health = { ...emptyHealth, schedule: [{ id: 'p', kind: 'practice' as const, day: 1, start: '18:00', minutes: 90 }] };
    const out = clashes(health, school([{ name: 'Lab write-up', course: 'Science 9', at: '2026-10-13T08:30:00' }]), now);
    expect(out[0].text).toMatch(/^Practice on Monday evening, and the Science 9 "Lab write-up" is due Tuesday morning/);
  });

  it('an early session after a week of late nights', () => {
    const sleep = ['2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08'].map((date) => ({ id: date, date, bed: '00:15', wake: '07:00', hours: 6.75, source: 'app' as const, at: Date.parse(`${date}T07:00:00`) }));
    const health = { ...emptyHealth, sleep, schedule: [{ id: 'p', kind: 'practice' as const, day: 6, start: '07:30', minutes: 60 }] };
    expect(clashes(health, school([]), now)[0].text).toMatch(/in bed after 11:30 - an earlier night/);
  });

  it('nothing on the schedule: no clashes invented', () => {
    expect(clashes(emptyHealth, school([{ name: 'X', course: 'Y', at: '2026-10-12T09:00:00' }]), now)).toEqual([]);
  });
});

describe('the Sunday review', () => {
  it("each department's number and next week's top three, from real data - and says when a department sat unused", () => {
    const r = buildReview(emptyHealth, school([{ name: 'Unit 2 worksheet', course: 'Math 9', at: '2026-10-13T23:59:00' }]), ['health', 'school'], Date.parse('2026-10-11T18:00:00'));
    expect(r.text).toMatch(/## Health \(Asclepius\)\n- This week: no nights logged; 0 training sessions, load 0\./);
    expect(r.text).toMatch(/## School \(Prometheus\)[\s\S]*1\. Unit 2 worksheet \(Math 9\) - due Tuesday\./);
    expect(r.text).toMatch(/## Not used\n- Health: nothing in two weeks/);
  });
});
