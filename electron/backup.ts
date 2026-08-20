import fs from 'node:fs';
import { dialog } from 'electron';
import { getSettings, saveSettings, type Settings, type IndexedFolder } from './store';
import { getMemory, saveMemory } from './memory';

/**
 * Settings + memory backup/restore.
 *
 * Deliberately excludes anything from `.env` / `electron/env.ts`
 * (GNEWS_API_KEY, GEMINI_API_KEY, or any future secret read via env()/
 * setEnvKey()). This module never imports env.ts and never reads those
 * values - a backup file is plain text likely to end up in cloud storage
 * or on a USB stick, and bundling live API keys would turn a settings
 * backup into a credentials leak. Re-entering keys on a new machine via
 * the existing "Write to .env" flow in Settings is the correct path.
 *
 * Also excludes news-cache.json / news-quota.json - disposable, regenerated
 * state, not user data worth restoring.
 */

export interface BackupBundle {
  version: 1;
  exportedAt: string; // ISO timestamp
  settings: Settings; // from store.ts - no API keys live here
  memory: string; // raw memory.md contents
  folders: IndexedFolder[]; // redundant with settings.folders, kept explicit
  // for forward-compat if folders ever move out of Settings
}

function isSettingsShape(value: unknown): value is Settings {
  if (!value || typeof value !== 'object') return false;
  const s = value as Record<string, unknown>;
  return (
    typeof s.profile === 'object' &&
    s.profile !== null &&
    typeof s.news === 'object' &&
    s.news !== null &&
    typeof s.ollama === 'object' &&
    s.ollama !== null &&
    (s.brain === 'ollama' || s.brain === 'gemini') &&
    typeof s.gemini === 'object' &&
    s.gemini !== null &&
    typeof s.voice === 'object' &&
    s.voice !== null &&
    Array.isArray(s.folders)
  );
}

function isBackupBundle(value: unknown): value is BackupBundle {
  if (!value || typeof value !== 'object') return false;
  const b = value as Record<string, unknown>;
  return (
    b.version === 1 &&
    typeof b.exportedAt === 'string' &&
    typeof b.memory === 'string' &&
    Array.isArray(b.folders) &&
    isSettingsShape(b.settings)
  );
}

function defaultBackupFileName(): string {
  const d = new Date();
  const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate(),
  ).padStart(2, '0')}`;
  return `atlas-backup-${date}.json`;
}

export async function exportBackup(
  win: import('electron').BrowserWindow | null,
): Promise<{ ok: boolean; path?: string; error?: string }> {
  try {
    const result = win
      ? await dialog.showSaveDialog(win, {
          defaultPath: defaultBackupFileName(),
          filters: [{ name: 'JSON', extensions: ['json'] }],
        })
      : await dialog.showSaveDialog({
          defaultPath: defaultBackupFileName(),
          filters: [{ name: 'JSON', extensions: ['json'] }],
        });

    if (result.canceled || !result.filePath) {
      return { ok: false };
    }

    const settings = getSettings();
    const bundle: BackupBundle = {
      version: 1,
      exportedAt: new Date().toISOString(),
      settings,
      memory: getMemory(),
      folders: settings.folders,
    };

    fs.writeFileSync(result.filePath, JSON.stringify(bundle, null, 2), 'utf8');
    return { ok: true, path: result.filePath };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function importBackup(
  win: import('electron').BrowserWindow | null,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const result = win
      ? await dialog.showOpenDialog(win, {
          properties: ['openFile'],
          filters: [{ name: 'JSON', extensions: ['json'] }],
        })
      : await dialog.showOpenDialog({
          properties: ['openFile'],
          filters: [{ name: 'JSON', extensions: ['json'] }],
        });

    if (result.canceled || result.filePaths.length === 0) {
      return { ok: false };
    }

    const filePath = result.filePaths[0];
    let raw: string;
    try {
      raw = fs.readFileSync(filePath, 'utf8');
    } catch (e) {
      return { ok: false, error: `Could not read file: ${e instanceof Error ? e.message : String(e)}` };
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return { ok: false, error: 'That file is not valid JSON.' };
    }

    if (!isBackupBundle(parsed)) {
      return { ok: false, error: 'That file does not look like a valid Atlas backup.' };
    }

    saveSettings(parsed.settings);
    const memResult = saveMemory(parsed.memory);
    if (!memResult.ok) {
      return { ok: false, error: memResult.error ?? 'Failed to write memory.md during restore.' };
    }

    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
