import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { app, BrowserWindow } from 'electron';
import { extractText, htmlText } from './docs';
import { chat } from './brain/llm';
import { driveFetch, GOOGLE_EXPORT, isDriveLink } from './drive';

/*
 * Ultron reads (almost) anything (12 Oct 2026). One place every tool goes through:
 *  - bytes  -> docs.ts for documents (PDF, Word, PowerPoint, Excel, OpenDocument, e-books, old
 *              Office, text of every kind); pictures and scanned PDFs are read by eye - the
 *              vision model transcribes the words and describes the diagrams.
 *  - a link -> Google Docs/Slides/Sheets and Drive files (drive.ts), YouTube (its transcript),
 *              D2L pages and files (over his D2L sign-in, read-only), and anything else on the
 *              web (a page as text, a PDF or slide deck as a document).
 * Everything is a read. Nothing here posts, submits or changes anything anywhere.
 */

export interface ReadResult {
  kind: string;
  text: string;
  title?: string;
  url?: string;
  pages?: number;
  truncated?: boolean;
  /** Which brain read a picture or a scan. */
  seenBy?: string;
  /** Links on a page (D2L and web pages), for following. */
  links?: PageLink[];
}
export type ReadOutcome = ReadResult | { error: string };
export interface PageLink { text: string; url: string; where: 'd2l' | 'drive' | 'youtube' | 'file' | 'web' | 'embedded' }

const MAX_SCAN_PAGES = 6;

/* ── pictures ─────────────────────────────────────────────────────────── */

/** A picture's type from its first bytes (or its name). Pure, for tests. */
export function imageType(buf: Buffer, name = '', contentType = ''): string | null {
  if (buf[0] === 0x89 && buf.subarray(1, 4).toString('latin1') === 'PNG') return 'image/png';
  if (buf[0] === 0xff && buf[1] === 0xd8) return 'image/jpeg';
  if (buf.subarray(0, 4).toString('latin1') === 'GIF8') return 'image/gif';
  if (buf.subarray(0, 4).toString('latin1') === 'RIFF' && buf.subarray(8, 12).toString('latin1') === 'WEBP') return 'image/webp';
  if (buf[0] === 0x42 && buf[1] === 0x4d && /\.bmp$/i.test(name)) return 'image/bmp';
  if (/^image\/(png|jpe?g|gif|webp)$/i.test(contentType)) return contentType.toLowerCase().replace('jpg', 'jpeg');
  return null;
}

const BY_EYE = [
  'You are reading a picture of a page for someone who cannot see it.',
  'First transcribe every word you can read, exactly, in reading order - keep headings, numbered questions, tables (as rows, cells separated by " | ") and labels on diagrams.',
  'Then, under "What it shows:", describe in a few plain sentences anything that is not words: diagrams, graphs (axes, trend), maps, photos, handwriting you can only partly read.',
  'Never invent text. Write [unclear] where you cannot read something.',
].join('\n');

async function byEye(images: { mimeType: string; data: string }[], what: string, signal?: AbortSignal): Promise<{ text: string; by: string }> {
  const res = await chat({ system: BY_EYE, messages: [{ role: 'user', content: `This is ${what}.`, images }], temperature: 0, signal });
  if (!res.text.trim()) throw new Error('the vision model returned nothing');
  return { text: res.text.trim(), by: res.provider ?? 'vision' };
}

/* ── scanned PDFs: draw the pages, then read them by eye ─────────────── */

let renderer: { win: BrowserWindow; ready: Promise<void> } | null = null;
let rendererTimer: ReturnType<typeof setTimeout> | null = null;

/** A hidden window with pdf.js in it, to draw pages as pictures. Closed again after a minute idle. */
function pdfRenderer(): Promise<BrowserWindow> {
  if (rendererTimer) clearTimeout(rendererTimer);
  rendererTimer = setTimeout(() => { renderer?.win.destroy(); renderer = null; }, 60_000);
  if (renderer && !renderer.win.isDestroyed()) return renderer.ready.then(() => renderer!.win);
  const lib = pathToFileURL(require.resolve('pdfjs-dist/legacy/build/pdf.mjs')).href;
  const worker = pathToFileURL(require.resolve('pdfjs-dist/legacy/build/pdf.worker.mjs')).href;
  const html = `<!doctype html><meta charset="utf-8"><title>pdf</title><script type="module">
import * as pdfjs from ${JSON.stringify(lib)};
pdfjs.GlobalWorkerOptions.workerSrc = ${JSON.stringify(worker)};
window.drawPages = async (b64, pages, width) => {
  const bin = atob(b64); const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const doc = await pdfjs.getDocument({ data: bytes, isEvalSupported: false }).promise;
  const images = [];
  for (const n of pages) {
    if (n < 1 || n > doc.numPages) continue;
    const page = await doc.getPage(n);
    const scale = Math.min(2.5, width / page.getViewport({ scale: 1 }).width);
    const vp = page.getViewport({ scale });
    const c = document.createElement('canvas');
    c.width = Math.ceil(vp.width); c.height = Math.ceil(vp.height);
    const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
    await page.render({ canvasContext: g, viewport: vp }).promise;
    images.push(c.toDataURL('image/jpeg', 0.82).split(',')[1]);
    page.cleanup();
  }
  const total = doc.numPages;
  await doc.destroy();
  return { images, total };
};
window.pdfReady = true;
</script>`;
  const dir = path.join(app.getPath('temp'), 'ultron-reader');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'pdf-pages.html');
  fs.writeFileSync(file, html);
  const win = new BrowserWindow({ show: false, width: 800, height: 600, webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true } });
  const ready = (async () => {
    await win.loadFile(file);
    for (let i = 0; i < 100; i++) {
      if (await win.webContents.executeJavaScript('window.pdfReady === true').catch(() => false)) return;
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error('the page drawer did not start');
  })();
  renderer = { win, ready };
  return ready.then(() => win);
}

/** PDF pages drawn as JPEG pictures (base64). */
export async function drawPdfPages(buf: Buffer, pages: number[], width = 1400): Promise<{ images: string[]; total: number }> {
  if (buf.length > 15 * 1024 * 1024) throw new Error('that scan is over 15 MB - too big to read by eye here');
  const win = await pdfRenderer();
  return win.webContents.executeJavaScript(`drawPages(${JSON.stringify(buf.toString('base64'))}, ${JSON.stringify(pages)}, ${width})`) as Promise<{ images: string[]; total: number }>;
}

/* ── bytes ────────────────────────────────────────────────────────────── */

export interface ReadOptions {
  signal?: AbortSignal;
  /** Which pages of a scanned PDF to read by eye (default the first six). */
  pages?: number[];
}

/** Any file's bytes as text: documents read directly, pictures and scans read by eye. */
export async function readBytes(buf: Buffer, name: string, contentType = '', opts: ReadOptions = {}): Promise<ReadOutcome> {
  const img = imageType(buf, name, contentType);
  if (img) {
    if (buf.length > 8 * 1024 * 1024) return { error: `${name} is a picture over 8 MB - too big to read by eye here.` };
    try {
      const r = await byEye([{ mimeType: img, data: buf.toString('base64') }], `a picture called "${name}"`, opts.signal);
      return { kind: 'picture (read by eye)', text: r.text, seenBy: r.by };
    } catch (e) {
      return { error: `${name} is a picture and it could not be read by eye: ${e instanceof Error ? e.message : String(e)}` };
    }
  }
  const r = await extractText(buf, name, contentType);
  if ('error' in r) return r;
  if (!r.scanned) return { kind: r.kind, text: r.text, pages: r.pages, truncated: r.truncated };
  // A scan: draw the pages and read them by eye, a page at a time.
  try {
    const want = (opts.pages?.length ? opts.pages : Array.from({ length: Math.min(r.pages ?? 1, MAX_SCAN_PAGES) }, (_, i) => i + 1)).slice(0, MAX_SCAN_PAGES);
    const drawn = await drawPdfPages(buf, want);
    const parts: string[] = [];
    let by = '';
    for (let i = 0; i < drawn.images.length; i++) {
      const seen = await byEye([{ mimeType: 'image/jpeg', data: drawn.images[i] }], `page ${want[i]} of a scanned PDF called "${name}"`, opts.signal);
      parts.push(`## Page ${want[i]}\n${seen.text}`);
      by = seen.by;
    }
    const more = drawn.total > want[want.length - 1] ? `\n\n[Scanned PDF: read pages ${want.join(', ')} of ${drawn.total} by eye. Ask for other pages (pages: [...]) to read more.]` : '';
    return { kind: 'scanned PDF (read by eye)', text: parts.join('\n\n') + more, pages: drawn.total, seenBy: by, truncated: Boolean(more) || undefined };
  } catch (e) {
    return { error: `${name} is a scanned PDF (pictures of pages) and reading it by eye failed: ${e instanceof Error ? e.message : String(e)}` };
  }
}

/* ── links ────────────────────────────────────────────────────────────── */

const FILE_EXT = /\.(pdf|docx?|pptx?|xlsx?|od[tps]|epub|rtf|csv|txt|md|png|jpe?g|gif|webp)(\?|#|$)/i;

/** What kind of place a link goes to. Pure, for tests. */
export function linkWhere(url: string, d2lOrigin?: string): PageLink['where'] {
  if (isDriveLink(url)) return 'drive';
  if (/^https?:\/\/(www\.|m\.)?(youtube\.com|youtu\.be)\//i.test(url)) return 'youtube';
  if (d2lOrigin && url.startsWith(d2lOrigin)) return 'd2l';
  if (FILE_EXT.test(url)) return 'file';
  return 'web';
}

const decode = (s: string) => s.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');

/** The links on a page (and what is embedded in it), absolute and de-duplicated. Pure, for tests. */
export function pageLinks(html: string, base: string, d2lOrigin?: string, max = 80): PageLink[] {
  const out: PageLink[] = [];
  const seen = new Set<string>();
  const add = (raw: string, text: string, embedded = false) => {
    const href = decode(raw.trim());
    if (!href || /^(javascript|mailto|tel|data):/i.test(href) || href.startsWith('#')) return;
    let url: string;
    try { url = new URL(href, base).href.replace(/#.*$/, ''); } catch { return; }
    if (!/^https?:/i.test(url) || seen.has(url)) return;
    seen.add(url);
    out.push({ text: htmlText(text).replace(/\s+/g, ' ').trim().slice(0, 100) || url.split('/').pop()?.slice(0, 60) || url, url, where: embedded ? 'embedded' : linkWhere(url, d2lOrigin) });
  };
  for (const m of html.matchAll(/<iframe\b[^>]*\bsrc\s*=\s*["']([^"']+)["'][^>]*>/gi)) add(m[1], 'embedded content', true);
  for (const m of html.matchAll(/<a\b[^>]*\bhref\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) { add(m[1], m[2]); if (out.length >= max) break; }
  return out.slice(0, max);
}

const title = (html: string) => htmlText(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? '').trim() || undefined;

/** A public web address: a page as text (with its links), a document as a document. */
async function readWeb(url: string, opts: ReadOptions): Promise<ReadOutcome> {
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36' }, signal: opts.signal ?? AbortSignal.timeout(30_000), redirect: 'follow' });
  if (!res.ok) return { error: `${new URL(url).hostname} answered ${res.status}.` };
  const finalUrl = res.url || url;
  const ct = res.headers.get('content-type') ?? '';
  if (Number(res.headers.get('content-length') ?? 0) > 25 * 1024 * 1024) return { error: 'That file is over 25 MB - too big to read here.' };
  const buf = Buffer.from(await res.arrayBuffer());
  if (/html/i.test(ct) || (!ct && /^\s*</.test(buf.subarray(0, 200).toString('utf8')))) {
    const html = buf.toString('utf8');
    // Google's own sign-in page means the file is private to a school account: that's Drive's job.
    if (/accounts\.google\.com/.test(finalUrl)) return { error: 'That Google file is not public - it needs your Google account (connect Google Drive in Apps).' };
    return { kind: 'web page', title: title(html), text: htmlText(html), url: finalUrl, links: pageLinks(html, finalUrl).slice(0, 40) };
  }
  const name = decodeURIComponent(new URL(finalUrl).pathname.split('/').pop() || 'file');
  const r = await readBytes(buf, name, ct, opts);
  return 'error' in r ? r : { ...r, url: finalUrl, title: r.title ?? name };
}

/** A Drive file (or Google Doc/Slides/Sheet) by link, id or name. */
export async function readDrive(input: string, opts: ReadOptions = {}): Promise<ReadOutcome> {
  try {
    const f = await driveFetch(input);
    if (f.children) {
      return { kind: 'Drive folder', title: f.name, url: f.link, text: f.children.length ? f.children.map((c) => `- ${c.name} (${GOOGLE_EXPORT[c.mimeType]?.label ?? c.mimeType.split('/').pop()}) id ${c.id}`).join('\n') : '(empty folder)' };
    }
    if (f.text) return { kind: GOOGLE_EXPORT[f.mimeType]?.label ?? 'Drive file', title: f.name, url: f.link, text: f.text };
    const r = await readBytes(f.buf!, f.name, f.contentType ?? '', opts);
    return 'error' in r ? r : { ...r, kind: GOOGLE_EXPORT[f.mimeType] ? `${GOOGLE_EXPORT[f.mimeType].label} (${r.kind})` : r.kind, title: f.name, url: f.link };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    // No Drive connection, but the Google Slides or Docs app is connected: read the deck or doc through it.
    const g = /not connected/i.test(msg) ? /docs\.google\.com\/(presentation|document)\/d\/([\w-]{15,})/.exec(input) : null;
    if (g) {
      const { readViaApp } = await import('./googleApps');
      const r = await readViaApp(g[1] === 'presentation' ? 'slides' : 'docs', g[2]).catch((e2: unknown) => ({ error: e2 instanceof Error ? e2.message : String(e2) }));
      if (r) return 'error' in r ? r : { ...r, url: input.trim() };
    }
    return { error: msg };
  }
}

/** A D2L page or file over his D2L sign-in (read-only), with the page's links. */
export async function readD2L(input: string, opts: ReadOptions = {}): Promise<ReadOutcome> {
  const d2l = await import('./d2l');
  try {
    const page = await d2l.fetchPage(input);
    if (page.offsite) return readLink(page.url, opts); // a D2L link that leads off D2L (a Google Doc, a website)
    if (page.html !== undefined) {
      const text = htmlText(page.html);
      return {
        kind: 'D2L page', title: title(page.html), url: page.url, links: pageLinks(page.html, page.url, d2l.baseUrl()),
        text: text.length > 80 ? text : `${text}\n\n(This D2L screen draws itself with scripts, so there is little text in it. Follow its links, or use d2l_content / d2l_api for this part of D2L.)`,
      };
    }
    const r = await readBytes(page.buf!, page.name ?? 'file', page.contentType ?? '', opts);
    return 'error' in r ? r : { ...r, url: page.url, title: r.title ?? page.name };
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

/** Anything at a link: Drive/Docs, YouTube, D2L, or the open web. */
export async function readLink(url: string, opts: ReadOptions = {}): Promise<ReadOutcome> {
  const u = url.trim();
  if (!/^https?:\/\//i.test(u) && !u.startsWith('/d2l/')) return { error: 'That is not a web address (it should start with http).' };
  try {
    const d2l = await import('./d2l');
    if (u.startsWith('/d2l/') || u.startsWith(d2l.baseUrl())) return readD2L(u, opts);
    // Published to the web (/d/e/2PACX-...): read straight from Google's viewer, no account needed.
    const published = /docs\.google\.com\/(presentation|document|spreadsheets)\/d\/e\/([\w-]+)/.exec(u);
    if (published) {
      const { readPublished } = await import('./googleApps');
      const r = await readPublished(published[1] as 'presentation' | 'document' | 'spreadsheets', published[2], opts.signal);
      return 'error' in r ? r : { ...r, url: u };
    }
    if (isDriveLink(u)) {
      const viaDrive = await readDrive(u, opts);
      if (!('error' in viaDrive) || !/not connected/i.test(viaDrive.error)) return viaDrive;
      // No Google connection: a Doc shared publicly can still be exported as a file.
      const pub = /docs\.google\.com\/(document|presentation|spreadsheets)\/d\/([\w-]+)/.exec(u);
      if (!pub) return viaDrive;
      const fmt = pub[1] === 'document' ? 'docx' : pub[1] === 'presentation' ? 'pptx' : 'xlsx';
      const r = await readWeb(`https://docs.google.com/${pub[1]}/d/${pub[2]}/export?format=${fmt}`, opts);
      // A web page back instead of a document is Google's sign-in: the file isn't public.
      if (!('error' in r) && r.kind !== 'web page') return { ...r, url: u };
      const app = pub[1] === 'presentation' ? '"Google Slides"' : pub[1] === 'document' ? '"Google Docs"' : '"Google Sheets"';
      return { error: `That file isn't public, and no Google app that can open it is connected. In Apps, connect "Google Drive", ${app} or "Google - all apps" - you sign in with Google yourself.` };
    }
    if (linkWhere(u) === 'youtube') {
      const { youtube } = await import('./addons');
      const v = await youtube(u, opts.signal);
      if ('ok' in v) return { error: v.error };
      return { kind: 'YouTube video (transcript)', title: v.title, url: v.url, text: `${v.channel ? `${v.channel} - ` : ''}${v.duration ?? ''}\n\n${v.transcript || '(this video has no English captions)'}` };
    }
    return await readWeb(u, opts);
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}
