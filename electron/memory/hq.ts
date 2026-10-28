import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { getSettings } from '../store';
import type { VaultNote } from './vault';

/*
 * The operator's HQ - the folder with north-star.md and one folder per area of his life -
 * as part of the shared brain, which only reads it. (The one thing that ever writes there is
 * hq_health_update, which shows him the change and writes only when he approves.) Only the notes
 * meant to be read are indexed (north-star.md, each area's CLAUDE.md and its context/
 * files): no code, no node_modules, no .git, no project folders. His personal Obsidian
 * vault is somewhere else entirely and is never touched.
 */

export const HQ_AREAS = ['health-fitness', 'school', 'finances', 'projects', 'personal', 'history'];
const MAX_FILES = 400;
const MAX_BYTES = 300_000;

/** The HQ folder: the one set in Settings, or the usual place when it has a north-star.md. */
export function hqRoot(): string | null {
  const s = getSettings();
  if (s.hq?.on === false) return null;
  const configured = s.hq?.path?.trim();
  const candidates = configured ? [configured] : [path.join(os.homedir(), 'OneDrive', 'Desktop', 'Claude Code testing')];
  return candidates.find((c) => fs.existsSync(path.join(c, 'north-star.md'))) ?? null;
}

function note(root: string, rel: string): VaultNote | null {
  try {
    const st = fs.statSync(path.join(root, rel));
    if (!st.isFile() || st.size > MAX_BYTES) return null;
    return { rel: `HQ/${rel}`, title: path.basename(rel, '.md'), folder: 'HQ', mtime: st.mtimeMs, size: st.size };
  } catch {
    return null;
  }
}

/** Whether a path inside HQ is one of the notes the shared brain may read. */
export function isHqNote(rel: string): boolean {
  const r = rel.replace(/\\/g, '/');
  if (r.split('/').some((p) => p === '..' || p.startsWith('.') || p === 'node_modules')) return false;
  if (!r.toLowerCase().endsWith('.md')) return false;
  if (r === 'north-star.md' || r === 'CLAUDE.md') return true;
  const [area, second, ...rest] = r.split('/');
  if (!HQ_AREAS.includes(area)) return false;
  if (second === 'CLAUDE.md' && !rest.length) return true;
  return second === 'context' && rest.length >= 1 && rest.length <= 4;
}

export function listHqNotes(root = hqRoot()): VaultNote[] {
  if (!root) return [];
  const out: VaultNote[] = [];
  const add = (rel: string) => {
    if (out.length >= MAX_FILES || !isHqNote(rel)) return;
    const n = note(root, rel);
    if (n) out.push(n);
  };
  add('north-star.md');
  add('CLAUDE.md');
  for (const area of HQ_AREAS) {
    add(`${area}/CLAUDE.md`);
    const walk = (dir: string, depth: number) => {
      if (depth > 4 || out.length >= MAX_FILES) return;
      let entries: fs.Dirent[];
      try { entries = fs.readdirSync(path.join(root, dir), { withFileTypes: true }); } catch { return; }
      for (const e of entries) {
        if (e.name.startsWith('.') || e.name === 'node_modules') continue;
        const rel = `${dir}/${e.name}`;
        if (e.isDirectory()) walk(rel, depth + 1);
        else if (e.isFile()) add(rel);
      }
    };
    walk(`${area}/context`, 1);
  }
  return out;
}

/** Reads one HQ note by its shared-brain path ("HQ/north-star.md"). Never anything outside the list. */
export function readHqNote(rel: string, root = hqRoot()): string | null {
  if (!root || !rel.startsWith('HQ/')) return null;
  const inner = rel.slice(3);
  if (!isHqNote(inner)) return null;
  const full = path.resolve(root, inner);
  if (!full.startsWith(path.resolve(root) + path.sep)) return null;
  try {
    return fs.readFileSync(full, 'utf8');
  } catch {
    return null;
  }
}
