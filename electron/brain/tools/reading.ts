import { driveSearch } from '../../drive';
import { GOOGLE_EXPORT } from '../../drive';
import { readDrive, readLink, type ReadOutcome } from '../../reader';
import { A, N, S, num, obj, str, type AgentTool, type ToolContext } from './types';

/*
 * Reading anything (12 Oct 2026): a link of any kind, and Google Drive. All reads - no tool here
 * changes, posts or shares anything. Long results come in pages: call again with start.
 */

/** A reader result cut to what the caller can see, with where to carry on from. */
export function shaped(r: ReadOutcome, ctx: ToolContext, start = 0, max = 0): Record<string, unknown> {
  if ('error' in r) return { error: r.error };
  const budget = Math.max(2000, Math.min(max || 14_000, (ctx.resultBudget ?? 14_000) - 900));
  const text = r.text.slice(start, start + budget);
  const more = start + budget < r.text.length;
  return {
    title: r.title, kind: r.kind, url: r.url, pages: r.pages, seen_by: r.seenBy,
    text,
    next_start: more ? start + budget : undefined,
    note: more ? `Showing characters ${start}-${start + budget} of ${r.text.length}. Call again with start: ${start + budget} to read on.` : r.truncated ? 'The source itself was cut short.' : undefined,
    links: r.links?.length ? r.links.slice(0, 40).map((l) => `${l.text} -> ${l.url}${l.where === 'web' ? '' : ` [${l.where}]`}`) : undefined,
  };
}

const pagesArg = (a: Record<string, unknown>) => (Array.isArray(a.pages) ? (a.pages as unknown[]).map(Number).filter((n) => Number.isInteger(n) && n > 0) : undefined);

export const readingTools: AgentTool[] = [
  {
    name: 'read_link',
    owner: 'argus',
    description: 'Read whatever is at a link, in one step: a Google Doc, Slides or Sheet or any Drive file (through his Google connection), a YouTube video (its transcript), a D2L page or file (over his D2L sign-in, read-only), a PDF, slide deck or document on the web (scanned pages and pictures are read by eye), or an ordinary web page (with its links). Long results: call again with start.',
    parameters: obj({
      url: S('The link'),
      start: N('Character to start from, to read on (default 0)'),
      pages: A('A scanned PDF only: page numbers to read by eye', { type: 'number' }),
    }, ['url']),
    label: (a) => `read ${str(a, 'url').replace(/^https?:\/\/(www\.)?/, '').slice(0, 60)}`,
    run: async (a, ctx) => shaped(await readLink(str(a, 'url'), { signal: ctx.signal, pages: pagesArg(a) }), ctx, num(a, 'start', 0)),
  },
  {
    name: 'drive_search',
    owner: 'hermes',
    description: 'Search his Google Drive (his own files and ones shared with him) by name or by words inside them; with no query, his most recently changed files. Gives names, types, ids and links - read one with drive_read.',
    parameters: obj({ query: S('Words in the file name or inside it (optional)'), max: N('How many (default 12, up to 50)') }),
    label: (a) => `Drive: ${str(a, 'query') || 'recent files'}`,
    run: async (a) => {
      try {
        const files = await driveSearch(str(a, 'query'), Math.min(50, num(a, 'max', 12)));
        if (!files.length) return { files: [], note: str(a, 'query') ? 'Nothing in Drive matches that.' : 'Drive is empty.' };
        return {
          files: files.map((f) => ({
            name: f.name, type: GOOGLE_EXPORT[f.mimeType]?.label ?? (f.mimeType === 'application/vnd.google-apps.folder' ? 'folder' : f.mimeType.split('/').pop()),
            id: f.id, modified: f.modified, owner: f.owner, link: f.link,
          })),
        };
      } catch (e) {
        return { error: e instanceof Error ? e.message : String(e) };
      }
    },
  },
  {
    name: 'drive_read',
    owner: 'hermes',
    description: 'Read a Google Drive file by link, id or name: Google Docs (as text with tables), Slides (with speaker notes), Sheets (every tab), PDFs (scans read by eye), Word, PowerPoint, Excel, pictures (read by eye) and more. A folder lists its files. Long results: call again with start.',
    parameters: obj({
      file: S('A Drive or Docs link, a file id, or the file\'s name'),
      start: N('Character to start from, to read on (default 0)'),
      pages: A('A scanned PDF only: page numbers to read by eye', { type: 'number' }),
    }, ['file']),
    label: (a) => `read from Drive: ${str(a, 'file').slice(0, 50)}`,
    run: async (a, ctx) => shaped(await readDrive(str(a, 'file'), { signal: ctx.signal, pages: pagesArg(a) }), ctx, num(a, 'start', 0)),
  },
];
