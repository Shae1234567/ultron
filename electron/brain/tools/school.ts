import * as d2l from '../../d2l';
import * as ps from '../../powerschool';
import * as tasks from '../../tasks';
import { focusState } from '../../focus';
import { load as loadHealth } from '../../departments/health/store';
import { searchLibrary, syncLibrary } from '../../departments/school/library';
import { planBlocks } from '../../departments/school/plan';
import { refreshSchool } from '../../departments/school/refresh';
import { load as loadSchool } from '../../departments/school/store';
import { schoolSnapshotText } from '../../departments/school/summary';
import { emit } from '../events';
import { guarded, when } from './d2l';
import { N, S, num, obj, str, type AgentTool } from './types';
import { shaped } from './reading';
import { htmlText } from '../../docs';

/** Teachers' HTML (instructions, posts) inside API answers, as plain text. */
const htmlToPlain = (h: string) => htmlText(h);

/*
 * The School department's tools. Everything that touches D2L or PowerSchool is a read - there
 * is no tool that posts, submits or changes anything there. Course material and grades are
 * private: these tools are only in School agents' hands, and School runs on trusted brains.
 */

const psHint = 'Not signed in to PowerSchool (MyCBE). The operator needs to open Apps and press "Sign in to PowerSchool" - they log in themselves; Ultron never sees the password.';

async function psGuarded<T>(fn: () => Promise<T>): Promise<T | { error: string }> {
  try { return await fn(); } catch (e) { return { error: ps.isAuthError(e) ? psHint : e instanceof Error ? e.message : String(e) }; }
}

/** Long text cut to what the caller can see, at a paragraph, with a note saying so. */
function fit(text: string, budget = 14_000): { text: string; cut?: string } {
  if (text.length <= budget) return { text };
  const at = text.lastIndexOf('\n\n', budget);
  return { text: text.slice(0, at > budget * 0.6 ? at : budget), cut: `Showing the first ${Math.round(budget / 1000)}k of ${Math.round(text.length / 1000)}k characters - the library copy (school_library_search) has all of it.` };
}

export const schoolTools: AgentTool[] = [
  {
    name: 'school_open',
    owner: 'prometheus',
    description: 'Open the School screen on the operator\'s screen: this week (due, overdue, quizzes), grades and how they are moving, the course library, and study (focus sessions, study plans).',
    parameters: obj({ tab: S('Which page', { enum: ['week', 'grades', 'library', 'study'] }) }),
    label: (a) => `open School ${str(a, 'tab') || 'week'}`,
    run: async (a) => {
      emit('ui:focus', { school: str(a, 'tab') || 'week' });
      return { opened: str(a, 'tab') || 'week' };
    },
  },
  {
    name: 'school_week',
    owner: 'prometheus',
    description: 'School right now, refreshed from D2L (and PowerSchool if signed in): what is due this week, anything overdue, quizzes coming up or OPEN NOW, grades and how they are moving, assignments in on time, the course library, and the study streak.',
    parameters: obj({ refresh: S('"yes" to re-read D2L now even if the copy is recent') }),
    label: () => 'school this week',
    run: async (a) => {
      const doc = loadSchool();
      if (!doc.cache || Date.now() - doc.cache.at > 30 * 60_000 || str(a, 'refresh') === 'yes') await refreshSchool();
      const f = focusState();
      return { summary: schoolSnapshotText(loadSchool(), { streak: f.streak, todayMinutes: f.todayMinutes, recent: f.recent }) };
    },
  },
  {
    name: 'd2l_content',
    owner: 'prometheus',
    description: 'The course content on D2L - units, lessons and the notes, slides, worksheets and links in them - for one course or all. Each topic has an id to read it with d2l_read.',
    parameters: obj({ course: S('Part of a course name, e.g. "science" (optional)'), unit: S('Only topics whose unit or title contains this (optional)') }),
    label: (a) => `D2L content${str(a, 'course') ? ` (${str(a, 'course')})` : ''}`,
    run: async (a) => guarded(async () => {
      const filter = str(a, 'unit').toLowerCase();
      const courses = await d2l.contents(str(a, 'course') || undefined);
      return courses.map((c) => {
        const topics = c.topics.filter((t) => !filter || `${t.module} ${t.title}`.toLowerCase().includes(filter));
        return {
          course: c.course, course_id: c.courseId, topics: topics.length,
          items: topics.slice(-80).map((t) => `${t.module}: ${t.title} [${t.kind}${t.modified ? `, updated ${t.modified.slice(0, 10)}` : ''}] (topic ${t.topicId})`),
          note: topics.length > 80 ? 'Only the newest 80 are listed - narrow with "unit".' : undefined,
        };
      });
    }),
  },
  {
    name: 'd2l_read',
    owner: 'chiron',
    description: 'Read one D2L content topic as text - the teacher\'s notes, slides (with speaker notes), worksheet, PDF reading or Excel sheet. Needs the course id and topic id from d2l_content.',
    parameters: obj({ course_id: N('Course id from d2l_content'), topic_id: N('Topic id from d2l_content') }, ['course_id', 'topic_id']),
    label: (a) => `read D2L topic ${num(a, 'topic_id', 0)}`,
    run: async (a, ctx) => guarded(async () => {
      const r = await d2l.readTopic(num(a, 'course_id', 0), num(a, 'topic_id', 0));
      if ('error' in r) return r;
      const f = fit(r.text, ctx.resultBudget ? Math.max(4000, ctx.resultBudget - 600) : 14_000);
      return { title: r.title, course: r.course, unit: r.module, kind: r.kind, url: r.url, text: f.text, note: f.cut };
    }),
  },
  {
    name: 'd2l_browse',
    owner: 'chiron',
    // 12 Oct 2026: go through D2L freely - any page or file, read-only.
    description: 'Go through D2L freely, read-only: open any D2L page or file by address (a full link or a path like /d2l/home/12345, or a course name for its home page) and get its text plus every link on it to follow - course pages, content, news, discussions, files, and links out to Google Docs or websites (read those with read_link). Files (PDFs, slides, documents, pictures) are read as text. Screens that build themselves with scripts come back nearly empty: use d2l_api for those. It never clicks, submits or starts anything; quiz attempts, submissions and signing out are refused.',
    parameters: obj({
      url: S('A D2L address or path (optional if course is given)'),
      course: S('Part of a course name, to open its home page'),
      start: N('Character to start from, to read on (default 0)'),
    }),
    label: (a) => `browse D2L ${str(a, 'url') || str(a, 'course')}`.slice(0, 70),
    run: async (a, ctx) => guarded(async () => {
      let url = str(a, 'url').trim();
      if (!url) {
        const want = str(a, 'course').toLowerCase();
        const c = (await d2l.courses()).find((x) => !want || x.name.toLowerCase().includes(want));
        if (!c) return { error: 'No course matches that name - d2l_courses lists them.' };
        url = `/d2l/home/${c.id}`;
      }
      const { readD2L } = await import('../../reader');
      return shaped(await readD2L(url, { signal: ctx.signal }), ctx, num(a, 'start', 0));
    }),
  },
  {
    name: 'd2l_api',
    owner: 'prometheus',
    description: 'Read anything from Brightspace\'s own API (GET only, his sign-in): put {lp} and {le} in the path for the versions. Useful paths - courses: /d2l/api/lp/{lp}/enrollments/myenrollments/; a course\'s contents: /d2l/api/le/{le}/{courseId}/content/toc; news: /d2l/api/le/{le}/{courseId}/news/; discussions: /d2l/api/le/{le}/{courseId}/discussions/forums/ then .../forums/{forumId}/topics/ then .../topics/{topicId}/posts/; grades: /d2l/api/le/{le}/{courseId}/grades/values/myGradeValues/; checklists: /d2l/api/le/{le}/{courseId}/checklists/; assignments: /d2l/api/le/{le}/{courseId}/dropbox/folders/; calendar: /d2l/api/le/{le}/{courseId}/calendar/events/; a content file: /d2l/api/le/{le}/{courseId}/content/topics/{topicId}/file (read as text). Nothing can be changed through it.',
    parameters: obj({ path: S('An API path starting /d2l/api/'), start: N('Character to start from, to read on (default 0)') }, ['path']),
    label: (a) => `D2L API ${str(a, 'path').replace(/^\/d2l\/api\//, '')}`.slice(0, 70),
    run: async (a, ctx) => guarded(async () => {
      const r = await d2l.api(str(a, 'path'));
      if ('file' in r) {
        const { readBytes } = await import('../../reader');
        return shaped(await readBytes(r.file.buf, r.file.name, r.file.type, { signal: ctx.signal }), ctx, num(a, 'start', 0));
      }
      // Teachers' instructions and posts arrive as HTML - any of it becomes plain text, short or long.
      const json = JSON.stringify(r.json, (_k, v) => (typeof v === 'string' && /<\/?[a-z][^>]*>/i.test(v) ? htmlToPlain(v) : v), 1);
      return shaped({ kind: 'D2L API', text: json }, ctx, num(a, 'start', 0));
    }),
  },
  {
    name: 'd2l_assignments',
    owner: 'prometheus',
    description: 'Assignments on D2L with the teacher\'s instructions, attached files (ids for d2l_attachment), due dates, rubric names, and his own submission and published feedback. Read-only: nothing is ever submitted.',
    parameters: obj({ course: S('Part of a course name (optional)'), name: S('Part of the assignment name (optional)') }),
    label: (a) => `D2L assignments${str(a, 'name') ? `: ${str(a, 'name')}` : ''}`,
    run: async (a) => guarded(async () => {
      const want = str(a, 'name').toLowerCase();
      const list = (await d2l.assignments(str(a, 'course') || undefined)).filter((x) => !want || x.name.toLowerCase().includes(want));
      return list.slice(0, want ? 6 : 25).map((x) => ({
        course: x.course, course_id: x.courseId, folder_id: x.folderId, name: x.name, due: when(x.due),
        instructions: x.instructions.slice(0, want ? 4000 : 500) || undefined,
        attachments: x.attachments.length ? x.attachments.map((f) => `${f.name} (file ${f.fileId})`) : undefined,
        out_of: x.outOf, rubrics: x.rubrics.length ? x.rubrics : undefined,
        submitted: x.submittedAt ? when(x.submittedAt) : 'not yet',
        score: x.score ?? undefined, feedback: x.feedback,
      }));
    }),
  },
  {
    name: 'd2l_attachment',
    owner: 'chiron',
    description: 'Read a file attached to a D2L assignment (the worksheet, the rubric, the instructions PDF) as text. Ids come from d2l_assignments.',
    parameters: obj({ course_id: N('Course id'), folder_id: N('Assignment folder id'), file_id: N('File id') }, ['course_id', 'folder_id', 'file_id']),
    label: () => 'read an assignment attachment',
    run: async (a, ctx) => guarded(async () => {
      const r = await d2l.readAttachment(num(a, 'course_id', 0), num(a, 'folder_id', 0), num(a, 'file_id', 0));
      if ('error' in r) return r;
      const f = fit(r.text, ctx.resultBudget ? Math.max(4000, ctx.resultBudget - 400) : 14_000);
      return { name: r.name, kind: r.kind, text: f.text, note: f.cut };
    }),
  },
  {
    name: 'd2l_feedback',
    owner: 'prometheus',
    description: 'What teachers wrote back: comments on grade items and published feedback on assignments, with the marks. The best source for what to work on next.',
    parameters: obj({ course: S('Part of a course name (optional)') }),
    label: () => 'D2L feedback',
    run: async (a) => guarded(async () => {
      const items = await d2l.feedback(str(a, 'course') || undefined);
      return items.length ? items.slice(0, 30) : { note: 'No written feedback published on D2L yet.' };
    }),
  },
  {
    name: 'd2l_calendar',
    owner: 'prometheus',
    description: 'The D2L calendar: tests, events and deadlines teachers put on it, for the next N days.',
    parameters: obj({ days_ahead: N('Days ahead (default 21)') }),
    label: () => 'D2L calendar',
    run: async (a) => guarded(async () => (await d2l.calendar(Math.min(num(a, 'days_ahead', 21), 90))).slice(0, 40).map((e) => ({ course: e.course, title: e.title, starts: when(e.start), ends: e.end ? when(e.end) : undefined, kind: e.kind }))),
  },
  {
    name: 'd2l_quizzes',
    owner: 'sphinx',
    description: 'Quiz names and dates on D2L (never the questions), and whether any is OPEN RIGHT NOW - a live graded quiz is off-limits until it closes.',
    parameters: obj({ course: S('Part of a course name (optional)') }),
    label: () => 'D2L quizzes',
    run: async (a) => guarded(async () => {
      const qs = await d2l.quizzes(str(a, 'course') || undefined);
      const open = qs.filter((q) => q.openNow);
      return {
        open_now: open.length ? open.map((q) => `${q.course} - ${q.name}${q.end ? ` (closes ${when(q.end)})` : ''}`) : undefined,
        rule: open.length ? 'A quiz is open right now: do not help with its questions until it closes.' : undefined,
        quizzes: qs.slice(0, 30).map((q) => ({ course: q.course, name: q.name, opens: q.start ? when(q.start) : undefined, closes: q.end ? when(q.end) : undefined, due: q.due ? when(q.due) : undefined })),
      };
    }),
  },
  {
    name: 'school_library_sync',
    owner: 'chiron',
    description: 'Read a course\'s D2L notes, slides and files into the course library (private notes in Ultron\'s vault), so explanations and quizzes come from the real material. Only new or changed topics are read; a big course may take two runs.',
    parameters: obj({ course: S('Part of a course name (optional - all courses if empty)'), max: N('Most topics to read this time (default 25, up to 60)') }),
    label: (a) => `read ${str(a, 'course') || 'all courses'} into the library`,
    run: async (a, ctx) => guarded(async () => {
      ctx.progress('reading course files into the library...');
      const r = await syncLibrary(str(a, 'course') || undefined, Math.min(60, Math.max(1, num(a, 'max', 25))));
      return {
        read: r.read.length, titles: r.read.slice(0, 25), already_in_library: r.skipped,
        could_not_read: r.failed.length ? r.failed : undefined,
        left_to_read: r.left || undefined,
        note: r.left ? 'Run it again to read the rest.' : 'The library is up to date for this.',
      };
    }),
  },
  {
    name: 'school_library_search',
    owner: 'chiron',
    description: 'Search the course library (the teachers\' own notes, slides and files from D2L) for a topic, a term or a question - returns the best passages with where they came from. Use before explaining or making practice questions.',
    parameters: obj({ query: S('What to look for, e.g. "photosynthesis light reactions"'), course: S('Part of a course name (optional)') }, ['query']),
    label: (a) => `library: ${str(a, 'query').slice(0, 40)}`,
    run: async (a) => {
      const hits = await searchLibrary(str(a, 'query'), str(a, 'course') || undefined, 6);
      return hits.length
        ? { passages: hits.map((h) => ({ from: `${h.course} / ${h.title}`, note: h.rel, text: h.text })) }
        : { note: 'Nothing in the library on that yet. school_library_sync reads the course in; d2l_content lists what is there.' };
    },
  },
  {
    name: 'powerschool_grades',
    owner: 'prometheus',
    description: 'Report-card grades per class from PowerSchool (MyCBE), with the teacher and room. Read-only.',
    parameters: obj({}),
    label: () => 'PowerSchool grades',
    run: async () => psGuarded(async () => {
      const h = await ps.home();
      return h.courses.length ? h.courses.map((c) => ({ course: c.course, teacher: c.teacher, room: c.room, grades: c.grades })) : { page_text: h.text, note: 'The page layout was not the usual one - read the text.' };
    }),
  },
  {
    name: 'powerschool_attendance',
    owner: 'prometheus',
    description: 'Absences and lates per class this term, from PowerSchool (MyCBE). Read-only.',
    parameters: obj({}),
    label: () => 'PowerSchool attendance',
    run: async () => psGuarded(async () => {
      const h = await ps.home();
      return h.courses.length ? h.courses.map((c) => ({ course: c.course, absences: c.absences ?? 0, lates: c.tardies ?? 0 })) : { page_text: h.text };
    }),
  },
  {
    name: 'powerschool_schedule',
    owner: 'prometheus',
    description: 'His class timetable from PowerSchool (MyCBE), as text. Read-only.',
    parameters: obj({}),
    label: () => 'PowerSchool schedule',
    run: async () => psGuarded(async () => ({ schedule: await ps.schedule() })),
  },
  {
    name: 'study_plan',
    owner: 'kratos',
    description: 'Spread study for an assignment or test into short blocks before it\'s due - after school, around practices and games, two a day at most - and add each block as a task with a reminder. Tell the operator the plan; they can move or drop any block.',
    parameters: obj({
      what: S('What it is for, e.g. "Science unit 2 test"'),
      due: S('When it is due or the test is, e.g. "Friday 9am" or an ISO date'),
      total_minutes: N('Total study time to plan (default 120)'),
      block_minutes: N('Length of each block (default 30; 25-45)'),
    }, ['what', 'due']),
    label: (a) => `study plan: ${str(a, 'what')}`,
    writes: true,
    run: async (a) => makeStudyPlan(str(a, 'what'), str(a, 'due'), num(a, 'total_minutes', 120), num(a, 'block_minutes', 30)),
  },
];

/** Plans study blocks before a due time and adds each as a task with a reminder (the tool and the School screen). */
export async function makeStudyPlan(what: string, dueText: string, totalMinutes = 120, blockMinutes = 30): Promise<{ planned: number; blocks: string[]; short_of_time?: string } | { error: string }> {
  if (!what.trim()) return { error: 'What is the plan for?' };
  const parsed = tasks.parseWhen(dueText);
  if (!parsed) return { error: 'When is it due? Give a day and time, like "Friday 9am".' };
  const due = parsed.date;
  const busy = loadHealth().schedule.map((s) => ({ day: s.day, start: s.start, minutes: s.minutes, what: `${s.kind}${s.sport ? ` (${s.sport})` : ''}` }));
  const block = Math.min(45, Math.max(20, blockMinutes || 30));
  const total = Math.min(600, Math.max(block, totalMinutes || 120));
  const blocks = planBlocks(new Date(), due, total, block, busy, what);
  if (!blocks.length) return { error: 'There is no free study time left before it is due - the best use of tonight is one focused block now.' };
  const made = blocks.map((b, i) => tasks.addTask({
    title: `Study: ${what} (${i + 1}/${blocks.length}, ${b.minutes} min)`,
    due: b.start.toISOString(), remindAt: new Date(b.start.getTime() - 10 * 60_000).toISOString(),
    notes: `Kratos' plan for ${what}, due ${due.toLocaleString('en-CA')}. Start a focus session when it begins.`, priority: 'normal', source: 'ultron',
  }));
  emit('tasks:changed', tasks.listTasks('all'));
  return {
    planned: made.length,
    blocks: blocks.map((b) => `${b.start.toLocaleString('en-CA', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })} - ${b.minutes} min`),
    short_of_time: blocks.length * block < total ? `Only ${blocks.length * block} of ${total} minutes fit before it is due.` : undefined,
  };
}
