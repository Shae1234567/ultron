import type { DepartmentId } from '../brain/types';
import { focusState } from '../focus';
import { snapshotText } from './health/summary';
import { load as loadSchool } from './school/store';
import { schoolSnapshotText } from './school/summary';
import { historySnapshotText } from './history/store';
import { projectsSnapshotText } from './projects/store';
import { mediaSnapshotText } from './media/agents';

/** A department's live data, in the lines its agents read before working (the fast path's source). */
export function departmentData(id: DepartmentId): string {
  try {
    if (id === 'health') return snapshotText();
    if (id === 'school') {
      const f = focusState();
      return schoolSnapshotText(loadSchool(), { streak: f.streak, todayMinutes: f.todayMinutes, recent: f.recent });
    }
    if (id === 'history') return historySnapshotText();
    if (id === 'projects') return projectsSnapshotText();
    if (id === 'media') return mediaSnapshotText();
  } catch { /* a broken log never stops an answer - the agent just works without it */ }
  return '';
}

/**
 * Quizzes open on D2L right now, by name - from School's copy, with "now" worked out from each
 * quiz's own window (the copy may be an hour old). The live-quiz rule is checked against these.
 */
export function openQuizzes(now = Date.now()): string[] {
  try {
    const qs = loadSchool().cache?.quizzes ?? [];
    return qs.filter((q) => {
      const s = q.start ? Date.parse(q.start) : -Infinity;
      const e = q.end ? Date.parse(q.end) : q.due ? Date.parse(q.due) : Infinity;
      return s <= now && now <= e && Number.isFinite(e);
    }).map((q) => `${q.course} - ${q.name}`);
  } catch {
    return [];
  }
}
