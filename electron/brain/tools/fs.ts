import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { app, shell } from 'electron';
import { getSettings } from '../../store';
import { vaultRoot } from '../../memory/vault';
import { A, B, N, S, bool, clip, num, obj, str, type AgentTool } from './types';

/**
 * Hephaestus's hands on the operator's machine. Reach: the user folder, any
 * folder added in the Files tab, and the vault. Credential stores and app
 * data are off-limits even inside those, and Windows and Program Files are
 * never changed (a folder added in the Files tab could contain them).
 * Anything destructive (overwrite, move, rename, delete, run a command) waits
 * for an explicit approval; an overwritten file is first copied to "Ultron
 * Backups", and deletes go to the Recycle Bin, never straight to oblivion.
 */

const DENY_DIRS = new Set(['appdata', '.ssh', '.gnupg', '.aws', '.azure', '.kube', '.docker', '.config', '.vscode', '.npm', '.cache', 'node_modules', '$recycle.bin']);
const DENY_FILE = /(^\.env(\..*)?$|\.pem$|\.key$|\.pfx$|\.p12$|\.kdbx$|^id_(rsa|ed25519|ecdsa|dsa)(\.pub)?$|^\.git-credentials$|^ntuser\.|^secrets\.json$|^credentials(\.json)?$|^\.npmrc$|^\.netrc$)/i;
const EXEC_EXT = /\.(exe|bat|cmd|ps1|vbs|js|msi|scr|com|lnk|jar|reg|hta)$/i;
const SKIP_WALK = new Set(['node_modules', '.git', 'appdata', '$recycle.bin', '.cache', '.npm', 'venv', '.venv', '__pycache__', 'dist', 'build', 'release']);

function roots(): string[] {
  const list = [os.homedir(), vaultRoot(), ...getSettings().folders.map((f) => f.path)];
  return [...new Set(list.map((r) => path.resolve(r)))];
}

function within(child: string, parent: string): boolean {
  const c = child.toLowerCase();
  const p = parent.toLowerCase();
  return c === p || c.startsWith(p.endsWith(path.sep) ? p : p + path.sep);
}

const env = (name: string, fallback: string) => process.env[name] || fallback;

/** Windows and installed programs: never changed by Ultron. */
function systemPlaces(): string[] {
  return [env('SystemRoot', 'C:\\Windows'), env('ProgramFiles', 'C:\\Program Files'), env('ProgramFiles(x86)', 'C:\\Program Files (x86)'), env('ProgramData', 'C:\\ProgramData')]
    .map((p) => path.resolve(p));
}

/** Resolves a path Ultron is about to change: as resolveSafe, and never inside Windows or Program Files. */
export function resolveWritable(input: string): string {
  const full = resolveSafe(input);
  if (systemPlaces().some((r) => within(full, r))) throw new Error('Windows, Program Files and ProgramData are read-only for Ultron - changing them can break the PC.');
  if (/^[a-z]:\\?$/i.test(full)) throw new Error('Refusing to change a whole drive.');
  return full;
}

export function backupRoot(): string {
  return path.join(env('LOCALAPPDATA', path.join(os.homedir(), 'AppData', 'Local')), 'Ultron Backups');
}

/** Copies a file before Ultron overwrites or appends to it (kept 30 days). Undefined when the copy failed. */
function backupFile(file: string): string | undefined {
  try {
    const root = backupRoot();
    const now = new Date();
    const day = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    const dir = path.join(root, day);
    fs.mkdirSync(dir, { recursive: true });
    const dest = uniqueTarget(path.join(dir, `${now.toTimeString().slice(0, 8).replace(/:/g, '')} ${path.basename(file)}`));
    fs.copyFileSync(file, dest);
    for (const d of fs.readdirSync(root)) {
      if (/^\d{4}-\d{2}-\d{2}$/.test(d) && Date.now() - Date.parse(d) > 30 * 86_400_000) fs.rmSync(path.join(root, d), { recursive: true, force: true });
    }
    return dest;
  } catch {
    return undefined;
  }
}

/** Programs and scripts: opening one runs code, so it always asks first. */
export function isProgram(file: string): boolean {
  return EXEC_EXT.test(file);
}

const KNOWN_FOLDERS: Record<string, Parameters<typeof app.getPath>[0]> = {
  desktop: 'desktop', documents: 'documents', downloads: 'downloads', pictures: 'pictures', photos: 'pictures', music: 'music', videos: 'videos',
};

/** "my downloads", "the documents folder" -> that folder's real path (OneDrive-redirected ones included); null otherwise. */
export function knownFolder(query: string): string | null {
  const q = query.toLowerCase().trim().replace(/^(my|the)\s+/, '').replace(/\s+(folder|directory)$/, '').trim();
  const key = KNOWN_FOLDERS[q];
  return key ? app.getPath(key) : null;
}

const FILLER = new Set(['my', 'the', 'a', 'an', 'file', 'folder', 'called', 'named', 'please', 'open']);

/** The words of a name: "Volcano_Poster-final.pptx" -> volcano, poster, final. */
export function nameWords(s: string): string[] {
  return s.toLowerCase().replace(/\.[a-z0-9]{1,5}$/, '').split(/[^\p{L}\p{N}]+/u).filter(Boolean);
}

/**
 * How well a file name fits what the operator called it; 0 = not it. Every
 * word they said has to be in the name. Exact names, a matching extension and
 * recent files rank higher; names with many extra words rank lower.
 */
export function nameScore(query: string, fileName: string, modifiedMs: number, now = Date.now()): number {
  const want = nameWords(query).filter((w) => !FILLER.has(w));
  if (!want.length) return 0;
  const have = nameWords(fileName);
  if (!want.every((w) => have.some((h) => h.startsWith(w)))) return 0;
  let score = 10;
  if (have.join(' ') === want.join(' ')) score += 20;
  const ext = /\.([a-z0-9]{1,5})$/i.exec(query)?.[1]?.toLowerCase();
  if (ext && fileName.toLowerCase().endsWith(`.${ext}`)) score += 6;
  score -= Math.min(Math.max(have.length - want.length, 0), 6);
  const age = now - modifiedMs;
  if (age < 7 * 86_400_000) score += 4;
  else if (age < 60 * 86_400_000) score += 2;
  return score;
}

export interface NameHit { path: string; score: number; dir: boolean; modified: number }

/** Files and folders in Ultron's reach whose names match - the usual folders first, then everything else. */
export function findByName(query: string, max = 6, signal?: AbortSignal): NameHit[] {
  const known = (['desktop', 'documents', 'downloads', 'pictures', 'videos', 'music'] as const).map((k) => { try { return app.getPath(k); } catch { return ''; } }).filter(Boolean);
  const order = [...new Set([...known, ...roots()].map((r) => path.resolve(r)))];
  const seen = new Set<string>();
  const hits: NameHit[] = [];
  let visited = 0;
  const walk = (dir: string, depth: number) => {
    if (depth > 6 || visited > 40_000 || signal?.aborted) return;
    const key = dir.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    const subdirs: string[] = [];
    for (const e of entries) {
      visited++;
      const lower = e.name.toLowerCase();
      if (e.name.startsWith('.') || SKIP_WALK.has(lower) || DENY_DIRS.has(lower) || DENY_FILE.test(e.name) || /^desktop\.ini$/i.test(e.name)) continue;
      const full = path.join(dir, e.name);
      // The name decides first; only a match costs a stat (for its date).
      if (nameScore(query, e.name, 0) > 0) {
        let modified = 0;
        try { modified = fs.statSync(full).mtimeMs; } catch { /* vanished - still a match */ }
        hits.push({ path: full, score: nameScore(query, e.name, modified), dir: e.isDirectory(), modified });
      }
      if (e.isDirectory()) subdirs.push(full);
    }
    for (const d of subdirs) walk(d, depth + 1);
  };
  for (const r of order) walk(r, 0);
  return hits.sort((a, b) => b.score - a.score || b.modified - a.modified).slice(0, max);
}

/** Resolves a user-supplied path and refuses anything outside Ultron's reach. */
export function resolveSafe(input: string): string {
  let p = input.trim().replace(/^["']|["']$/g, '');
  if (!p) throw new Error('No path given.');
  if (p === '~' || p.startsWith('~/') || p.startsWith('~\\')) p = path.join(os.homedir(), p.slice(1));
  // Known folders resolve through Windows itself - Desktop and Documents are
  // redirected into OneDrive on this machine, so ~/Desktop would be wrong.
  const known: Record<string, Parameters<typeof app.getPath>[0]> = {
    desktop: 'desktop', documents: 'documents', downloads: 'downloads', pictures: 'pictures', music: 'music', videos: 'videos',
  };
  const [first, ...rest] = p.split(/[\\/]/);
  if (!path.isAbsolute(p) && known[first.toLowerCase()]) p = path.join(app.getPath(known[first.toLowerCase()]), ...rest);
  if (!path.isAbsolute(p)) p = path.join(os.homedir(), p);
  const full = path.resolve(p);
  if (!roots().some((r) => within(full, r))) {
    throw new Error(`"${full}" is outside the folders Ultron may touch (your user folder, the vault, and folders added in the Files tab).`);
  }
  const segments = full.split(path.sep).map((s) => s.toLowerCase());
  const vault = path.resolve(vaultRoot()).toLowerCase();
  if (segments.some((s) => DENY_DIRS.has(s)) && !full.toLowerCase().startsWith(vault)) {
    throw new Error('That location holds app data or credentials, which are off-limits.');
  }
  if (DENY_FILE.test(path.basename(full))) throw new Error('That file looks like a credential or secrets file - off-limits.');
  return full;
}

/** Ultron's own vault is its scratch space; everywhere else, anything that adds or changes files asks first. */
function insideVault(p: string): boolean {
  return within(p, path.resolve(vaultRoot()));
}

/** Files that are documents even when their bytes look like text (they need reading, not dumping). */
const DOCUMENT_EXT = /\.(pdf|docx?|pptx?|xlsx?|od[tps]|epub|rtf|png|jpe?g|gif|webp|bmp)$/i;
/** The last few documents read, so reading on through a long one doesn't parse it again. */
const readCache = new Map<string, import('../../reader').ReadResult>();

function isBinary(buf: Buffer): boolean {
  const n = Math.min(buf.length, 8000);
  for (let i = 0; i < n; i++) if (buf[i] === 0) return true;
  return false;
}

function fmtSize(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(2)} GB`;
}

function uniqueTarget(target: string): string {
  if (!fs.existsSync(target)) return target;
  const dir = path.dirname(target);
  const ext = path.extname(target);
  const base = path.basename(target, ext);
  for (let i = 1; i < 1000; i++) {
    const candidate = path.join(dir, `${base} (${i})${ext}`);
    if (!fs.existsSync(candidate)) return candidate;
  }
  throw new Error('Could not find a free file name.');
}

const TYPE_BUCKETS: [string, RegExp][] = [
  ['Images', /\.(png|jpe?g|gif|webp|bmp|svg|heic|tiff?|ico|avif)$/i],
  ['Videos', /\.(mp4|mov|mkv|avi|webm|wmv|m4v)$/i],
  ['Audio', /\.(mp3|wav|flac|m4a|aac|ogg|wma)$/i],
  ['Documents', /\.(pdf|docx?|odt|rtf|txt|md|pptx?|xlsx?|csv|epub|pages|key|numbers)$/i],
  ['Archives', /\.(zip|rar|7z|tar|gz|bz2|xz|iso)$/i],
  ['Installers', /\.(exe|msi|msix|appx|dmg|pkg|apk)$/i],
  ['Code', /\.(js|ts|tsx|jsx|py|java|c|cpp|cs|go|rs|html|css|json|ya?ml|sh|ps1|ipynb)$/i],
];

export const fsTools: AgentTool[] = [
  {
    name: 'list_folder',
    owner: 'hephaestus',
    description: 'List the contents of a folder on the operator\'s PC (names, types, sizes, dates). Accepts absolute paths or shortcuts like "Downloads", "Desktop", "Documents".',
    parameters: obj({ path: S('Folder path'), depth: N('How many levels deep (1-3, default 1)') }, ['path']),
    label: (a) => `list ${str(a, 'path')}`,
    run: async (args) => {
      const root = resolveSafe(str(args, 'path'));
      const depth = Math.min(Math.max(num(args, 'depth', 1), 1), 3);
      const out: string[] = [];
      let count = 0;
      const walk = (dir: string, level: number) => {
        let entries: fs.Dirent[];
        try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { out.push(`(cannot read ${dir}: ${(e as Error).message})`); return; }
        for (const e of entries.sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name))) {
          if (count >= 250) return;
          const full = path.join(dir, e.name);
          const indent = '  '.repeat(level - 1);
          try {
            const st = fs.statSync(full);
            count++;
            out.push(e.isDirectory()
              ? `${indent}[dir] ${e.name}/`
              : `${indent}${e.name}  (${fmtSize(st.size)}, ${new Date(st.mtimeMs).toISOString().slice(0, 10)})`);
            if (e.isDirectory() && level < depth && !SKIP_WALK.has(e.name.toLowerCase())) walk(full, level + 1);
          } catch { /* unreadable entry */ }
        }
      };
      walk(root, 1);
      return { folder: root, entries: out.length ? out : ['(empty)'], truncated: count >= 250 };
    },
  },
  {
    name: 'read_file',
    owner: 'hephaestus',
    // 12 Oct 2026: any file, not just text - documents through the reader, pictures and scans by eye.
    description: 'Read any file on the operator\'s PC: PDFs (scanned ones are read by eye), Word, PowerPoint (with speaker notes), Excel, OpenDocument, e-books, old .doc/.ppt/.xls, pictures and screenshots (read by eye), subtitles, and every kind of text or code. A long file: call again with start = the next_start you were given to read on.',
    parameters: obj({
      path: S('File path'),
      max_chars: N('Max characters to return (default 12000)'),
      start: N('Character to start from, to read on through a long file (default 0)'),
      pages: A('A scanned PDF only: which page numbers to read by eye (default the first 6)', { type: 'number' }),
    }, ['path']),
    label: (a) => `read ${path.basename(str(a, 'path'))}${num(a, 'start', 0) ? ' (more)' : ''}`,
    run: async (args, ctx) => {
      const file = resolveSafe(str(args, 'path'));
      const st = fs.statSync(file);
      if (st.isDirectory()) return { error: 'That is a folder - use list_folder.' };
      if (st.size > 25 * 1024 * 1024) return { path: file, size: fmtSize(st.size), error: 'Over 25 MB - too big to read here.' };
      const max = Math.min(num(args, 'max_chars', 12_000), 40_000);
      const start = Math.max(0, Math.floor(num(args, 'start', 0)));
      const page = (text: string, extra: Record<string, unknown> = {}) => ({
        path: file, size: fmtSize(st.size), ...extra, content: text.slice(start, start + max),
        truncated: start + max < text.length, next_start: start + max < text.length ? start + max : undefined, total_chars: text.length,
      });
      const buf = fs.readFileSync(file);
      // Text and code come back exactly as they are (edits depend on it); everything else goes through the reader.
      if (!isBinary(buf) && !DOCUMENT_EXT.test(file)) return page(buf.toString('utf8'));
      const pages = Array.isArray(args.pages) ? (args.pages as unknown[]).map(Number).filter((n) => Number.isInteger(n) && n > 0) : undefined;
      const key = `${file}|${st.mtimeMs}|${pages?.join(',') ?? ''}`;
      let read = readCache.get(key);
      if (!read) {
        const { readBytes } = await import('../../reader');
        const r = await readBytes(buf, path.basename(file), '', { signal: ctx.signal, pages });
        if ('error' in r) return { path: file, size: fmtSize(st.size), error: r.error };
        read = r;
        readCache.set(key, r);
        if (readCache.size > 6) readCache.delete(readCache.keys().next().value!);
      }
      return page(read.text, { kind: read.kind, pages: read.pages, seen_by: read.seenBy });
    },
  },
  {
    name: 'search_files',
    owner: 'hephaestus',
    description: 'Find files under a folder by name and/or by text inside them. Use name_contains for file names, content_contains to grep text files.',
    parameters: obj({
      folder: S('Folder to search in (default: the user folder)'),
      name_contains: S('Case-insensitive part of the file name, e.g. "essay" or ".pdf"'),
      content_contains: S('Text to find inside text files'),
      max_results: N('Default 40'),
    }),
    label: (a) => `search ${str(a, 'name_contains') || str(a, 'content_contains')} in ${str(a, 'folder') || '~'}`,
    run: async (args, ctx) => {
      const root = resolveSafe(str(args, 'folder') || os.homedir());
      const nameQ = str(args, 'name_contains').toLowerCase();
      const contentQ = str(args, 'content_contains').toLowerCase();
      if (!nameQ && !contentQ) return { error: 'Give name_contains or content_contains.' };
      const max = Math.min(num(args, 'max_results', 40), 100);
      const hits: string[] = [];
      let visited = 0;
      const walk = (dir: string, depth: number) => {
        if (depth > 8 || hits.length >= max || visited > 25_000 || ctx.signal.aborted) return;
        let entries: fs.Dirent[];
        try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
        for (const e of entries) {
          if (hits.length >= max) return;
          visited++;
          if (e.name.startsWith('.') || SKIP_WALK.has(e.name.toLowerCase())) continue;
          const full = path.join(dir, e.name);
          if (e.isDirectory()) { walk(full, depth + 1); continue; }
          if (nameQ && !e.name.toLowerCase().includes(nameQ)) continue;
          if (DENY_FILE.test(e.name)) continue;
          if (contentQ) {
            try {
              const st = fs.statSync(full);
              if (st.size > 1_500_000) continue;
              const buf = fs.readFileSync(full);
              if (isBinary(buf)) continue;
              const text = buf.toString('utf8');
              const idx = text.toLowerCase().indexOf(contentQ);
              if (idx === -1) continue;
              hits.push(`${full}  ...${text.slice(Math.max(0, idx - 60), idx + 100).replace(/\s+/g, ' ')}...`);
            } catch { continue; }
          } else {
            hits.push(full);
          }
        }
      };
      walk(root, 0);
      return { folder: root, results: hits, note: hits.length >= max ? 'More results exist - narrow the search.' : undefined };
    },
  },
  {
    name: 'write_file',
    owner: 'hephaestus',
    description: 'Create a text file (or overwrite/append to one) on the operator\'s PC. Only write files the operator asked for. Anything outside Ultron\'s own vault asks the operator first.',
    parameters: obj({
      path: S('File path including name, e.g. "Documents/Study Plan.md"'),
      content: S('Full text content'),
      mode: S('create (default), overwrite, or append', { enum: ['create', 'overwrite', 'append'] }),
    }, ['path', 'content']),
    label: (a) => `write ${path.basename(str(a, 'path'))}`,
    run: async (args, ctx) => {
      const file = resolveWritable(str(args, 'path'));
      if (EXEC_EXT.test(file)) return { error: 'Refusing to write an executable/script file type.' };
      const mode = str(args, 'mode', 'create');
      const content = str(args, 'content');
      const exists = fs.existsSync(file);
      if (exists && mode === 'create') return { error: `${file} already exists. Use mode "overwrite" or "append", or pick another name.` };
      if (exists || !insideVault(file)) {
        const verb = !exists ? 'Create' : mode === 'append' ? 'Append to' : 'Overwrite';
        const ok = await ctx.approve(exists ? 'modify-file' : 'create-file', `${verb} ${path.basename(file)}?`, `${file}\n\n${content.slice(0, 600)}${content.length > 600 ? '...' : ''}`);
        if (!ok) return { error: 'The operator declined.' };
      }
      const backup = exists && !insideVault(file) ? backupFile(file) : undefined;
      fs.mkdirSync(path.dirname(file), { recursive: true });
      if (mode === 'append') fs.appendFileSync(file, content, 'utf8');
      else fs.writeFileSync(file, content, 'utf8');
      return { ok: true, path: file, bytes: Buffer.byteLength(content), backup_of_old_version: backup };
    },
  },
  {
    name: 'create_folder',
    owner: 'hephaestus',
    description: 'Create a folder (and any missing parents). Outside Ultron\'s vault this asks the operator first.',
    parameters: obj({ path: S('Folder path') }, ['path']),
    label: (a) => `mkdir ${str(a, 'path')}`,
    run: async (args, ctx) => {
      const dir = resolveWritable(str(args, 'path'));
      if (fs.existsSync(dir)) return { ok: true, path: dir, note: 'Already existed.' };
      if (!insideVault(dir) && !(await ctx.approve('create-file', `Create folder ${path.basename(dir)}?`, dir))) return { error: 'The operator declined.' };
      fs.mkdirSync(dir, { recursive: true });
      return { ok: true, path: dir };
    },
  },
  {
    name: 'move_path',
    owner: 'hephaestus',
    description: 'Move or rename a file or folder. Asks the operator first. If the destination is an existing folder the item goes inside it.',
    parameters: obj({ from: S('Source path'), to: S('Destination path or folder') }, ['from', 'to']),
    label: (a) => `move ${path.basename(str(a, 'from'))} -> ${str(a, 'to')}`,
    run: async (args, ctx) => {
      const from = resolveWritable(str(args, 'from'));
      let to = resolveWritable(str(args, 'to'));
      if (!fs.existsSync(from)) return { error: `${from} does not exist.` };
      if (fs.existsSync(to) && fs.statSync(to).isDirectory()) to = path.join(to, path.basename(from));
      if (fs.existsSync(to)) return { error: `${to} already exists - pick another name.` };
      const ok = await ctx.approve('move', `Move ${path.basename(from)}?`, `${from}\n-> ${to}`);
      if (!ok) return { error: 'The operator declined.' };
      fs.mkdirSync(path.dirname(to), { recursive: true });
      fs.renameSync(from, to);
      return { ok: true, from, to };
    },
  },
  {
    name: 'copy_path',
    owner: 'hephaestus',
    description: 'Copy a file or folder to a new location (never overwrites). Outside Ultron\'s vault this asks the operator first.',
    parameters: obj({ from: S('Source path'), to: S('Destination path or folder') }, ['from', 'to']),
    label: (a) => `copy ${path.basename(str(a, 'from'))}`,
    run: async (args, ctx) => {
      const from = resolveSafe(str(args, 'from'));
      let to = resolveWritable(str(args, 'to'));
      if (!fs.existsSync(from)) return { error: `${from} does not exist.` };
      if (fs.existsSync(to) && fs.statSync(to).isDirectory()) to = path.join(to, path.basename(from));
      to = uniqueTarget(to);
      if (!insideVault(to) && !(await ctx.approve('create-file', `Copy ${path.basename(from)}?`, `${from}\n-> ${to}`))) return { error: 'The operator declined.' };
      fs.mkdirSync(path.dirname(to), { recursive: true });
      fs.cpSync(from, to, { recursive: true, errorOnExist: true });
      return { ok: true, from, to };
    },
  },
  {
    name: 'delete_path',
    owner: 'hephaestus',
    description: 'Send a file or folder to the Recycle Bin (recoverable). Asks the operator first.',
    parameters: obj({ path: S('Path to delete') }, ['path']),
    label: (a) => `recycle ${path.basename(str(a, 'path'))}`,
    run: async (args, ctx) => {
      const target = resolveWritable(str(args, 'path'));
      if (!fs.existsSync(target)) return { error: `${target} does not exist.` };
      if (roots().some((r) => r.toLowerCase() === target.toLowerCase())) return { error: 'Refusing to delete a whole root folder.' };
      const ok = await ctx.approve('delete', `Send ${path.basename(target)} to the Recycle Bin?`, target);
      if (!ok) return { error: 'The operator declined.' };
      await shell.trashItem(target);
      return { ok: true, recycled: target };
    },
  },
  {
    name: 'organize_folder',
    owner: 'hephaestus',
    description: 'Tidy a messy folder (e.g. Downloads) by moving its loose files into subfolders by type (Images, Documents, Videos, Audio, Archives, Installers, Code, Other) or by month. Run with dry_run true first to see the plan; running for real asks the operator once.',
    parameters: obj({
      folder: S('Folder to organize'),
      scheme: S('"type" (default) or "month"', { enum: ['type', 'month'] }),
      dry_run: B('true = only report the plan (default true)'),
    }, ['folder']),
    label: (a) => `organize ${str(a, 'folder')}${bool(a, 'dry_run', true) ? ' (plan)' : ''}`,
    run: async (args, ctx) => {
      const folder = resolveWritable(str(args, 'folder'));
      const scheme = str(args, 'scheme', 'type') === 'month' ? 'month' : 'type';
      const dry = bool(args, 'dry_run', true);
      const moves: { from: string; bucket: string }[] = [];
      for (const e of fs.readdirSync(folder, { withFileTypes: true })) {
        if (!e.isFile() || e.name.startsWith('.') || /^desktop\.ini$/i.test(e.name)) continue;
        const full = path.join(folder, e.name);
        let bucket = 'Other';
        if (scheme === 'type') bucket = TYPE_BUCKETS.find(([, re]) => re.test(e.name))?.[0] ?? 'Other';
        else bucket = new Date(fs.statSync(full).mtimeMs).toISOString().slice(0, 7);
        moves.push({ from: full, bucket });
      }
      const counts: Record<string, number> = {};
      for (const m of moves) counts[m.bucket] = (counts[m.bucket] ?? 0) + 1;
      if (!moves.length) return { folder, note: 'No loose files to organize.' };
      if (dry) return { folder, plan: counts, files: moves.length, note: 'Dry run - nothing moved. Call again with dry_run false to do it.' };
      const ok = await ctx.approve('organize', `Organize ${moves.length} files in ${path.basename(folder)}?`,
        `${folder}\n${Object.entries(counts).map(([k, v]) => `${k}: ${v}`).join('\n')}`);
      if (!ok) return { error: 'The operator declined.' };
      let moved = 0;
      for (const m of moves) {
        try {
          const dest = uniqueTarget(path.join(folder, m.bucket, path.basename(m.from)));
          fs.mkdirSync(path.dirname(dest), { recursive: true });
          fs.renameSync(m.from, dest);
          moved++;
        } catch { /* file in use - leave it */ }
      }
      return { ok: true, folder, moved, plan: counts };
    },
  },
  {
    name: 'open_path',
    owner: 'hephaestus',
    description: 'Open a file or folder on the operator\'s screen with its default app (e.g. open a document, show a folder in Explorer).',
    parameters: obj({ path: S('File or folder path') }, ['path']),
    label: (a) => `open ${path.basename(str(a, 'path'))}`,
    run: async (args, ctx) => {
      const target = resolveSafe(str(args, 'path'));
      if (!fs.existsSync(target)) return { error: `${target} does not exist.` };
      if (EXEC_EXT.test(target)) {
        const ok = await ctx.approve('run-program', `Run ${path.basename(target)}?`, `${target}\nOpening this runs a program or script.`);
        if (!ok) return { error: 'The operator declined.' };
      }
      const err = await shell.openPath(target);
      return err ? { error: err } : { ok: true, opened: target };
    },
  },
  {
    name: 'file_info',
    owner: 'hephaestus',
    description: 'Size, dates and type of a file or folder (folders: total size and file count, capped).',
    parameters: obj({ path: S('Path') }, ['path']),
    label: (a) => `info ${path.basename(str(a, 'path'))}`,
    run: async (args) => {
      const target = resolveSafe(str(args, 'path'));
      const st = fs.statSync(target);
      if (!st.isDirectory()) return { path: target, size: fmtSize(st.size), modified: new Date(st.mtimeMs).toISOString(), created: new Date(st.birthtimeMs).toISOString() };
      let total = 0;
      let files = 0;
      const walk = (dir: string, depth: number) => {
        if (depth > 6 || files > 50_000) return;
        let entries: fs.Dirent[];
        try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
        for (const e of entries) {
          const full = path.join(dir, e.name);
          if (e.isDirectory()) walk(full, depth + 1);
          else { try { total += fs.statSync(full).size; files++; } catch { /* skip */ } }
        }
      };
      walk(target, 0);
      return { path: target, folder: true, files, size: fmtSize(total), modified: new Date(st.mtimeMs).toISOString() };
    },
  },
  {
    name: 'run_command',
    owner: 'hephaestus',
    description: 'Run a PowerShell command on the operator\'s PC and return its output (60s limit). ALWAYS asks the operator first and shows them the exact command. Prefer the file tools when they can do the job.',
    parameters: obj({ command: S('PowerShell command'), working_dir: S('Folder to run it in (default: user folder)'), why: S('One line: why this command is needed') }, ['command', 'why']),
    label: (a) => `powershell: ${str(a, 'command').slice(0, 60)}`,
    run: async (args, ctx) => {
      const command = str(args, 'command').trim();
      if (!command) return { error: 'Empty command.' };
      const cwd = str(args, 'working_dir') ? resolveSafe(str(args, 'working_dir')) : os.homedir();
      const ok = await ctx.approve('command', 'Run this PowerShell command?', `${str(args, 'why')}\n\n> ${command}\n\n(in ${cwd})`);
      if (!ok) return { error: 'The operator declined.' };
      return new Promise((resolve) => {
        execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], { cwd, timeout: 60_000, maxBuffer: 4 * 1024 * 1024, windowsHide: true }, (err, stdout, stderr) => {
          resolve({
            exitCode: err && typeof (err as { code?: unknown }).code === 'number' ? (err as { code: number }).code : err ? 1 : 0,
            stdout: clip(stdout, 8000),
            stderr: clip(stderr, 3000),
            timedOut: Boolean(err && (err as { killed?: boolean }).killed),
          });
        });
      });
    },
  },
];
