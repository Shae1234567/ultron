import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';

/**
 * Atlas's cross-session bridge - lets one session's tail hand a short recap
 * to the next morning's greeting, then gets out of the way.
 *
 * Intended flow for whoever wires this in:
 *
 *   1. When a session ends (window close, app quit, or any other real
 *      session boundary), generate a short 1-2 sentence summary of what was
 *      discussed via the brain, and call `saveSessionSummary(text)` with the
 *      final string. Generating that summary text is NOT this file's job -
 *      this file only persists and retrieves whatever string it is handed.
 *   2. Once, at the START of the next `initProactiveGreeting()` call, call
 *      `consumeSessionSummary()`. If it returns non-null, fold `.text` into
 *      the greeting's system-prompt instructions (e.g. "mention yesterday's
 *      session briefly, naturally"). Do not call it again until the next
 *      real session boundary - it deletes on read specifically so the recap
 *      is used exactly once and never repeats.
 *   3. `getPendingSessionSummary()` is the read-only sibling, for a caller
 *      that wants to peek at what would be consumed without actually
 *      consuming it (e.g. to decide whether to bother building the recap
 *      instructions at all).
 *
 * Both getters silently drop anything older than STALE_MS - if the operator
 * hasn't opened Atlas in over a day, "yesterday" no longer means anything
 * useful, and a stale recap would be confusing rather than helpful.
 */

const FILE_NAME = 'session-summary.json';
const STALE_MS = 36 * 60 * 60 * 1000; // 36 hours

export interface SessionSummary {
  text: string;
  savedAt: number;
}

function filePath(): string {
  return path.join(app.getPath('userData'), FILE_NAME);
}

function readRaw(): SessionSummary | null {
  const p = filePath();
  try {
    if (!fs.existsSync(p)) return null;
    const parsed = JSON.parse(fs.readFileSync(p, 'utf8')) as SessionSummary;
    if (!parsed || typeof parsed.text !== 'string' || typeof parsed.savedAt !== 'number') return null;
    return parsed;
  } catch {
    return null;
  }
}

function deleteFile(): void {
  const p = filePath();
  try {
    fs.unlinkSync(p);
  } catch {
    // Missing (or otherwise unremovable) file is fine - nothing to clean up.
  }
}

function isStale(summary: SessionSummary): boolean {
  return Date.now() - summary.savedAt > STALE_MS;
}

export function getPendingSessionSummary(): SessionSummary | null {
  const summary = readRaw();
  if (!summary) return null;
  if (isStale(summary)) return null;
  return summary;
}

export function saveSessionSummary(text: string): void {
  const trimmed = text.trim();
  if (!trimmed) return;
  const p = filePath();
  const summary: SessionSummary = { text: trimmed, savedAt: Date.now() };
  try {
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, JSON.stringify(summary), 'utf8');
  } catch {
    // Best-effort - a lost recap just means tomorrow's greeting stays plain.
  }
}

export function consumeSessionSummary(): SessionSummary | null {
  const summary = readRaw();
  deleteFile();
  if (!summary) return null;
  if (isStale(summary)) return null;
  return summary;
}
