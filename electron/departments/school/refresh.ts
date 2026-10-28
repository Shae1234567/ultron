import * as d2l from '../../d2l';
import * as ps from '../../powerschool';
import { addGrades, load, save, type OnTimeItem } from './store';

/*
 * Keeps School's copy fresh: a few minutes after start, then every two hours while Ultron is
 * idle (never in the middle of a request), and whenever an agent asks. D2L first; PowerSchool
 * only once he has signed in to it. A failure keeps the last good copy and says why.
 */

const isoDay = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
let running: Promise<{ ok: boolean; error?: string }> | null = null;

export function refreshSchool(): Promise<{ ok: boolean; error?: string }> {
  running ??= run().finally(() => { running = null; });
  return running;
}

async function run(): Promise<{ ok: boolean; error?: string }> {
  const doc = load();
  const at = Date.now();
  let error: string | undefined;
  try {
    const due = await d2l.dueItems(21);
    const overdue = await d2l.overdue();
    const quizzes = await d2l.quizzes();
    const grades = await d2l.grades();
    doc.cache = { at, signedIn: true, due, overdue, quizzes, grades: grades.map((g) => ({ course: g.course, final: g.final })) };
    doc.gradeHistory = addGrades(doc.gradeHistory, grades.map((g) => ({ course: g.course, grade: g.final })), isoDay());

    // On time: every assignment due in the last 8 weeks, and when his submission went in.
    const since = at - 56 * 86_400_000;
    const recent = (await d2l.assignments(undefined, false)).filter((a) => a.due && Date.parse(a.due) >= since && Date.parse(a.due) <= at);
    const fresh: OnTimeItem[] = [];
    for (const a of recent.slice(0, 60)) {
      const mine = await d2l.mySubmission(a.courseId, a.folderId).catch(() => ({ submittedAt: undefined }));
      fresh.push({ course: a.course, name: a.name, due: a.due!, submittedAt: mine.submittedAt });
    }
    const key = (i: OnTimeItem) => `${i.course}|${i.name}|${i.due}`;
    const keep = doc.onTime.filter((o) => !fresh.some((f) => key(f) === key(o)));
    doc.onTime = [...keep, ...fresh];
  } catch (e) {
    error = d2l.isAuthError(e) ? 'D2L is not signed in' : e instanceof Error ? e.message : String(e);
    doc.cache = doc.cache ? { ...doc.cache, signedIn: !d2l.isAuthError(e), error } : { at, signedIn: false, due: [], overdue: [], quizzes: [], grades: [], error };
  }
  try {
    const h = await ps.home();
    if (h.courses.length) doc.ps = { at, courses: h.courses };
  } catch { /* not signed in to PowerSchool yet - fine */ }
  save(doc);
  return error ? { ok: false, error } : { ok: true };
}

let timer: ReturnType<typeof setInterval> | null = null;

export function startSchoolRefresh(busy: () => boolean): void {
  if (timer) return;
  const tick = () => { if (!busy()) void refreshSchool().catch(() => undefined); };
  setTimeout(tick, 3 * 60_000);
  timer = setInterval(tick, 2 * 3600_000);
}
