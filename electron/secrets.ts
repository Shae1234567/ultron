import fs from 'node:fs';
import path from 'node:path';
import { app, safeStorage } from 'electron';

/**
 * API keys, encrypted at rest with the OS keychain (DPAPI on Windows) and
 * stored in userData - the same place in dev and in the installed app, which
 * is what the old .env approach got wrong (a packaged app can't write next to
 * its own asar, and the settings panel quietly wrote somewhere else).
 */

export const SECRET_NAMES = [
  'GEMINI_API_KEY',
  'GROQ_API_KEY',
  'OPENROUTER_API_KEY',
  'NVIDIA_API_KEY',
  'HUGGINGFACE_API_KEY',
  'OPENAI_API_KEY',
  'DEEPSEEK_API_KEY',
  'COMPOSIO_API_KEY',
  'GNEWS_API_KEY',
  'TELEGRAM_BOT_TOKEN',
  'DISCORD_BOT_TOKEN',
  'WOLFRAM_APP_ID',
] as const;

export type SecretName = (typeof SECRET_NAMES)[number];

/** Secrets the app manages itself and the operator never types - e.g. the Composio sign-in tokens. */
export const INTERNAL_SECRETS = ['COMPOSIO_OAUTH'] as const;
export type InternalSecret = (typeof INTERNAL_SECRETS)[number];
/** Keys for services the operator added himself (Settings -> AI services -> Add a service). */
export type CustomSecret = `CUSTOM_${string}`;
export const isCustomSecret = (name: string): name is CustomSecret => /^CUSTOM_[A-Z0-9_]{2,48}$/.test(name);
type AnySecret = SecretName | InternalSecret | CustomSecret;
const ALL_NAMES: readonly AnySecret[] = [...SECRET_NAMES, ...INTERNAL_SECRETS];

interface SecretFile {
  v: 1;
  encrypted: boolean;
  items: Partial<Record<AnySecret, string>>;
}

let cache: Partial<Record<AnySecret, string>> | null = null;

function filePath(): string {
  return path.join(app.getPath('userData'), 'secrets.json');
}

function canEncrypt(): boolean {
  try {
    return safeStorage.isEncryptionAvailable();
  } catch {
    return false;
  }
}

/**
 * Entries this build will not touch but must not destroy, kept exactly as they
 * were on disk and written straight back:
 *
 *  - values that would not decrypt (a half-written file, a profile quirk);
 *  - names this build does not know, which happens whenever a service is
 *    renamed or swapped out between versions. Dropping those would quietly
 *    delete a key the operator pasted, and they would have to find it again.
 */
let preserved: Record<string, string> = {};

/** A copy kept beside the live file, so a half-written or deleted one is never the end of it. */
function backupPath(): string {
  return `${filePath()}.backup`;
}

function readFile(p: string): SecretFile | null {
  try {
    const raw = JSON.parse(fs.readFileSync(p, 'utf8')) as SecretFile;
    return raw && typeof raw === 'object' && raw.items ? raw : null;
  } catch {
    return null;
  }
}

function load(): Partial<Record<AnySecret, string>> {
  if (cache) return cache;
  const out: Partial<Record<AnySecret, string>> = {};
  const stuck: Record<string, string> = {};
  let raw = readFile(filePath());
  // The live file is gone or unreadable (a crash mid-write, a tidy-up gone wrong):
  // fall back to the copy rather than silently starting with no keys at all.
  if (!raw || !Object.keys(raw.items).length) {
    const backup = readFile(backupPath());
    if (backup && Object.keys(backup.items).length) {
      raw = backup;
      try {
        fs.copyFileSync(backupPath(), filePath());
        console.warn('[secrets] the key file was unreadable - restored it from the backup');
      } catch { /* read-only disk; the keys are still loaded below */ }
    }
  }
  const known = new Set<string>(ALL_NAMES);
  for (const [name, stored] of Object.entries(raw?.items ?? {})) {
    if (!stored) continue;
    // A name this build does not know - a service that was renamed or swapped out.
    if (!known.has(name) && !isCustomSecret(name)) {
      stuck[name] = stored;
      continue;
    }
    try {
      out[name as AnySecret] = raw!.encrypted ? safeStorage.decryptString(Buffer.from(stored, 'base64')) : stored;
    } catch {
      // ONE bad entry must never cost the others. Before this was per-entry, a single
      // failure aborted the whole loop and the next save wrote the truncated set to
      // disk - silently losing every key that came after it.
      stuck[name] = stored;
    }
  }
  preserved = stuck;
  cache = out;
  // A first run, or a build that never saved anything: make sure a copy exists from the start.
  if (Object.keys(raw?.items ?? {}).length && !fs.existsSync(backupPath())) {
    try { fs.copyFileSync(filePath(), backupPath()); } catch { /* bonus, not required */ }
  }
  return out;
}

function persist(values: Partial<Record<AnySecret, string>>): void {
  const encrypted = canEncrypt();
  const items: Partial<Record<AnySecret, string>> = {};
  for (const [name, value] of Object.entries(values) as [AnySecret, string][]) {
    if (!value) continue;
    items[name] = encrypted ? safeStorage.encryptString(value).toString('base64') : value;
  }
  // Anything this build cannot read or does not recognise stays on disk exactly as it was.
  for (const [name, stored] of Object.entries(preserved)) {
    if (!(name in items)) (items as Record<string, string>)[name] = stored;
  }
  const data: SecretFile = { v: 1, encrypted, items };
  const target = filePath();
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const tmp = `${target}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(tmp, target);
  // Only once the new file is safely in place, refresh the copy - never the other way round.
  try {
    if (Object.keys(items).length) fs.copyFileSync(target, backupPath());
  } catch { /* the live file is written; the copy is a bonus */ }
}

export function isSecretName(name: string): name is SecretName {
  return (SECRET_NAMES as readonly string[]).includes(name);
}

export function getSecret(name: SecretName | CustomSecret): string {
  return load()[name] || process.env[name] || '';
}

export function hasSecret(name: SecretName | CustomSecret): boolean {
  return Boolean(getSecret(name));
}

/** Stores (or with '' / null, removes) the key of a service the operator added. Same encryption as the rest. */
export function setCustomSecret(name: CustomSecret, value: string | null): void {
  if (!isCustomSecret(name)) throw new Error('Not a custom service key.');
  const clean = value ? cleanSecret(value) : '';
  if (/[\r\n\s]/.test(clean)) throw new Error('Keys cannot contain spaces or line breaks - paste just the key.');
  const next = { ...load() };
  if (clean) next[name] = clean;
  else delete next[name];
  persist(next);
  cache = next;
}

export function getInternalSecret(name: InternalSecret): string {
  return load()[name] ?? '';
}

/** Stores (or with null, removes) an app-managed secret - encrypted like the rest, no key-format rules. */
export function setInternalSecret(name: InternalSecret, value: string | null): void {
  const next = { ...load() };
  if (value) next[name] = value;
  else delete next[name];
  persist(next);
  cache = next;
}

/**
 * What people actually paste: a key with a trailing space or newline, wrapped
 * in quotes, with invisible zero-width characters from a web page, or the
 * whole `x-consumer-api-key: ck_...` / `COMPOSIO_API_KEY=...` line from a
 * docs snippet. Keep just the key.
 */
export function cleanSecret(value: string): string {
  let v = value.replace(/[\u200B-\u200D\u2060\uFEFF]/g, '').replace(/\u00A0/g, ' ').trim();
  v = v.replace(/^export\s+/i, '');
  // `COMPOSIO_API_KEY=ck_...`, `x-consumer-api-key: ck_...`, `"x-api-key": "ak_..."` - only when the
  // left side is named like a key, so a key that merely contains ":" or "=" is left alone.
  const assigned = /^["'`]?([\w.-]*(?:key|token|secret|authorization|appid|app_id)[\w.-]*)["'`]?\s*[:=]\s*(.+?),?$/i.exec(v);
  if (assigned) v = assigned[2].trim();
  // "Bot MTQ5..." - Discord's docs show bot tokens with their header prefix.
  v = v.replace(/^(bearer|bot)\s+/i, '').trim();
  const quoted = /^(["'`])(.*)\1$/.exec(v);
  if (quoted) v = quoted[2].trim();
  return v;
}

export function setSecret(name: SecretName, value: string): void {
  const clean = cleanSecret(value);
  if (/[\r\n\s]/.test(clean)) throw new Error('Keys cannot contain spaces or line breaks - paste just the key.');
  const next = { ...load() };
  if (clean) next[name] = clean;
  else delete next[name];
  persist(next);
  cache = next;
}

export function secretsStatus(): Record<SecretName, boolean> {
  return Object.fromEntries(SECRET_NAMES.map((n) => [n, hasSecret(n)])) as Record<SecretName, boolean>;
}

function parseEnv(raw: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    out[trimmed.slice(0, eq).trim()] = value;
  }
  return out;
}

/**
 * One-time import of keys the old build kept in .env files, so nothing the
 * operator already pasted is lost. The .env files themselves are left alone.
 */
export function importLegacyEnv(extraDirs: string[] = []): SecretName[] {
  const candidates = [
    path.join(process.cwd(), '.env'),
    path.join(app.getAppPath(), '.env'),
    path.join(path.dirname(app.getPath('exe')), '.env'),
    path.join(app.getPath('userData'), '.env'),
    ...extraDirs.map((d) => path.join(d, '.env')),
  ];
  const current = { ...load() };
  const imported: SecretName[] = [];
  for (const file of [...new Set(candidates)]) {
    try {
      if (!fs.existsSync(file)) continue;
      const parsed = parseEnv(fs.readFileSync(file, 'utf8'));
      for (const name of SECRET_NAMES) {
        if (!current[name] && parsed[name]) {
          current[name] = parsed[name];
          imported.push(name);
        }
      }
    } catch {
      /* unreadable legacy file - skip it */
    }
  }
  if (imported.length) {
    persist(current);
    cache = current;
  }
  return imported;
}
