import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';

/**
 * Minimal .env loader. No runtime dependency, no bundling surprises.
 * Keys are NEVER hardcoded — they only ever come from this file.
 */

let cache: Record<string, string> | null = null;

function candidatePaths(): string[] {
  const paths = [
    path.join(process.cwd(), '.env'),
    path.join(app.getAppPath(), '.env'),
    path.join(path.dirname(app.getPath('exe')), '.env'),
    path.join(app.getPath('userData'), '.env'),
  ];
  // De-dupe while preserving order
  return [...new Set(paths)];
}

/** The file we write to when the user saves a key from the settings panel. */
export function writableEnvPath(): string {
  const found = candidatePaths().find((p) => fs.existsSync(p));
  if (found) return found;
  return app.isPackaged
    ? path.join(app.getPath('userData'), '.env')
    : path.join(process.cwd(), '.env');
}

function parse(raw: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (key) out[key] = value;
  }
  return out;
}

export function loadEnv(force = false): Record<string, string> {
  if (cache && !force) return cache;
  const merged: Record<string, string> = {};
  for (const p of candidatePaths()) {
    try {
      if (fs.existsSync(p)) Object.assign(merged, parse(fs.readFileSync(p, 'utf8')));
    } catch {
      /* unreadable .env is not fatal — app runs without news */
    }
  }
  cache = merged;
  return merged;
}

export function env(key: string, fallback = ''): string {
  const fromFile = loadEnv()[key];
  if (fromFile) return fromFile;
  return process.env[key] ?? fallback;
}

/** Write/replace a single key in the .env file, preserving other lines. */
export function setEnvKey(key: string, value: string): string {
  const target = writableEnvPath();
  let lines: string[] = [];
  try {
    if (fs.existsSync(target)) lines = fs.readFileSync(target, 'utf8').split(/\r?\n/);
  } catch {
    lines = [];
  }
  const idx = lines.findIndex((l) => l.trim().startsWith(`${key}=`));
  if (idx >= 0) lines[idx] = `${key}=${value}`;
  else lines.push(`${key}=${value}`);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, lines.join('\n'), 'utf8');
  loadEnv(true);
  return target;
}
