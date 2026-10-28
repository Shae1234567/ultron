import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { app } from 'electron';
import { getSettings, saveSettings } from './store';
import { vaultRoot } from './memory/vault';

/**
 * A daily copy of the memory vault, kept 30 days. The vault is the one thing
 * in Ultron that cannot be rebuilt - everything else is settings or code - so
 * a bad write, a sync conflict or a mistaken "forget that" should never be
 * the end of it. Copies live outside the vault so a vault-wide mistake cannot
 * take them with it.
 */

const KEEP_DAYS = 30;
const JOB = 'vaultBackup';

export function backupsRoot(): string {
  const local = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
  return path.join(local, 'Ultron Backups', 'vault');
}

function today(now = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

/** Ultron's own data folder (where the department logs live). */
function dataDir(): string {
  try {
    return app.getPath('userData');
  } catch {
    return '';
  }
}

/**
 * Data that lives beside the vault rather than in it, copied into each day's backup under
 * _ultron/: the departments' logs (sleep, training, food, school...). Brains, department
 * notes, Helios's intel and the course library are vault folders, so the vault copy has them.
 */
export const DATA_FOLDERS = ['departments'];

/** Copies the vault into today's folder (skipped if today's copy already exists). Returns the folder, or null. */
export function backupVault(force = false, data = dataDir()): { path: string; files: number } | null {
  const src = vaultRoot();
  if (!fs.existsSync(src)) return null;
  const dest = path.join(backupsRoot(), today());
  if (!force && fs.existsSync(dest)) return null;
  let files = 0;
  const copy = (from: string, to: string, depth: number): void => {
    if (depth > 8) return;
    fs.mkdirSync(to, { recursive: true });
    for (const e of fs.readdirSync(from, { withFileTypes: true })) {
      if (e.name.startsWith('.')) continue;
      const a = path.join(from, e.name);
      const b = path.join(to, e.name);
      try {
        if (e.isDirectory()) copy(a, b, depth + 1);
        else { fs.copyFileSync(a, b); files++; }
      } catch { /* one locked file never stops the backup */ }
    }
  };
  copy(src, dest, 0);
  for (const f of DATA_FOLDERS) {
    const from = data ? path.join(data, f) : '';
    if (from && fs.existsSync(from)) copy(from, path.join(dest, '_ultron', f), 1);
  }
  prune();
  saveSettings({ jobs: { [JOB]: Date.now() } });
  return { path: dest, files };
}

/** Drops copies older than 30 days. */
export function prune(now = Date.now()): number {
  const root = backupsRoot();
  let gone = 0;
  try {
    for (const d of fs.readdirSync(root)) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) continue;
      if (now - Date.parse(d) > KEEP_DAYS * 86_400_000) {
        fs.rmSync(path.join(root, d), { recursive: true, force: true });
        gone++;
      }
    }
  } catch { /* nothing backed up yet */ }
  return gone;
}

export function listBackups(): { date: string; files: number }[] {
  try {
    return fs.readdirSync(backupsRoot())
      .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d))
      .sort((a, b) => b.localeCompare(a))
      .map((date) => {
        let files = 0;
        const walk = (dir: string, depth: number): void => {
          if (depth > 8) return;
          for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
            if (e.isDirectory()) walk(path.join(dir, e.name), depth + 1);
            else files++;
          }
        };
        try { walk(path.join(backupsRoot(), date), 0); } catch { /* unreadable */ }
        return { date, files };
      });
  } catch {
    return [];
  }
}

let timer: ReturnType<typeof setInterval> | null = null;

/** Backs the vault up once a day, in the background. */
export function startVaultBackups(): void {
  if (timer) return;
  const tick = () => {
    const last = Number(getSettings().jobs[JOB] ?? 0);
    if (Date.now() - last < 20 * 3600_000) return;
    try { backupVault(); } catch { /* best-effort */ }
  };
  setTimeout(tick, 3 * 60_000);
  timer = setInterval(tick, 6 * 3600_000);
}
