import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { getSettings } from './store';

/**
 * Reuses the exact same folder-containment boundary as files.ts, by design:
 * a path is only touched if it resolves (via fs.realpathSync.native, not a
 * naive string comparison) inside a folder the operator explicitly added
 * through the OS picker. This mirrors files.ts's isIndexed()/realpathOrSelf()
 * shape so `attrib` can never reach anything the operator hasn't opted into
 * indexing.
 */

const run = promisify(execFile);

function realpathOrSelf(p: string): string {
  try {
    return fs.realpathSync.native(p);
  } catch {
    return path.resolve(p);
  }
}

/** True if `target` resolves inside one of the operator's indexed folders. */
function isIndexed(target: string): boolean {
  const resolved = realpathOrSelf(target);
  const roots = getSettings().folders.map((f) => realpathOrSelf(f.path));
  return roots.some((root) => resolved === root || resolved.startsWith(root + path.sep));
}

export async function hideFolderContents(
  folderPath: string,
): Promise<{ ok: boolean; hiddenCount?: number; error?: string }> {
  try {
    if (!isIndexed(folderPath)) {
      return { ok: false, error: 'That folder is outside every indexed folder.' };
    }
    const st = fs.statSync(folderPath);
    if (!st.isDirectory()) return { ok: false, error: 'Not a folder.' };

    const entries = fs.readdirSync(folderPath, { withFileTypes: true });
    let hiddenCount = 0;
    for (const entry of entries) {
      const full = path.join(folderPath, entry.name);
      await run('attrib', ['+h', full]);
      hiddenCount += 1;
    }
    return { ok: true, hiddenCount };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function unhideFolderContents(
  folderPath: string,
): Promise<{ ok: boolean; shownCount?: number; error?: string }> {
  try {
    if (!isIndexed(folderPath)) {
      return { ok: false, error: 'That folder is outside every indexed folder.' };
    }
    const st = fs.statSync(folderPath);
    if (!st.isDirectory()) return { ok: false, error: 'Not a folder.' };

    const entries = fs.readdirSync(folderPath, { withFileTypes: true });
    let shownCount = 0;
    for (const entry of entries) {
      const full = path.join(folderPath, entry.name);
      await run('attrib', ['-h', full]);
      shownCount += 1;
    }
    return { ok: true, shownCount };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
