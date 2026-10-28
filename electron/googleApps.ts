import { connectedApps, findActions, runAction } from './composio';

/*
 * Google Slides and Docs without Drive (12 Oct 2026).
 *  - Published to the web ("File > Share > Publish", the /d/e/2PACX-... links teachers embed in D2L):
 *    Google's own viewer page carries every slide as a picture whose words are in its accessibility
 *    labels - read straight from there, no account or connection needed. Published Docs and Sheets
 *    are plain web pages.
 *  - Through the Google Slides or Google Docs app in Apps (Composio): each app's own "get" action,
 *    turned into text - slides in order with their tables and speaker notes.
 * Read-only.
 */

const rec = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

/* ── published to the web ─────────────────────────────────────────────── */

const unescapeJs = (s: string) => s
  .replace(/\\x([0-9a-f]{2})/gi, (_m, x: string) => String.fromCharCode(parseInt(x, 16)))
  .replace(/\\u([0-9a-f]{4})/gi, (_m, x: string) => String.fromCharCode(parseInt(x, 16)))
  .replace(/\\\//g, '/');
const entities = (s: string) => s
  .replace(/&#x([0-9a-f]+);/gi, (_m, x: string) => String.fromCodePoint(parseInt(x, 16)))
  .replace(/&#(\d+);/g, (_m, d: string) => String.fromCodePoint(Number(d)))
  .replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;/g, "'").replace(/&amp;/g, '&');

/** A published deck's viewer page as text: each slide's words, in order. Pure, for tests. */
export function publishedSlidesText(html: string): { title?: string; slides: string[] } {
  const title = entities(/<title>([^<]*)<\/title>/i.exec(html)?.[1] ?? '').replace(/\s*-\s*Google (Slides|Präsentationen|Diapositivas)\s*$/i, '').trim() || undefined;
  const slides: string[] = [];
  let i = 0;
  for (;;) {
    const a = html.indexOf('\\x3csvg', i);
    if (a < 0) break;
    const b = html.indexOf('\\x3c\\/svg\\x3e', a);
    if (b < 0) break;
    const svg = unescapeJs(html.slice(a, b + 14));
    const words = [...svg.matchAll(/aria-label="([^"]*)"/g)].map((m) => entities(m[1]).trim()).filter(Boolean);
    slides.push(words.join('\n'));
    i = b + 14;
  }
  return { title, slides };
}

export interface PublishedRead { kind: string; title?: string; text: string }

/** A /d/e/... published Google file, read from the web with no account. */
export async function readPublished(what: 'presentation' | 'document' | 'spreadsheets', pubId: string, signal?: AbortSignal): Promise<PublishedRead | { error: string }> {
  const { htmlText } = await import('./docs');
  const url = what === 'presentation' ? `https://docs.google.com/presentation/d/e/${pubId}/pub?start=false&loop=false`
    : what === 'document' ? `https://docs.google.com/document/d/e/${pubId}/pub`
      : `https://docs.google.com/spreadsheets/d/e/${pubId}/pubhtml`;
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36' }, signal: signal ?? AbortSignal.timeout(30_000) });
  if (!res.ok) return { error: `Google answered ${res.status} - the file may have been unpublished.` };
  const html = await res.text();
  if (what === 'presentation') {
    const deck = publishedSlidesText(html);
    if (!deck.slides.length) return { error: 'That published deck came back without any slides - it may have been unpublished.' };
    return { kind: 'Google Slides (published)', title: deck.title, text: deck.slides.map((s, n) => `## Slide ${n + 1}\n${s || '(a picture with no text)'}`).join('\n\n') };
  }
  const title = entities(/<title>([^<]*)<\/title>/i.exec(html)?.[1] ?? '').replace(/\s*-\s*Google (Docs|Sheets)\s*$/i, '').trim() || undefined;
  return { kind: what === 'document' ? 'Google Doc (published)' : 'Google Sheet (published)', title, text: htmlText(html) };
}

/* ── through the Google Slides / Docs apps ───────────────────────────── */

const textOf = (t: unknown): string => arr(rec(t).textElements).map((e) => String(rec(rec(e).textRun).content ?? rec(rec(e).autoText).content ?? '')).join('');

/** A shape's or table's words on a slide, in order. */
function elementText(el: unknown): string[] {
  const e = rec(el);
  if (e.shape) return [textOf(rec(e.shape).text).trim()].filter(Boolean);
  if (e.table) {
    return arr(rec(e.table).tableRows).map((r) => arr(rec(r).tableCells).map((c) => textOf(rec(c).text).trim()).join(' | ')).filter((row) => row.replace(/[\s|]/g, ''));
  }
  if (e.elementGroup) return arr(rec(e.elementGroup).children).flatMap(elementText);
  return [];
}

/** The Slides API's presentation as text: every slide's words, tables as rows, and speaker notes. Pure, for tests. */
export function slidesJsonText(json: unknown): { title?: string; text: string; slides: number } {
  // Composio wraps it differently by connection - find the object with the slides in it.
  const find = (v: unknown, depth = 0): Record<string, unknown> | null => {
    if (depth > 5) return null;
    if (typeof v === 'string' && v.trim().startsWith('{')) { try { return find(JSON.parse(v), depth + 1); } catch { return null; } }
    const o = rec(v);
    if (Array.isArray(o.slides)) return o;
    for (const x of Object.values(o)) { const r = find(x, depth + 1); if (r) return r; }
    return null;
  };
  const p = find(json) ?? {};
  const slides = arr(p.slides);
  const blocks = slides.map((s, n) => {
    const slide = rec(s);
    const words = arr(slide.pageElements).flatMap(elementText);
    const notesPage = rec(rec(slide.slideProperties).notesPage);
    const notesId = String(rec(notesPage.notesProperties).speakerNotesObjectId ?? '');
    const notes = arr(notesPage.pageElements).filter((e) => !notesId || rec(e).objectId === notesId).flatMap(elementText).join(' ').trim();
    return `## Slide ${n + 1}\n${words.join('\n') || '(no text)'}${notes ? `\nSpeaker notes: ${notes}` : ''}`;
  });
  return { title: typeof p.title === 'string' ? p.title : undefined, text: blocks.join('\n\n'), slides: slides.length };
}

/** The Docs API's document as text: paragraphs and tables in order. Pure, for tests. */
export function docsJsonText(json: unknown): { title?: string; text: string } {
  const find = (v: unknown, depth = 0): Record<string, unknown> | null => {
    if (depth > 5) return null;
    if (typeof v === 'string' && v.trim().startsWith('{')) { try { return find(JSON.parse(v), depth + 1); } catch { return null; } }
    const o = rec(v);
    if (o.body && Array.isArray(rec(o.body).content)) return o;
    for (const x of Object.values(o)) { const r = find(x, depth + 1); if (r) return r; }
    return null;
  };
  const d = find(json) ?? {};
  const walk = (content: unknown[]): string[] => content.flatMap((c) => {
    const x = rec(c);
    if (x.paragraph) return [arr(rec(x.paragraph).elements).map((e) => String(rec(rec(e).textRun).content ?? '')).join('').replace(/\n$/, '')];
    if (x.table) return arr(rec(x.table).tableRows).map((r) => arr(rec(r).tableCells).map((cell) => walk(arr(rec(cell).content)).join(' ').trim()).join(' | '));
    return [];
  });
  return { title: typeof d.title === 'string' ? d.title : undefined, text: walk(arr(rec(d.body).content)).join('\n').replace(/\n{3,}/g, '\n\n').trim() };
}

const ACTION_CACHE = new Map<string, { slug: string; idKey: string } | null>();

/** Which connected app reads this kind of Google file, and its "get" action (looked up once). */
async function getAction(kind: 'slides' | 'docs'): Promise<{ slug: string; idKey: string } | null> {
  if (ACTION_CACHE.has(kind)) return ACTION_CACHE.get(kind)!;
  const apps = (await connectedApps()).map((a) => a.slug);
  const app = kind === 'slides' ? (apps.includes('googleslides') ? 'googleslides' : apps.includes('googlesuper') ? 'googlesuper' : null)
    : (apps.includes('googledocs') ? 'googledocs' : apps.includes('googlesuper') ? 'googlesuper' : null);
  if (!app) { ACTION_CACHE.set(kind, null); return null; }
  const query = kind === 'slides' ? 'get a Google Slides presentation by id' : 'get a Google Docs document by id';
  const want = kind === 'slides' ? /PRESENTATION.*GET|GET.*PRESENTATION|SLIDES_PRESENTATIONS_GET/ : /GET_DOCUMENT|DOCUMENT_BY_ID|DOCUMENTS_GET/;
  try {
    const found = (await findActions(query, app, 8)).actions;
    const a = found.find((x) => want.test(x.slug));
    const keys = Object.keys(a?.params ?? {});
    const hit = a ? { slug: a.slug, idKey: keys.find((k) => /presentation_?id|document_?id|^id$/i.test(k)) ?? (kind === 'slides' ? 'presentation_id' : 'document_id') } : null;
    ACTION_CACHE.set(kind, hit);
    return hit;
  } catch {
    return null;
  }
}

export function resetGoogleApps(): void { ACTION_CACHE.clear(); }

/** A Google Slides deck or Doc by id, through the Google Slides / Docs app - null when neither app is connected. */
export async function readViaApp(kind: 'slides' | 'docs', id: string): Promise<{ kind: string; title?: string; text: string } | { error: string } | null> {
  const a = await getAction(kind);
  if (!a) return null;
  const r = await runAction(a.slug, { [a.idKey]: id });
  if (!r.ok) return { error: `Google ${kind === 'slides' ? 'Slides' : 'Docs'} wouldn't open it for your account (${(r.error ?? '').slice(0, 160)}). It may not be shared with you.` };
  if (kind === 'slides') {
    const s = slidesJsonText(r.data);
    return s.slides ? { kind: 'Google Slides', title: s.title, text: s.text } : { error: 'Google Slides answered, but without any slides.' };
  }
  const d = docsJsonText(r.data);
  return d.text ? { kind: 'Google Doc', title: d.title, text: d.text } : { error: 'Google Docs answered, but the document came back empty.' };
}
