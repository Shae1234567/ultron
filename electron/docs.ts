import { inflateRawSync } from 'node:zlib';

/*
 * Turns the files teachers post (PDF, Word, PowerPoint, Excel, web pages, text) into plain text,
 * so School's agents can explain and quiz from the real course material.
 * 12 Oct 2026: and almost anything else - OpenDocument (.odt/.odp/.ods), e-books (.epub), the old
 * .doc/.ppt/.xls formats (rough text), subtitles, code and any file that is really text. Pictures
 * and scanned PDFs are flagged here and read by eye in reader.ts. Read-only and local:
 * nothing is uploaded anywhere. Word/PowerPoint/Excel are zip files of XML, read here directly;
 * PDFs go through Mozilla's pdf.js (the same engine Firefox uses), with scripting off.
 *
 * Limits keep a huge or hostile file from hurting Ultron: 25 MB in, 50 MB unpacked per part,
 * 120 PDF pages, and 150,000 characters out (marked as cut short when it is).
 */

export interface DocText { text: string; kind: string; pages?: number; truncated?: boolean; /** A PDF of page pictures, with no text layer. */ scanned?: boolean }
export type DocResult = DocText | { error: string };

export const MAX_IN = 25 * 1024 * 1024;
const MAX_PART = 50 * 1024 * 1024;
const MAX_OUT = 150_000;
const MAX_PDF_PAGES = 120;

/* ── zip (Office files are zips) ─────────────────────────────────────── */

interface ZipEntry { name: string; method: number; compSize: number; size: number; offset: number }

/** The entries of a zip, from its central directory. Throws on anything that isn't a plain zip. */
export function zipEntries(buf: Buffer): Map<string, ZipEntry> {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65_557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('not a zip file');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const out = new Map<string, ZipEntry>();
  for (let n = 0; n < count && p + 46 <= buf.length; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('damaged zip directory');
    const nameLen = buf.readUInt16LE(p + 28);
    const entry: ZipEntry = {
      method: buf.readUInt16LE(p + 10),
      compSize: buf.readUInt32LE(p + 20),
      size: buf.readUInt32LE(p + 24),
      offset: buf.readUInt32LE(p + 42),
      name: buf.toString('utf8', p + 46, p + 46 + nameLen),
    };
    out.set(entry.name, entry);
    p += 46 + nameLen + buf.readUInt16LE(p + 30) + buf.readUInt16LE(p + 32);
  }
  return out;
}

export function zipRead(buf: Buffer, e: ZipEntry): Buffer {
  if (buf.readUInt32LE(e.offset) !== 0x04034b50) throw new Error('damaged zip entry');
  const start = e.offset + 30 + buf.readUInt16LE(e.offset + 26) + buf.readUInt16LE(e.offset + 28);
  const raw = buf.subarray(start, start + e.compSize);
  if (e.method === 0) return raw;
  if (e.method === 8) return inflateRawSync(raw, { maxOutputLength: MAX_PART });
  throw new Error(`unsupported zip compression (${e.method})`);
}

const part = (buf: Buffer, entries: Map<string, ZipEntry>, name: string): string | null => {
  const e = entries.get(name);
  return e ? zipRead(buf, e).toString('utf8') : null;
};

/* ── XML and HTML to text ────────────────────────────────────────────── */

export function decodeEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => safeChar(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => safeChar(Number(d)))
    .replace(/&nbsp;/g, ' ')
    .replace(/&quot;|&ldquo;|&rdquo;/g, '"')
    .replace(/&apos;|&#39;|&rsquo;|&lsquo;/g, "'")
    .replace(/&ndash;/g, '-').replace(/&mdash;/g, ' - ').replace(/&hellip;/g, '...')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}
function safeChar(n: number): string {
  try { return n > 0 && n < 0x110000 ? String.fromCodePoint(n) : ''; } catch { return ''; }
}

const tidy = (s: string) => s.replace(/[ \t ]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').replace(/[  ]{2,}/g, ' ').trim();

/** Word: paragraphs, tabs, line breaks and table cells, in order. */
export function docxText(xml: string): string {
  let out = '';
  const re = /<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>|<w:tab\/>|<w:br[^>]*\/>|<\/w:p>|<\/w:tc>|<\/w:tr>/g;
  for (let m = re.exec(xml); m; m = re.exec(xml)) {
    const tag = m[0];
    if (m[1] !== undefined) out += decodeEntities(m[1]);
    else if (tag.startsWith('<w:tab')) out += '\t';
    else if (tag.startsWith('<w:br') || tag === '</w:p>' || tag === '</w:tr>') out += '\n';
    else if (tag === '</w:tc>') out += '\t';
  }
  return tidy(out);
}

/** DrawingML (slides, notes): text runs, one line per paragraph. */
export function drawingText(xml: string): string {
  let out = '';
  const re = /<a:t>([^<]*)<\/a:t>|<a:br\/>|<\/a:p>/g;
  for (let m = re.exec(xml); m; m = re.exec(xml)) {
    if (m[1] !== undefined) out += decodeEntities(m[1]);
    else out += '\n';
  }
  return tidy(out);
}

export function htmlText(html: string): string {
  const body = /<body[^>]*>([\s\S]*)<\/body>/i.exec(html)?.[1] ?? html;
  const t = body
    .replace(/<(script|style|noscript|template|svg|head)[\s\S]*?<\/\1>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<li[^>]*>/gi, '\n- ')
    .replace(/<h([1-6])[^>]*>/gi, (_, n) => `\n\n${'#'.repeat(Number(n))} `)
    .replace(/<(br|\/p|\/div|\/h\d|\/tr|\/table|\/section|\/article|\/blockquote)\s*\/?>/gi, '\n')
    .replace(/<\/t[dh]>/gi, '\t')
    .replace(/<[^>]+>/g, '');
  return tidy(decodeEntities(t));
}

/* ── each format ─────────────────────────────────────────────────────── */

const num = (name: string) => Number(/(\d+)\.xml$/.exec(name)?.[1] ?? 0);

function docx(buf: Buffer): DocText {
  const entries = zipEntries(buf);
  const body = part(buf, entries, 'word/document.xml');
  if (body === null) throw new Error('no document inside - is it really a Word file?');
  const extra = [...entries.keys()].filter((n) => /^word\/(footnotes|endnotes)\.xml$/.test(n)).map((n) => docxText(part(buf, entries, n) ?? '')).filter(Boolean);
  return { kind: 'word', text: [docxText(body), ...extra.map((x) => `Notes:\n${x}`)].join('\n\n') };
}

function pptx(buf: Buffer): DocText {
  const entries = zipEntries(buf);
  const slides = [...entries.keys()].filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n)).sort((a, b) => num(a) - num(b));
  if (!slides.length) throw new Error('no slides inside - is it really a PowerPoint file?');
  const blocks = slides.map((s, i) => {
    const text = drawingText(part(buf, entries, s) ?? '');
    // Speaker notes, through the slide's relationships - teachers often put the real explanation there.
    const rels = part(buf, entries, s.replace('slides/', 'slides/_rels/').replace(/\.xml$/, '.xml.rels')) ?? '';
    const target = /Target="\.\.\/notesSlides\/(notesSlide\d+\.xml)"/.exec(rels)?.[1];
    const notes = target ? drawingText(part(buf, entries, `ppt/notesSlides/${target}`) ?? '').replace(/^\d+$/m, '').trim() : '';
    return `## Slide ${i + 1}\n${text || '(no text)'}${notes ? `\nSpeaker notes: ${notes}` : ''}`;
  });
  return { kind: 'powerpoint', text: blocks.join('\n\n'), pages: slides.length };
}

function xlsx(buf: Buffer): DocText {
  const entries = zipEntries(buf);
  const shared: string[] = [];
  const ss = part(buf, entries, 'xl/sharedStrings.xml') ?? '';
  for (const si of ss.match(/<si>[\s\S]*?<\/si>/g) ?? []) {
    shared.push(decodeEntities((si.match(/<t(?:\s[^>]*)?>([^<]*)<\/t>/g) ?? []).map((t) => t.replace(/<[^>]+>/g, '')).join('')));
  }
  const names = [...(part(buf, entries, 'xl/workbook.xml') ?? '').matchAll(/<sheet\b[^>]*\bname="([^"]*)"/g)].map((m) => decodeEntities(m[1]));
  const sheets = [...entries.keys()].filter((n) => /^xl\/worksheets\/sheet\d+\.xml$/.test(n)).sort((a, b) => num(a) - num(b));
  if (!sheets.length) throw new Error('no sheets inside - is it really an Excel file?');
  const blocks = sheets.map((s, i) => {
    const xml = part(buf, entries, s) ?? '';
    const rows: string[] = [];
    for (const row of (xml.match(/<row\b[\s\S]*?<\/row>/g) ?? []).slice(0, 400)) {
      const cells: string[] = [];
      for (const c of row.match(/<c\b[^>]*?(?:\/>|>[\s\S]*?<\/c>)/g) ?? []) {
        const type = /\bt="([^"]+)"/.exec(c)?.[1];
        const v = /<v>([^<]*)<\/v>/.exec(c)?.[1];
        if (type === 's' && v !== undefined) cells.push(shared[Number(v)] ?? '');
        else if (type === 'inlineStr') cells.push(decodeEntities((c.match(/<t(?:\s[^>]*)?>([^<]*)<\/t>/g) ?? []).map((t) => t.replace(/<[^>]+>/g, '')).join('')));
        else cells.push(v !== undefined ? decodeEntities(v) : '');
      }
      if (cells.some((x) => x.trim())) rows.push(cells.join('\t').replace(/\t+$/, ''));
    }
    return `## Sheet: ${names[i] ?? `Sheet ${i + 1}`}\n${rows.join('\n') || '(empty)'}`;
  });
  return { kind: 'excel', text: blocks.join('\n\n'), pages: sheets.length };
}

async function pdf(buf: Buffer): Promise<DocText> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await pdfjs.getDocument({
    data: new Uint8Array(buf), isEvalSupported: false, disableFontFace: true, useSystemFonts: false,
    stopAtErrors: false, verbosity: 0,
  }).promise;
  try {
    const pages: string[] = [];
    const n = Math.min(doc.numPages, MAX_PDF_PAGES);
    for (let i = 1; i <= n; i++) {
      const page = await doc.getPage(i);
      const tc = await page.getTextContent();
      let line = '';
      for (const it of tc.items as { str?: string; hasEOL?: boolean }[]) {
        if (typeof it.str !== 'string') continue;
        line += it.str + (it.hasEOL ? '\n' : it.str.endsWith(' ') ? '' : ' ');
      }
      pages.push(`## Page ${i}\n${tidy(line)}`);
      page.cleanup();
    }
    const text = pages.join('\n\n');
    // A scanned worksheet has pictures of words, not words.
    if (!text.replace(/## Page \d+/g, '').trim()) {
      return { kind: 'pdf', pages: doc.numPages, scanned: true, text: '(This PDF has no text in it - it is a scan or photos of pages.)' };
    }
    return { kind: 'pdf', text, pages: doc.numPages, truncated: doc.numPages > MAX_PDF_PAGES || undefined };
  } finally {
    await doc.destroy();
  }
}

/** OpenDocument (LibreOffice, Google Docs downloads): text, presentation or spreadsheet. Pure, for tests. */
export function odfText(xml: string, kind: 'odt' | 'odp' | 'ods'): string {
  const inline = (x: string) => decodeEntities(x
    .replace(/<text:tab\s*\/>/g, '\t').replace(/<text:line-break\s*\/>/g, '\n')
    .replace(/<text:s(?:\s+text:c="(\d+)")?\s*\/>/g, (_m, n) => ' '.repeat(Number(n ?? 1)))
    .replace(/<[^>]+>/g, ''));
  const paras = (x: string) => (x.match(/<text:(?:p|h)\b[^>]*?(?:\/>|>[\s\S]*?<\/text:(?:p|h)>)/g) ?? []).map(inline).map((t) => t.trim()).filter(Boolean);
  if (kind === 'odp') {
    return (xml.match(/<draw:page\b[\s\S]*?<\/draw:page>/g) ?? []).map((pg, i) => {
      const notes = /<presentation:notes\b[\s\S]*?<\/presentation:notes>/.exec(pg)?.[0] ?? '';
      const body = paras(pg.replace(notes, '')).join('\n');
      const said = paras(notes).join(' ');
      return `## Slide ${i + 1}\n${body || '(no text)'}${said ? `\nSpeaker notes: ${said}` : ''}`;
    }).join('\n\n');
  }
  if (kind === 'ods') {
    return (xml.match(/<table:table\b[\s\S]*?<\/table:table>/g) ?? []).map((t, i) => {
      const name = decodeEntities(/table:name="([^"]*)"/.exec(t)?.[1] ?? `Sheet ${i + 1}`);
      const rows = (t.match(/<table:table-row\b[\s\S]*?<\/table:table-row>/g) ?? []).slice(0, 400).map((r) =>
        (r.match(/<table:table-cell\b[^>]*?(?:\/>|>[\s\S]*?<\/table:table-cell>)/g) ?? []).map((c) => paras(c).join(' ')).join('\t').replace(/\t+$/, ''),
      ).filter((r) => r.trim());
      return `## Sheet: ${name}\n${rows.join('\n') || '(empty)'}`;
    }).join('\n\n');
  }
  const body = /<office:body>([\s\S]*)<\/office:body>/.exec(xml)?.[1] ?? xml;
  return body.match(/<text:(?:p|h)\b[^>]*?(?:\/>|>[\s\S]*?<\/text:(?:p|h)>)|<table:table-row\b[\s\S]*?<\/table:table-row>/g)?.map((b) => (
    b.startsWith('<table:table-row') ? (b.match(/<table:table-cell\b[\s\S]*?<\/table:table-cell>/g) ?? []).map((c) => paras(c).join(' ')).join('\t') : inline(b).trim()
  )).filter(Boolean).join('\n') ?? '';
}

function odf(buf: Buffer, kind: 'odt' | 'odp' | 'ods'): DocText {
  const xml = part(buf, zipEntries(buf), 'content.xml');
  if (xml === null) throw new Error('no content inside - is it really an OpenDocument file?');
  const text = odfText(xml, kind);
  return { kind: kind === 'odp' ? 'presentation' : kind === 'ods' ? 'spreadsheet' : 'document', text, pages: kind === 'odp' ? (text.match(/^## Slide /gm) ?? []).length : undefined };
}

/** An e-book: its chapters in reading order (the spine), each as text. */
function epub(buf: Buffer): DocText {
  const entries = zipEntries(buf);
  const container = part(buf, entries, 'META-INF/container.xml') ?? '';
  const opfPath = /full-path="([^"]+)"/.exec(container)?.[1] ?? [...entries.keys()].find((n) => n.endsWith('.opf'));
  const opf = opfPath ? part(buf, entries, opfPath) ?? '' : '';
  const dir = opfPath?.includes('/') ? opfPath.slice(0, opfPath.lastIndexOf('/') + 1) : '';
  const manifest = new Map([...opf.matchAll(/<item\b[^>]*\bid="([^"]+)"[^>]*\bhref="([^"]+)"/g)].map((m) => [m[1], m[2]]));
  for (const m of opf.matchAll(/<item\b[^>]*\bhref="([^"]+)"[^>]*\bid="([^"]+)"/g)) if (!manifest.has(m[2])) manifest.set(m[2], m[1]);
  let order = [...opf.matchAll(/<itemref\b[^>]*\bidref="([^"]+)"/g)].map((m) => manifest.get(m[1])).filter((h): h is string => Boolean(h)).map((h) => dir + decodeURIComponent(h));
  if (!order.length) order = [...entries.keys()].filter((n) => /\.x?html?$/i.test(n)).sort();
  const title = decodeEntities(/<dc:title[^>]*>([^<]*)</.exec(opf)?.[1] ?? '');
  const chapters = order.map((n) => part(buf, entries, n)).filter((x): x is string => Boolean(x)).map((h) => htmlText(h)).filter(Boolean);
  if (!chapters.length) throw new Error('no chapters inside - is it really an e-book?');
  return { kind: 'e-book', text: `${title ? `# ${title}\n\n` : ''}${chapters.join('\n\n')}`, pages: chapters.length };
}

/**
 * The old binary Office formats (.doc/.ppt/.xls from before 2007) have no documented-for-free text
 * layer here, so this pulls the readable runs of text out of the file - both the 16-bit and the
 * 8-bit kind - and drops the fonts, styles and other machinery. Rough, but the words are there.
 * Pure, for tests.
 */
export function roughOfficeText(buf: Buffer): string {
  const runs: { at: number; text: string }[] = [];
  // Ordinary text: ASCII, accented letters, and the curly quotes, dashes and ellipsis Word puts in.
  const ok = (c: number) => (c >= 32 && c < 127) || (c >= 0xc0 && c <= 0xff && c !== 0xd7 && c !== 0xf7) || (c >= 0x2013 && c <= 0x2014) || (c >= 0x2018 && c <= 0x201d) || c === 0x2026 || c === 0xa0 || c === 9 || c === 10 || c === 13;
  // 16-bit (UTF-16LE) runs: Word's main text and most PowerPoint text.
  for (let start = 0; start < 2; start++) {
    let cur = '';
    let at = 0;
    for (let i = start; i + 1 < buf.length; i += 2) {
      const c = buf.readUInt16LE(i);
      if (ok(c)) { if (!cur) at = i; cur += c === 13 ? '\n' : String.fromCharCode(c); }
      else { if (cur.replace(/\s/g, '').length >= 5) runs.push({ at, text: cur }); cur = ''; }
    }
    if (cur.replace(/\s/g, '').length >= 5) runs.push({ at, text: cur });
  }
  // 8-bit runs: older files, Excel's shared strings, PowerPoint's plain text atoms.
  let cur = '';
  let at = 0;
  for (let i = 0; i < buf.length; i++) {
    const c = buf[i];
    if ((c >= 32 && c < 127) || c === 9 || c === 10 || c === 13) { if (!cur) at = i; cur += c === 13 ? '\n' : String.fromCharCode(c); }
    else { if (cur.replace(/\s/g, '').length >= 8 && /[a-z]{3}/i.test(cur)) runs.push({ at, text: cur }); cur = ''; }
  }
  const machinery = /^(Times New Roman|Arial|Calibri|Cambria|Symbol|Wingdings|Courier New|Normal|Default Paragraph Font|Table Normal|No List|heading \d|Title|Subtitle|Microsoft (Office )?(Word|PowerPoint|Excel)[\w .-]*|Word\.Document[\w.]*|Root Entry|SummaryInformation|DocumentSummaryInformation|WordDocument|PowerPoint Document|Current User|Workbook|CompObj|Office Theme|Click to edit[\w ]*|\[Content_Types\]\.xml|_rels\/[\w./]*|theme\/[\w./]*)$/i;
  const seen = new Set<string>();
  const out: string[] = [];
  for (const r of runs.sort((a, b) => a.at - b.at)) {
    const t = r.text.replace(/[ \t]+/g, ' ').trim();
    if (!t || machinery.test(t) || /^[\W\d_]+$/.test(t) || /^[A-Z0-9_]{6,}$/.test(t) || seen.has(t)) continue;
    // Text with almost no vowels is binary noise that happens to be printable.
    const letters = t.replace(/[^a-z]/gi, '');
    if (letters.length >= 6 && (letters.match(/[aeiou]/gi) ?? []).length / letters.length < 0.15) continue;
    seen.add(t);
    out.push(t);
  }
  return out.join('\n');
}

const TEXT_EXT = new Set(['txt', 'md', 'markdown', 'csv', 'tsv', 'json', 'log', 'xml', 'yaml', 'yml', 'ini', 'cfg', 'conf', 'toml', 'srt', 'vtt', 'ics',
  'tex', 'bib', 'py', 'js', 'ts', 'tsx', 'jsx', 'java', 'c', 'h', 'cpp', 'cs', 'go', 'rs', 'rb', 'php', 'sh', 'bat', 'ps1', 'sql', 'css', 'scss', 'lua', 'r', 'm', 'swift', 'kt']);

/** Whether bytes look like text (no NUL bytes, mostly printable) - for files with an unknown ending. */
export function looksLikeText(buf: Buffer): boolean {
  const head = buf.subarray(0, 4096);
  if (!head.length || head.includes(0)) return false;
  let bad = 0;
  for (const c of head) if (c < 9 || (c > 13 && c < 32)) bad++;
  return bad / head.length < 0.02;
}

/** Subtitles (.srt/.vtt) without the numbers and timestamps - just what is said. */
function subtitles(t: string): string {
  return t.replace(/^WEBVTT.*$/m, '').split(/\r?\n/).filter((l) => l.trim() && !/^\d+$/.test(l.trim()) && !/-->/.test(l)).join(' ').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
}

/* ── the one entry point ─────────────────────────────────────────────── */

function kindOf(name: string, contentType = '', buf?: Buffer): string {
  const ext = /\.([a-z0-9]{1,5})(?:$|\?)/i.exec(name)?.[1]?.toLowerCase() ?? '';
  const ct = contentType.toLowerCase();
  if (ext === 'pdf' || ct.includes('pdf') || buf?.subarray(0, 5).toString('latin1') === '%PDF-') return 'pdf';
  if (ext === 'docx' || ct.includes('wordprocessingml')) return 'docx';
  if (ext === 'pptx' || ct.includes('presentationml')) return 'pptx';
  if (ext === 'xlsx' || ct.includes('spreadsheetml')) return 'xlsx';
  if (['odt', 'ott'].includes(ext) || ct.includes('opendocument.text')) return 'odt';
  if (['odp', 'otp'].includes(ext) || ct.includes('opendocument.presentation')) return 'odp';
  if (['ods', 'ots'].includes(ext) || ct.includes('opendocument.spreadsheet')) return 'ods';
  if (ext === 'epub' || ct.includes('epub')) return 'epub';
  if (['doc', 'ppt', 'xls', 'dot', 'pps', 'pot'].includes(ext) || ct.includes('msword') || ct.includes('ms-powerpoint') || ct.includes('ms-excel')) return 'old-office';
  if (['html', 'htm', 'xhtml'].includes(ext) || ct.includes('html')) return 'html';
  if (ext === 'rtf' || ct.includes('rtf')) return 'rtf';
  if (ext === 'srt' || ext === 'vtt' || ct.includes('vtt')) return 'subtitles';
  if (TEXT_EXT.has(ext) || ct.startsWith('text/') || ct.includes('json') || ct.includes('xml')) return 'text';
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'].includes(ext) || ct.startsWith('image/')) return 'image';
  if (['mp4', 'mov', 'mp3', 'm4a', 'wav', 'webm', 'ogg', 'avi', 'mkv', 'flac', 'aac'].includes(ext) || ct.startsWith('video/') || ct.startsWith('audio/')) return 'media';
  if (buf && looksLikeText(buf)) return 'text';
  return ext || 'unknown';
}

export async function extractText(buf: Buffer, name: string, contentType = ''): Promise<DocResult> {
  if (buf.length > MAX_IN) return { error: `${name} is ${Math.round(buf.length / 1048576)} MB - too big to read here (25 MB limit). Open it in D2L.` };
  const kind = kindOf(name, contentType, buf);
  try {
    let r: DocText;
    switch (kind) {
      case 'pdf': r = await pdf(buf); break;
      case 'docx': r = docx(buf); break;
      case 'pptx': r = pptx(buf); break;
      case 'xlsx': r = xlsx(buf); break;
      case 'html': r = { kind: 'web page', text: htmlText(buf.toString('utf8')) }; break;
      case 'text': r = { kind: 'text', text: tidy(buf.toString('utf8')) }; break;
      case 'rtf': r = { kind: 'text', text: tidy(buf.toString('latin1').replace(/\\par[d]?/g, '\n').replace(/\{\\[^{}]*\}|\\[a-z]+-?\d* ?|[{}]/gi, '')) }; break;
      case 'odt': case 'odp': case 'ods': r = odf(buf, kind); break;
      case 'epub': r = epub(buf); break;
      case 'subtitles': r = { kind: 'subtitles', text: subtitles(buf.toString('utf8')) }; break;
      case 'old-office': {
        const t = roughOfficeText(buf);
        if (t.replace(/\s/g, '').length < 20) return { error: `${name} is an older Office format (.doc/.ppt/.xls) with no text I could pull out. Open it, or ask for a PDF.` };
        r = { kind: 'older Office file (rough text - layout and some words may be missing)', text: t };
        break;
      }
      case 'image': return { error: `${name} is a picture - there is no text layer to read (reader.ts reads pictures by eye).` };
      case 'media': return { error: `${name} is audio or video - there is no text to read. For a YouTube video, use its link (its transcript can be read).` };
      default: return { error: `${name} is a .${kind} file, which can't be read as text here.` };
    }
    if (r.text.length > MAX_OUT) return { ...r, text: `${r.text.slice(0, MAX_OUT)}\n\n[... cut short - the file is longer than this]`, truncated: true };
    return r;
  } catch (e) {
    return { error: `Couldn't read ${name}: ${e instanceof Error ? e.message : String(e)}` };
  }
}
