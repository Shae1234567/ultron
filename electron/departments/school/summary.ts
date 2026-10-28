import { gradeTrend, onTimeNumber, type SchoolDoc } from './store';

/*
 * What School knows right now, in the lines its agents read (the fast path's source) and the
 * numbers the council shows. Says plainly what isn't known - never fills a gap with a guess.
 */

export interface StudyState { streak: number; todayMinutes: number; recent: { subject: string; startedAt: number; finished?: boolean }[] }

const day = (iso: string | null | undefined) => {
  if (!iso) return 'no date';
  const d = new Date(iso);
  return `${d.toLocaleDateString('en-CA', { weekday: 'short', month: 'short', day: 'numeric' })} ${d.toLocaleTimeString('en-CA', { hour: '2-digit', minute: '2-digit', hour12: false })}`;
};

/** "Never miss twice": did yesterday go by with no study session? Pure. */
export function missedYesterday(study: StudyState, now = Date.now()): boolean {
  const y = new Date(now - 86_400_000).toDateString();
  const t = new Date(now).toDateString();
  const days = new Set(study.recent.filter((s) => s.finished).map((s) => new Date(s.startedAt).toDateString()));
  return !days.has(y) && !days.has(t);
}

export interface SchoolNumber { onTime: number; total: number; late: number; missing: number; trend: ReturnType<typeof gradeTrend> }

export function schoolNumber(doc: SchoolDoc, now = Date.now()): SchoolNumber {
  const n = onTimeNumber(doc.onTime, now);
  return { ...n, trend: gradeTrend(doc.gradeHistory) };
}

export function schoolSnapshotText(doc: SchoolDoc, study: StudyState | null, now = Date.now()): string {
  const c = doc.cache;
  if (!c) {
    return 'SCHOOL DATA: not loaded yet - D2L has not been read since Ultron started. Use the d2l_ tools to look, and if they say not signed in, ask the operator to sign in from the Apps panel. Never invent due dates, marks or quiz times.';
  }
  const lines: string[] = [`SCHOOL DATA (from D2L, read ${day(new Date(c.at).toISOString())}${doc.ps ? '; PowerSchool too' : ''}):`];
  if (!c.signedIn) lines.push(`- D2L is NOT signed in${c.error && c.error !== 'D2L is not signed in' ? ` (${c.error})` : ''} - what follows is the last good copy. Ask the operator to sign in from the Apps panel for fresh data.`);
  const week = now + 7 * 86_400_000;
  const soon = c.due.filter((d) => !d.completed && d.due && Date.parse(d.due) >= now - 3600_000 && Date.parse(d.due) <= week);
  lines.push(soon.length ? `- Due in the next 7 days: ${soon.slice(0, 8).map((d) => `${d.course} - ${d.name} (${d.type}, ${day(d.due)})`).join('; ')}.` : '- Nothing due in the next 7 days on D2L.');
  if (c.overdue.length) lines.push(`- OVERDUE: ${c.overdue.slice(0, 6).map((d) => `${d.course} - ${d.name}`).join('; ')}.`);
  const open = c.quizzes.filter((q) => q.openNow);
  const upcoming = c.quizzes.filter((q) => !q.openNow && q.start && Date.parse(q.start) > now && Date.parse(q.start) <= now + 14 * 86_400_000);
  if (open.length) lines.push(`- QUIZ OPEN NOW on D2L: ${open.map((q) => `${q.course} - ${q.name}${q.end ? ` (closes ${day(q.end)})` : ''}`).join('; ')}. The live-quiz rule applies.`);
  if (upcoming.length) lines.push(`- Quizzes coming up: ${upcoming.slice(0, 5).map((q) => `${q.course} - ${q.name} (${day(q.start)})`).join('; ')}.`);
  const trend = gradeTrend(doc.gradeHistory);
  lines.push(trend.length
    ? `- Grades: ${trend.map((t) => `${t.course} ${t.grade}${t.change ? ` (${t.change > 0 ? 'up' : 'down'} ${Math.abs(t.change)} since ${t.since})` : ''}`).join('; ')}.`
    : '- Grades: none shown on D2L yet.');
  if (doc.ps?.courses.length) {
    lines.push(`- PowerSchool: ${doc.ps.courses.map((p) => `${p.course}${Object.keys(p.grades).length ? ` ${Object.entries(p.grades).map(([k, v]) => `${k} ${v}`).join(', ')}` : ''}${p.absences ? `, ${p.absences} absences` : ''}${p.tardies ? `, ${p.tardies} lates` : ''}`).join('; ')}.`);
  }
  const n = onTimeNumber(doc.onTime, now);
  if (n.total) lines.push(`- Assignments due in the last 8 weeks: ${n.onTime} of ${n.total} in on time${n.late ? `, ${n.late} late` : ''}${n.missing ? `, ${n.missing} not submitted` : ''}.`);
  const lib = Object.values(doc.library);
  if (lib.length) {
    const courses = [...new Set(lib.map((l) => l.course))];
    lines.push(`- Course library: ${lib.length} topic${lib.length === 1 ? '' : 's'} from ${courses.join(', ')} read in - search it with school_library_search before explaining.`);
  } else {
    lines.push('- Course library: empty - school_library_sync reads a course\'s notes and files in (worth doing before tutoring or quizzing).');
  }
  if (study) {
    lines.push(`- Study: ${study.streak ? `${study.streak}-day focus streak` : 'no focus streak right now'}${study.todayMinutes ? `, ${study.todayMinutes} min today` : ''}${missedYesterday(study, now) && study.recent.length ? ' - yesterday was missed, so today matters (never miss twice)' : ''}.`);
  }
  return lines.join('\n');
}
