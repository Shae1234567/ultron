import { connectedApps, findActions, runAction } from './composio';
import { findArray } from './dashboard';

/*
 * Google Drive, read-only (12 Oct 2026): find files and fetch what's in them - his own files and
 * anything shared with him (teachers' Docs and Slides included). Through the Google connection he
 * made in Apps (Composio), so Ultron never holds a Google password or token itself.
 *
 * Google's own formats are exported as Office files - a Doc as Word, Slides as PowerPoint (speaker
 * notes included), a Sheet as Excel (every tab) - so the document reader keeps tables and notes.
 * reader.ts turns the bytes into text; this file only finds and fetches. Nothing is ever changed.
 */

export interface DriveFile { id: string; name: string; mimeType: string; modified?: string; link?: string; size?: number; owner?: string }
export interface DriveFetched { id: string; name: string; mimeType: string; link?: string; buf?: Buffer; contentType?: string; text?: string; children?: DriveFile[] }

const FOLDER = 'application/vnd.google-apps.folder';
const MAX_BYTES = 25 * 1024 * 1024;

/** Google's own formats, and the Office format each is exported as. */
export const GOOGLE_EXPORT: Record<string, { mime: string; ext: string; label: string }> = {
  'application/vnd.google-apps.document': { mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', ext: 'docx', label: 'Google Doc' },
  'application/vnd.google-apps.presentation': { mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', ext: 'pptx', label: 'Google Slides' },
  'application/vnd.google-apps.spreadsheet': { mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', ext: 'xlsx', label: 'Google Sheet' },
  'application/vnd.google-apps.drawing': { mime: 'application/pdf', ext: 'pdf', label: 'Google Drawing' },
};

/** A Drive file id from a link (docs.google.com/.../d/ID/..., drive.google.com/file/d/ID, ?id=ID) or a bare id. Pure, for tests. */
export function driveIdFrom(input: string): string | null {
  const s = input.trim();
  const m = /\/(?:d|folders)\/([\w-]{15,})/.exec(s) ?? /[?&]id=([\w-]{15,})/.exec(s);
  if (m) return m[1];
  return /^[\w-]{20,}$/.test(s) ? s : null;
}

/** What a docs.google.com link points at, so it can be exported without asking Drive first. Pure, for tests. */
export function mimeFromUrl(url: string): string | null {
  const m = /docs\.google\.com\/(document|presentation|spreadsheets|drawings)\//.exec(url);
  if (!m) return /drive\.google\.com\/drive\/(?:u\/\d+\/)?folders\//.test(url) ? FOLDER : null;
  return { document: 'application/vnd.google-apps.document', presentation: 'application/vnd.google-apps.presentation', spreadsheets: 'application/vnd.google-apps.spreadsheet', drawings: 'application/vnd.google-apps.drawing' }[m[1]] ?? null;
}

export function isDriveLink(url: string): boolean {
  return /^https?:\/\/(docs|drive)\.google\.com\//i.test(url.trim());
}

/** Drive's search language needs quotes and backslashes escaped. Pure, for tests. */
export function searchQuery(text: string): string {
  const t = text.trim().replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  return t ? `trashed = false and (name contains '${t}' or fullText contains '${t}')` : 'trashed = false';
}

const rec = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {});
const s = (v: unknown): string => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '');

export function toFile(v: unknown): DriveFile {
  const f = rec(v);
  const owner = Array.isArray(f.owners) ? rec(f.owners[0]) : {};
  return { id: s(f.id), name: s(f.name), mimeType: s(f.mimeType ?? f.mime_type), modified: s(f.modifiedTime) || undefined, link: s(f.webViewLink) || undefined, size: Number(f.size) || undefined, owner: s(owner.displayName) || undefined };
}

/**
 * Where an action's result put the file: Composio hands files over as { s3url, mimetype, name }
 * (sometimes nested, sometimes inside a JSON string). Pure, for tests.
 */
export function findFileRef(data: unknown, depth = 0): { url: string; mimeType?: string; name?: string } | null {
  if (depth > 6 || data == null) return null;
  if (typeof data === 'string') {
    const t = data.trim();
    if (!t.startsWith('{') && !t.startsWith('[')) return null;
    try { return findFileRef(JSON.parse(t), depth + 1); } catch { return null; }
  }
  if (Array.isArray(data)) {
    for (const v of data) { const r = findFileRef(v, depth + 1); if (r) return r; }
    return null;
  }
  const o = rec(data);
  const url = s(o.s3url ?? o.s3_url ?? o.downloadUrl ?? o.download_url);
  if (/^https?:\/\//.test(url)) return { url, mimeType: s(o.mimetype ?? o.mimeType ?? o.mime_type) || undefined, name: s(o.name ?? o.file_name ?? o.filename) || undefined };
  for (const v of Object.values(o)) { const r = findFileRef(v, depth + 1); if (r) return r; }
  return null;
}

/** Text an action returned directly (some exports come back as plain text, not a file). Pure, for tests. */
export function findText(data: unknown, depth = 0): string | null {
  if (depth > 6 || data == null) return null;
  if (typeof data === 'string') {
    const t = data.trim();
    if (t.startsWith('{') || t.startsWith('[')) { try { return findText(JSON.parse(t), depth + 1); } catch { return null; } }
    return null;
  }
  if (Array.isArray(data)) { for (const v of data) { const r = findText(v, depth + 1); if (r) return r; } return null; }
  const o = rec(data);
  for (const k of ['content', 'text', 'body', 'file_content']) if (typeof o[k] === 'string' && (o[k] as string).trim()) return o[k] as string;
  for (const v of Object.values(o)) { const r = findText(v, depth + 1); if (r) return r; }
  return null;
}

/* ── which Composio actions to use ─────────────────────────────────────── */

interface Act { slug: string; idKey: string; mimeKey?: string }
interface DriveActions { app: string; find: string; download: Act; meta?: Act }
let actionsCache: DriveActions | null = null;

async function driveApp(): Promise<string> {
  const apps = (await connectedApps()).map((a) => a.slug);
  const app = apps.includes('googledrive') ? 'googledrive' : apps.includes('googlesuper') ? 'googlesuper' : null;
  if (!app) throw new Error('Google Drive is not connected. In Apps, connect "Google Drive" (or "Google - all apps") - you sign in with Google yourself.');
  return app;
}

/** The actions' real names and parameter names, looked up once from Composio (they differ between Google connections). */
async function actions(): Promise<DriveActions> {
  if (actionsCache) return actionsCache;
  const app = await driveApp();
  const prefix = app.toUpperCase();
  const pick = (found: { slug: string; params: Record<string, string> }[], re: RegExp, fallback: string): Act => {
    const a = found.find((x) => re.test(x.slug));
    const keys = Object.keys(a?.params ?? {});
    return {
      slug: a?.slug ?? fallback,
      idKey: keys.find((k) => /^file_?id$/i.test(k)) ?? keys.find((k) => /id$/i.test(k)) ?? 'file_id',
      mimeKey: keys.find((k) => /mime/i.test(k)) ?? (a ? undefined : 'mime_type'),
    };
  };
  let dl: { slug: string; params: Record<string, string> }[] = [];
  let meta: { slug: string; params: Record<string, string> }[] = [];
  try {
    dl = (await findActions('download or export a file from Google Drive', app, 8)).actions;
    meta = (await findActions('get a Google Drive file\'s metadata', app, 8)).actions;
  } catch { /* fall back to the usual names */ }
  actionsCache = {
    app,
    find: `${prefix}_FIND_FILE`,
    download: pick(dl, /DOWNLOAD_FILE$|DOWNLOAD/, `${prefix}_DOWNLOAD_FILE`),
    meta: pick(meta, /GET_FILE_METADATA$|FILE_METADATA/, `${prefix}_GET_FILE_METADATA`),
  };
  return actionsCache;
}

export function resetDriveActions(): void { actionsCache = null; }

/* ── search and fetch ─────────────────────────────────────────────────── */

const FIELDS = 'files(id,name,mimeType,modifiedTime,webViewLink,size,owners(displayName))';

/** Files whose name or text matches (newest first), or his most recent files when the query is empty. */
export async function driveSearch(query: string, max = 12, inFolder?: string): Promise<DriveFile[]> {
  const a = await actions();
  const q = inFolder ? `'${inFolder.replace(/'/g, "\\'")}' in parents and trashed = false` : searchQuery(query);
  const r = await runAction(a.find, { q, orderBy: query.trim() && !inFolder ? undefined : 'modifiedTime desc', pageSize: Math.min(50, max), fields: FIELDS, corpora: 'user' });
  if (!r.ok) throw new Error(r.error ?? 'Drive search failed.');
  return findArray(r.data, 'files').map(toFile).filter((f) => f.id && f.name).slice(0, max);
}

async function fetchRef(ref: { url: string; mimeType?: string }): Promise<{ buf: Buffer; contentType: string }> {
  const res = await fetch(ref.url);
  if (!res.ok) throw new Error(`Drive file download failed (${res.status})`);
  const len = Number(res.headers.get('content-length') ?? 0);
  if (len > MAX_BYTES) throw new Error(`that file is ${Math.round(len / 1048576)} MB - too big to read here (25 MB limit)`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > MAX_BYTES) throw new Error('that file is over 25 MB - too big to read here');
  return { buf, contentType: ref.mimeType ?? res.headers.get('content-type') ?? '' };
}

/** A file by link, id or name: its bytes (or text), ready for the reader. A folder gives its files instead. */
export async function driveFetch(input: string): Promise<DriveFetched> {
  const a = await actions();
  let id = driveIdFrom(input);
  let file: DriveFile | null = null;
  if (!id) {
    const hits = await driveSearch(input, 5);
    file = hits.find((h) => h.name.toLowerCase() === input.trim().toLowerCase()) ?? hits[0] ?? null;
    if (!file) throw new Error(`Nothing in Drive called or containing "${input.trim()}".`);
    id = file.id;
  }
  // What it is: from the link, else from Drive.
  let mimeType = file?.mimeType || mimeFromUrl(input) || '';
  if ((!mimeType || !file) && a.meta) {
    const m = await runAction(a.meta.slug, { [a.meta.idKey]: id, fields: 'id,name,mimeType,modifiedTime,webViewLink,size' }).catch(() => ({ ok: false as const }));
    if (m.ok) {
      const f = toFile(findArray(m.data, 'files')[0] ?? (rec(rec(m.data).data).id ? rec(m.data).data : m.data));
      if (f.mimeType) { file = { ...f, id }; mimeType = f.mimeType; }
    }
  }
  const name = file?.name || input.trim();
  const link = file?.link ?? (isDriveLink(input) ? input.trim() : undefined);
  if (mimeType === FOLDER) return { id, name, mimeType, link, children: await driveSearch('', 50, id) };

  const exp = GOOGLE_EXPORT[mimeType];
  const tryDownload = async (mime?: string) => runAction(a.download.slug, { [a.download.idKey]: id, ...(mime && a.download.mimeKey ? { [a.download.mimeKey]: mime } : {}) });
  let r = await tryDownload(exp?.mime);
  // A Google file whose type we didn't know: Drive says it must be exported - try as a Doc, then Slides, then a Sheet.
  if (!r.ok && !exp && /export|binary content|google docs editors|fileNotDownloadable/i.test(r.error ?? '')) {
    for (const g of Object.values(GOOGLE_EXPORT).slice(0, 3)) {
      r = await tryDownload(g.mime);
      if (r.ok) { mimeType = Object.keys(GOOGLE_EXPORT).find((k) => GOOGLE_EXPORT[k] === g) ?? mimeType; break; }
    }
  }
  if (!r.ok) {
    if (/not found|404|insufficient|permission|403/i.test(r.error ?? '')) throw new Error(`Drive won't open that file for your account (${(r.error ?? '').slice(0, 160)}). It may not be shared with you.`);
    throw new Error(r.error ?? 'Drive download failed.');
  }
  const ref = findFileRef(r.data);
  const fileName = (ref?.name || name).replace(/\.[a-z0-9]{1,5}$/i, '') + (GOOGLE_EXPORT[mimeType] ? `.${GOOGLE_EXPORT[mimeType].ext}` : /\.[a-z0-9]{1,5}$/i.exec(ref?.name || name)?.[0] ?? '');
  if (ref) {
    const got = await fetchRef(ref);
    return { id, name: fileName, mimeType, link, buf: got.buf, contentType: GOOGLE_EXPORT[mimeType]?.mime ?? got.contentType };
  }
  const text = findText(r.data);
  if (text) return { id, name: fileName, mimeType, link, text };
  throw new Error('Drive answered, but without the file - try opening it in Drive.');
}
