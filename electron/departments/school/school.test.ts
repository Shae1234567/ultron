import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({ BrowserWindow: class {}, session: { fromPartition: () => ({}) }, shell: {}, app: { getPath: () => '' } }));
const docs = new Map<string, unknown>();
vi.mock('../../store', () => ({
  getSettings: () => ({ d2l: { baseUrl: 'https://d2l.cbe.ab.ca' }, powerschool: { baseUrl: 'https://sis.cbe.ab.ca' } }),
  readDoc: (n: string, f: unknown) => (docs.has(n) ? structuredClone(docs.get(n)) : f),
  writeDoc: (n: string, d: unknown) => { docs.set(n, structuredClone(d)); },
}));
vi.mock('../../tasks', () => ({}));
vi.mock('../../brain/events', () => ({ emit: () => {} }));

const { enforceSchoolSafety, triggeredSchoolRules } = await import('../../brain/safety/school');
const { departmentFor, clearlyFor } = await import('../route');
const store = await import('./store');
const { schoolSnapshotText, missedYesterday } = await import('./summary');
const { planBlocks } = await import('./plan');
const { keywordSearch } = await import('./library');
const d2l = await import('../../d2l');
const ps = await import('../../powerschool');

describe('School hard rules', () => {
  it('never writes hand-in work - the line goes first unless the answer already teaches', () => {
    expect(triggeredSchoolRules('can you write my essay on the causes of WW1').map((r) => r.id)).toEqual(['submittable']);
    expect(triggeredSchoolRules('do my math homework for me').map((r) => r.id)).toEqual(['submittable']);
    expect(triggeredSchoolRules('make a study plan for my homework this week')).toEqual([]);
    expect(triggeredSchoolRules('explain photosynthesis')).toEqual([]);
    const fixed = enforceSchoolSafety('write my essay about the Mongols', 'Here is your essay: ...');
    expect(fixed.applied).toEqual(['submittable']);
    expect(fixed.text.startsWith("I won't write work you hand in")).toBe(true);
    expect(enforceSchoolSafety('write my essay', 'I can\'t write it for you, but here is an outline you can build from.').applied).toEqual([]);
  });

  it('a quiz open on D2L right now turns quiz questions into the live-quiz rule, by name', () => {
    expect(triggeredSchoolRules('what is the answer to question 3', [])).toEqual([]);
    const r = enforceSchoolSafety('what is the answer to question 3', 'It is B.', ['Science 9 - Cells quiz']);
    expect(r.applied).toEqual(['liveQuiz']);
    expect(r.text).toMatch(/^Science 9 - Cells quiz is open on D2L right now\. If that's a graded quiz/);
    expect(triggeredSchoolRules('help me with this test, there are 10 minutes left').map((x) => x.id)).toEqual(['liveQuiz']);
  });
});

describe('routing to School', () => {
  it('sends school things to School, and leaves general questions alone', () => {
    expect(clearlyFor("what's due this week")).toBe('school');
    expect(clearlyFor('quiz me on unit 2 science')).toBe('school');
    expect(clearlyFor('Chiron, explain mitosis')).toBe('school');
    expect(departmentFor('help me study for my math test')).toBe('school');
    expect(departmentFor('explain how a car engine works')).toBeNull();
    expect(departmentFor('I slept from 11 to 7')).toBe('health');
    expect(clearlyFor('what should I eat before practice')).toBe('health');
  });
});

describe("School's own copy", () => {
  it('reads grades as percentages where it can', () => {
    expect(store.percentOf('87.5 %')).toBe(87.5);
    expect(store.percentOf('A (92%)')).toBe(92);
    expect(store.percentOf('18/20')).toBe(90);
    expect(store.percentOf('B+')).toBeNull();
  });

  it('keeps a grade history only when a grade changes, and reads the trend', () => {
    let h = store.addGrades([], [{ course: 'Math 9', grade: '84 %' }, { course: 'Science 9', grade: '-' }], '2026-10-01');
    h = store.addGrades(h, [{ course: 'Math 9', grade: '84 %' }], '2026-10-03');
    h = store.addGrades(h, [{ course: 'Math 9', grade: '87 %' }], '2026-10-08');
    expect(h).toHaveLength(2);
    expect(store.gradeTrend(h)).toEqual([{ course: 'Math 9', grade: '87 %', pct: 87, change: 3, since: '2026-10-01' }]);
  });

  it('counts assignments in on time over the last 8 weeks', () => {
    const now = Date.parse('2026-10-10T12:00:00');
    const n = store.onTimeNumber([
      { course: 'M', name: 'a', due: '2026-10-01T23:59:00', submittedAt: '2026-10-01T20:00:00' },
      { course: 'M', name: 'b', due: '2026-10-03T23:59:00', submittedAt: '2026-10-05T08:00:00' },
      { course: 'M', name: 'c', due: '2026-10-06T23:59:00' },
      { course: 'M', name: 'd', due: '2026-07-01T23:59:00', submittedAt: '2026-07-01T20:00:00' },
      { course: 'M', name: 'e', due: '2026-10-20T23:59:00' },
    ], now);
    expect(n).toEqual({ onTime: 1, late: 1, missing: 1, total: 3 });
  });

  it('says plainly when D2L has not been read or is not signed in', () => {
    expect(schoolSnapshotText(store.load(), null)).toMatch(/not loaded yet/);
    const doc = { ...store.load(), cache: { at: Date.now(), signedIn: false, due: [], overdue: [], quizzes: [], grades: [], error: 'D2L is not signed in' } };
    expect(schoolSnapshotText(doc, null)).toMatch(/D2L is NOT signed in/);
  });

  it('puts what matters first: overdue, due this week, quizzes open now, grades, streak', () => {
    const now = Date.parse('2026-10-10T12:00:00');
    const doc = {
      ...store.load(),
      cache: {
        at: now, signedIn: true,
        due: [{ course: 'Math 9', courseId: 1, name: 'Unit 2 worksheet', due: '2026-10-14T23:59:00Z', type: 'assignment', completed: false }],
        overdue: [{ course: 'Science 9', courseId: 2, name: 'Lab 1', due: '2026-10-08T23:59:00Z', type: 'overdue', completed: false }],
        quizzes: [{ course: 'Science 9', courseId: 2, name: 'Cells quiz', start: '2026-10-10T11:00:00', end: '2026-10-10T13:00:00', due: null, openNow: true }],
        grades: [],
      },
      gradeHistory: [{ date: '2026-10-01', course: 'Math 9', grade: '84 %', pct: 84 }, { date: '2026-10-08', course: 'Math 9', grade: '87 %', pct: 87 }],
    };
    const t = schoolSnapshotText(doc, { streak: 0, todayMinutes: 0, recent: [{ subject: 'math', startedAt: now - 3 * 86_400_000, finished: true }] }, now);
    expect(t).toMatch(/Due in the next 7 days: Math 9 - Unit 2 worksheet/);
    expect(t).toMatch(/OVERDUE: Science 9 - Lab 1/);
    expect(t).toMatch(/QUIZ OPEN NOW on D2L: Science 9 - Cells quiz/);
    expect(t).toMatch(/Math 9 87 % \(up 3 since 2026-10-01\)/);
    expect(t).toMatch(/yesterday was missed, so today matters/);
    expect(missedYesterday({ streak: 1, todayMinutes: 25, recent: [{ subject: 'x', startedAt: now, finished: true }] }, now)).toBe(false);
  });
});

describe("Kratos' study blocks", () => {
  it('spreads blocks over the days before, after school, around practice, never the last hour', () => {
    const now = new Date('2026-10-12T15:00:00'); // Monday
    const due = new Date('2026-10-16T09:00:00'); // Friday morning
    const practice = [{ day: 2, start: '17:00', minutes: 90, what: 'practice' }]; // Tuesday
    const blocks = planBlocks(now, due, 120, 30, practice, 'Science test');
    expect(blocks).toHaveLength(4);
    expect(new Set(blocks.map((b) => b.start.toDateString())).size).toBe(4); // one a day before doubling up
    for (const b of blocks) {
      const h = b.start.getHours() + b.start.getMinutes() / 60;
      expect(h).toBeGreaterThanOrEqual(16);
      expect(h + 0.5).toBeLessThanOrEqual(20.5);
      if (b.start.getDay() === 2) expect(h + 0.5 <= 16.5 || h >= 19).toBe(true); // clear of practice +- 30 min
    }
    expect(blocks[blocks.length - 1].start.getTime()).toBeLessThan(due.getTime() - 3600_000);
  });

  it('returns nothing when there is no time left', () => {
    expect(planBlocks(new Date('2026-10-12T20:25:00'), new Date('2026-10-12T21:00:00'), 60)).toEqual([]);
  });
});

describe('reading D2L', () => {
  it('flattens the table of contents with unit paths, skipping hidden things', () => {
    const topics = d2l.flattenToc({ Modules: [
      { ModuleId: 1, Title: 'Unit 1', Topics: [{ TopicId: 10, Title: 'Notes', TypeIdentifier: 'File', Url: '/content/notes.pdf' }, { TopicId: 11, Title: 'Secret', TypeIdentifier: 'File', IsHidden: true }],
        Modules: [{ ModuleId: 2, Title: 'Lesson 2', Topics: [{ TopicId: 12, Title: 'Page', TypeIdentifier: 'File', Url: '/content/page.html' }, { TopicId: 13, Title: 'Video', TypeIdentifier: 'Link', Url: 'https://youtu.be/x' }] }] },
      { ModuleId: 3, Title: 'Hidden unit', IsHidden: true, Topics: [{ TopicId: 14, Title: 'X', TypeIdentifier: 'File' }] },
    ] }, 5, 'Science 9');
    expect(topics.map((t) => [t.topicId, t.module, t.kind])).toEqual([[10, 'Unit 1', 'file'], [12, 'Unit 1 > Lesson 2', 'html'], [13, 'Unit 1 > Lesson 2', 'link']]);
  });

  it('reads file names from either Content-Disposition form', () => {
    expect(d2l.dispositionName('attachment; filename="Unit 2 Notes.pdf"')).toBe('Unit 2 Notes.pdf');
    expect(d2l.dispositionName("attachment; filename*=UTF-8''Cells%20%26%20Mitosis.pptx")).toBe('Cells & Mitosis.pptx');
    expect(d2l.dispositionName('inline')).toBeNull();
  });

  it('joins an assignment with his latest submission and the published feedback', () => {
    const a = d2l.toAssignment({ id: 1, name: 'Math 9' }, {
      Id: 7, Name: 'Unit 2 worksheet', DueDate: '2026-10-14T23:59:00Z', CustomInstructions: { Html: '<p>Do <b>Q1-10</b>.</p>' },
      Attachments: [{ FileId: 3, FileName: 'ws.pdf' }], Assessment: { ScoreDenominator: 20, Rubrics: [{ Name: 'Worksheet rubric' }] },
    }, [{ Submissions: [{ SubmissionDate: '2026-10-13T20:00:00Z' }, { SubmissionDate: '2026-10-14T08:00:00Z' }], Feedback: { Score: 18, Feedback: { Text: 'Show your steps on Q7.' }, IsGraded: true } }]);
    expect(a).toMatchObject({ instructions: 'Do Q1-10.', attachments: [{ fileId: 3, name: 'ws.pdf' }], outOf: 20, rubrics: ['Worksheet rubric'], submittedAt: '2026-10-14T08:00:00Z', score: 18, feedback: 'Show your steps on Q7.', graded: true });
  });

  it('knows when a quiz is open right now', () => {
    const now = Date.parse('2026-10-10T12:00:00Z');
    expect(d2l.quizOpen({ StartDate: '2026-10-10T11:00:00Z', EndDate: '2026-10-10T13:00:00Z' }, now)).toBe(true);
    expect(d2l.quizOpen({ StartDate: '2026-10-11T11:00:00Z', EndDate: '2026-10-11T13:00:00Z' }, now)).toBe(false);
    expect(d2l.quizOpen({ StartDate: null, EndDate: null, DueDate: null }, now)).toBe(false);
  });
});

describe('reading PowerSchool', () => {
  const home = `<table class="linkDescList grid"><tr class="center th2"><th rowspan="2">Exp</th><th colspan="5">Last Week</th><th rowspan="2">Course</th><th rowspan="2">Q1</th><th rowspan="2">S1</th><th rowspan="2">Absences</th><th rowspan="2">Tardies</th></tr>
    <tr class="center"><th>M</th><th>T</th><th>W</th><th>H</th><th>F</th></tr>
    <tr class="center" id="ccid_1"><td>1(A)</td><td>.</td><td>.</td><td>.</td><td>.</td><td>.</td><td align="left">Mathematics 9&nbsp;<br>Email <a href="mailto:t@cbe.ab.ca">Smith, Jo</a> - Rm: 201</td><td><a href="scores.html?frn=1&fg=Q1">A<br>92</a></td><td>[ i ]</td><td><a href="x">2</a></td><td><a href="y">1</a></td></tr></table>`;
  it('reads grades and attendance per class from the standard home page', () => {
    expect(ps.parseHome(home)).toEqual([{ course: 'Mathematics 9', teacher: 'Smith, Jo', room: '201', grades: { Q1: 'A 92' }, absences: 2, tardies: 1 }]);
    expect(ps.parseHome('<p>a different layout</p>')).toEqual([]);
  });
  it('tells the sign-in form from his pages', () => {
    expect(ps.isLoginPage('<form id="LoginForm"><input name="pw" type="password"></form>')).toBe(true);
    expect(ps.isLoginPage(home)).toBe(false);
  });
});

describe('the course library search', () => {
  it('finds the passage with the most of the words, and where it came from', () => {
    const hits = keywordSearch('light reactions chlorophyll', [
      { rel: 'School/Science 9/Unit 2/Photosynthesis.md', content: '---\nsource: D2L\n---\n\n# Photosynthesis\n\nIntro text.\n\nThe light reactions happen in the thylakoid, where chlorophyll absorbs light.' },
      { rel: 'School/Math 9/Unit 1/Fractions.md', content: '# Fractions\n\nAdd fractions with a common denominator.' },
    ]);
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ course: 'Science 9', title: 'Photosynthesis' });
    expect(hits[0].text).toMatch(/thylakoid/);
  });
});
