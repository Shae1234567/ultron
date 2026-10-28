import * as d2l from '../../d2l';
import { listNotes, readNote, safeName, writeNote } from '../../memory/vault';
import { searchMemory, syncIndex } from '../../memory/semantic';
import { load, save } from './store';

/*
 * The course library: what teachers post on D2L (unit notes, slides, worksheets, readings),
 * read once into Ultron's own vault as School/<Course>/<Unit>/<Topic>.md - private notes, in
 * the shared brain - so Chiron explains from the actual notes and Sphinx quizzes from what is
 * really on the test. Only new or changed topics are read again. Read-only towards D2L.
 */

const MAX_NOTE = 60_000;
const BUDGET_MS = 4 * 60_000;

const relFor = (course: string, module: string, title: string) =>
  ['School', safeName(course), ...module.split(' > ').slice(0, 3).map(safeName), `${safeName(title)}.md`].join('/');

/** Reads a course's (or every course's) new and changed topics into the library. */
export async function syncLibrary(courseQuery?: string, max = 40): Promise<{ read: string[]; skipped: number; failed: string[]; left: number }> {
  const started = Date.now();
  const doc = load();
  // Links too (12 Oct 2026): teachers' Google Docs and Slides, YouTube lessons and web pages are course material.
  const all = (await d2l.contents(courseQuery)).flatMap((c) => c.topics).filter((t) => t.kind === 'file' || t.kind === 'html' || t.kind === 'link');
  // Newest first: this unit's notes matter more than September's.
  const todo = all
    .filter((t) => { const k = doc.library[`${t.courseId}:${t.topicId}`]; return !k || (t.modified && k.modified !== t.modified); })
    .sort((a, b) => (b.modified ?? '').localeCompare(a.modified ?? ''));
  const read: string[] = [];
  const failed: string[] = [];
  const written: string[] = [];
  for (const t of todo.slice(0, max)) {
    if (Date.now() - started > BUDGET_MS) break;
    const r = await d2l.readTopic(t.courseId, t.topicId).catch((e: unknown) => ({ error: e instanceof Error ? e.message : String(e) }));
    if ('error' in r) { failed.push(`${t.title}: ${r.error}`); if (/not signed in/i.test(r.error)) break; continue; }
    // A link that couldn't be opened (private, or Drive not connected) is reported, not filed as a note.
    if (r.kind === 'link') { failed.push(`${t.title}: ${r.text.replace(/^.*could not be read here: /s, '')}`); continue; }
    const rel = relFor(t.course, t.module, t.title);
    const body = r.text.length > MAX_NOTE ? `${r.text.slice(0, MAX_NOTE)}\n\n[... cut short]` : r.text;
    writeNote(rel, [
      '---', 'source: D2L', `course: "${t.course.replace(/"/g, "'")}"`, `unit: "${t.module.replace(/"/g, "'")}"`, `topic: ${t.topicId}`,
      `kind: ${r.kind}`, t.modified ? `modified: ${t.modified}` : null, `read: ${new Date().toISOString()}`, 'private: true', '---', '',
      `# ${t.title}`, '', `*${t.course} - ${t.module}*`, '', body, '',
    ].filter((l): l is string => l !== null).join('\n'));
    doc.library[`${t.courseId}:${t.topicId}`] = { course: t.course, module: t.module, title: t.title, rel, modified: t.modified, chars: body.length, at: Date.now() };
    read.push(`${t.course}: ${t.title}`);
    written.push(rel);
  }
  save(doc);
  // Embed the new notes for meaning-search, in the background.
  if (written.length) void syncIndex(written).catch(() => undefined);
  return { read, skipped: all.length - todo.length, failed: failed.slice(0, 8), left: Math.max(0, todo.length - read.length - failed.length) };
}

export interface LibraryHit { rel: string; title: string; course: string; text: string; score: number }

const terms = (q: string) => [...new Set(q.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2))];

/** Plain word search over the library notes - works even when meaning-search isn't available. Pure apart from reading notes. */
export function keywordSearch(query: string, notes: { rel: string; content: string }[], k = 6): LibraryHit[] {
  const ts = terms(query);
  if (!ts.length) return [];
  const hits: LibraryHit[] = [];
  for (const n of notes) {
    const lower = n.content.toLowerCase();
    const score = ts.reduce((s, t) => s + (lower.includes(t) ? 1 + Math.min(4, lower.split(t).length - 2) * 0.1 : 0), 0) / ts.length;
    if (score <= 0) continue;
    // The best passage: the paragraph with most of the words.
    const paras = n.content.split(/\n\s*\n/).filter((p) => p.trim() && !p.startsWith('---'));
    const best = paras.map((p) => ({ p, s: ts.filter((t) => p.toLowerCase().includes(t)).length })).sort((a, b) => b.s - a.s)[0]?.p ?? '';
    const parts = n.rel.split('/');
    hits.push({ rel: n.rel, title: parts[parts.length - 1].replace(/\.md$/, ''), course: parts[1] ?? '', text: best.slice(0, 1500), score: Math.round(score * 100) / 100 });
  }
  return hits.sort((a, b) => b.score - a.score).slice(0, k);
}

/** Searches the library: meaning-search first (when the index has it), word search as the fallback. */
export async function searchLibrary(query: string, course?: string, k = 6): Promise<LibraryHit[]> {
  const prefix = course ? `School/${safeName(course)}` : 'School/';
  const inCourse = (rel: string) => rel.startsWith(prefix) || (course ? rel.toLowerCase().startsWith(`school/`) && rel.toLowerCase().includes(course.toLowerCase()) : false);
  let hits: LibraryHit[] = [];
  try {
    hits = (await searchMemory(query, 30)).filter((h) => inCourse(h.rel)).slice(0, k)
      .map((h) => ({ rel: h.rel, title: h.title, course: h.rel.split('/')[1] ?? '', text: h.text.slice(0, 1500), score: Math.round(h.score * 100) / 100 }));
  } catch { /* no embeddings right now */ }
  if (hits.length >= Math.min(3, k)) return hits;
  const notes = listNotes().filter((n) => inCourse(n.rel)).map((n) => ({ rel: n.rel, content: readNote(n.rel) ?? '' }));
  const words = keywordSearch(query, notes, k);
  return [...hits, ...words.filter((w) => !hits.some((h) => h.rel === w.rel))].slice(0, k);
}
