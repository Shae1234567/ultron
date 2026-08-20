import { getSettings } from './store';
import { listFiles } from './files';

/**
 * Obsidian isn't an API - a vault is just a folder of markdown files. This
 * connector needs no credentials at all: it reuses the same indexed-folder
 * system the Files tab already has, and is "connected" the moment one of
 * those folders actually contains markdown notes.
 */

export interface VaultFolder {
  path: string;
  noteCount: number;
}

export interface NoteRef {
  name: string;
  path: string;
  folder: string;
  modified: number;
}

const isNote = (ext: string) => ext === 'md' || ext === 'markdown';

export function getVaultFolders(): VaultFolder[] {
  const { folders } = getSettings();
  const files = listFiles(5000);
  return folders
    .map((f) => ({ path: f.path, noteCount: files.filter((file) => file.folder === f.path && isNote(file.ext)).length }))
    .filter((f) => f.noteCount > 0);
}

export function hasVault(): boolean {
  return getVaultFolders().length > 0;
}

/** Most recently modified notes across every indexed folder that has any. */
export function getRecentNotes(limit = 10): NoteRef[] {
  return listFiles(5000)
    .filter((f) => isNote(f.ext))
    .slice(0, limit)
    .map((f) => ({ name: f.name, path: f.path, folder: f.folder, modified: f.modified }));
}
