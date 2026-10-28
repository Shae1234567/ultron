import { readDoc, writeDoc } from '../../store';
import { emit } from '../../brain/events';
import type { D2LDueItem, D2LQuiz } from '../../d2l';
import type { PSCourse } from '../../powerschool';

/*
 * The School department's own copy of what matters, refreshed in the background from D2L (and
 * PowerSchool once he signs in): what's due, what's overdue, quiz windows, grades with their
 * history (for the trend), whether assignments went in on time, and what the course library
 * holds. Agents answer simple questions from this in one call - no D2L round trip - and the
 * council shows School's number from it. Private, like everything School keeps.
 */

export interface GradePoint { date: string; course: string; grade: string; pct: number | null }
export interface OnTimeItem { course: string; name: string; due: string; submittedAt?: string }
export interface LibraryItem { course: string; module: string; title: string; rel: string; modified?: string; chars: number; at: number }

export interface SchoolDoc {
  v: 1;
  /** The last refresh from D2L / PowerSchool; null before the first one. */
  cache: {
    at: number;
    signedIn: boolean;
    due: D2LDueItem[];
    overdue: D2LDueItem[];
    quizzes: D2LQuiz[];
    grades: { course: string; final?: string }[];
    error?: string;
  } | null;
  ps: { at: number; courses: PSCourse[] } | null;
  gradeHistory: GradePoint[];
  onTime: OnTimeItem[];
  /** "courseId:topicId" -> what was read into the library. */
  library: Record<string, LibraryItem>;
}

const DOC = 'departments/school.json';
const empty = (): SchoolDoc => ({ v: 1, cache: null, ps: null, gradeHistory: [], onTime: [], library: {} });

export function load(): SchoolDoc {
  const d = readDoc<Partial<SchoolDoc>>(DOC, empty());
  return {
    v: 1,
    cache: d.cache && typeof d.cache === 'object' ? d.cache : null,
    ps: d.ps && typeof d.ps === 'object' ? d.ps : null,
    gradeHistory: Array.isArray(d.gradeHistory) ? d.gradeHistory : [],
    onTime: Array.isArray(d.onTime) ? d.onTime : [],
    library: d.library && typeof d.library === 'object' ? d.library : {},
  };
}

export function save(d: SchoolDoc): void {
  const cutoff = new Date(Date.now() - 200 * 86_400_000).toISOString().slice(0, 10);
  writeDoc(DOC, { ...d, gradeHistory: d.gradeHistory.filter((g) => g.date >= cutoff).slice(-600), onTime: d.onTime.slice(-200) });
  emit('school:changed', { at: Date.now() });
}

/** "87.5 %", "A (92%)", "18/20", "B+" -> a percentage where one can be read. Pure. */
export function percentOf(grade: string): number | null {
  const pct = /(\d{1,3}(?:\.\d+)?)\s*%/.exec(grade);
  if (pct) return Math.min(100, Number(pct[1]));
  const frac = /(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)/.exec(grade);
  if (frac && Number(frac[2]) > 0) return Math.round((Number(frac[1]) / Number(frac[2])) * 1000) / 10;
  const bare = /^\s*(\d{1,3}(?:\.\d+)?)\s*$/.exec(grade);
  if (bare && Number(bare[1]) <= 100) return Number(bare[1]);
  return null;
}

/** Adds today's grades to the history, only where a course's grade changed. Pure. */
export function addGrades(history: GradePoint[], grades: { course: string; grade?: string }[], date: string): GradePoint[] {
  const out = [...history];
  for (const g of grades) {
    if (!g.grade || g.grade === '-') continue;
    const last = [...out].reverse().find((h) => h.course === g.course);
    if (last && last.grade === g.grade) continue;
    out.push({ date, course: g.course, grade: g.grade, pct: percentOf(g.grade) });
  }
  return out;
}

/** Each course's latest grade and how it moved since the one before. Pure. */
export function gradeTrend(history: GradePoint[]): { course: string; grade: string; pct: number | null; change: number | null; since?: string }[] {
  const courses = [...new Set(history.map((h) => h.course))];
  return courses.map((course) => {
    const pts = history.filter((h) => h.course === course);
    const last = pts[pts.length - 1];
    const prev = [...pts].reverse().find((p) => p !== last && p.pct !== null);
    const change = last.pct !== null && prev?.pct !== undefined && prev.pct !== null ? Math.round((last.pct - prev.pct) * 10) / 10 : null;
    return { course, grade: last.grade, pct: last.pct, change, since: prev?.date };
  });
}

/** School's "is it helping?" number: assignments due in the last 8 weeks that went in on time. Pure. */
export function onTimeNumber(items: OnTimeItem[], now = Date.now()): { onTime: number; late: number; missing: number; total: number } {
  const since = now - 56 * 86_400_000;
  const due = items.filter((i) => { const t = Date.parse(i.due); return t >= since && t <= now; });
  let onTime = 0, late = 0, missing = 0;
  for (const i of due) {
    if (!i.submittedAt) missing++;
    else if (Date.parse(i.submittedAt) <= Date.parse(i.due) + 60_000) onTime++;
    else late++;
  }
  return { onTime, late, missing, total: due.length };
}
