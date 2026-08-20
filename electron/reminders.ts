import { app } from 'electron';
import { randomUUID } from 'node:crypto';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import path from 'node:path';
import { showNotification } from './notifications';

/**
 * OS-native scheduled reminders.
 *
 * Windows: registers a real Task Scheduler entry via `schtasks` that fires
 * even if Atlas isn't running, by relaunching Atlas's own executable with a
 * `--reminder-fire=<id>` flag at the scheduled time. Registration only -
 * whoever wires this in must check `process.argv` at app startup (in
 * main.ts) for `--reminder-fire=<id>`, and if present, show the window and
 * speak/notify the reminder text (looking the reminder up via
 * listReminders()). That's this file's contract with main.ts; the "what
 * happens when it fires" logic itself lives there, not here.
 *
 * macOS/Linux: no real OS-level scheduler is implemented here (a proper
 * LaunchAgent/systemd unit is future work). Instead this falls back to a
 * plain in-process `setTimeout`, keyed by reminder id, that calls
 * `showNotification` directly when it fires. This ONLY works while the
 * Atlas process is alive - if the app is closed before the reminder time,
 * it silently will not fire, unlike the Windows Task Scheduler path which
 * survives Atlas not running at all.
 */

const run = promisify(exec);

export interface Reminder {
  id: string;
  text: string;
  whenISO: string;
  createdAt: number;
}

const FILE_NAME = 'reminders.json';
const UNSAFE_CHARS = /[&|;`\r\n"<>^]/;

function getFilePath(): string {
  return path.join(app.getPath('userData'), FILE_NAME);
}

function readAll(): Reminder[] {
  try {
    const raw = fs.readFileSync(getFilePath(), 'utf-8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    // Missing file, first run, or corrupt JSON - treat as empty.
    return [];
  }
}

function writeAll(reminders: Reminder[]): void {
  // Plain sync write, no atomic temp-file dance: this is a small,
  // low-stakes file (a personal reminders list), not something that needs
  // crash-safe durability guarantees.
  fs.writeFileSync(getFilePath(), JSON.stringify(reminders, null, 2));
}

function taskName(id: string): string {
  return `Atlas-Reminder-${id}`;
}

// In-process fallback timers for macOS/Linux, keyed by reminder id. Lost on
// app restart - see file header comment.
const fallbackTimers = new Map<string, ReturnType<typeof setTimeout>>();

function scheduleFallbackTimer(reminder: Reminder): void {
  const delayMs = new Date(reminder.whenISO).getTime() - Date.now();
  if (delayMs <= 0) return; // Already past due; nothing to schedule.
  const timer = setTimeout(() => {
    showNotification('Atlas Reminder', reminder.text);
    fallbackTimers.delete(reminder.id);
  }, delayMs);
  fallbackTimers.set(reminder.id, timer);
}

export function listReminders(): Reminder[] {
  try {
    return readAll();
  } catch {
    return [];
  }
}

export async function scheduleReminder(
  text: string,
  whenISO: string
): Promise<{ ok: boolean; reminder?: Reminder; error?: string }> {
  try {
    const cleanText = text.trim();
    if (!cleanText) return { ok: false, error: 'No reminder text given.' };

    const when = new Date(whenISO);
    if (Number.isNaN(when.getTime())) {
      return { ok: false, error: `Invalid whenISO: ${whenISO}` };
    }

    const reminder: Reminder = {
      id: randomUUID(),
      text: cleanText,
      whenISO: when.toISOString(),
      createdAt: Date.now(),
    };

    if (process.platform === 'win32') {
      const exePath = process.execPath;
      if (UNSAFE_CHARS.test(exePath)) {
        return { ok: false, error: 'Unsafe characters in executable path.' };
      }

      // Pad to schtasks' expected HH:mm / MM/DD/YYYY formats.
      const pad = (n: number) => String(n).padStart(2, '0');
      const st = `${pad(when.getHours())}:${pad(when.getMinutes())}`;
      const sd = `${pad(when.getMonth() + 1)}/${pad(when.getDate())}/${when.getFullYear()}`;

      // The scheduled task's action is a tiny powershell one-liner that just
      // re-invokes Atlas's own executable with a special flag. Actually
      // relaunching the full Electron app is heavy, but it's the pragmatic
      // way to get a real wake-up signal to Atlas even when it isn't
      // running. main.ts's startup code is responsible for noticing
      // `--reminder-fire=<id>` in process.argv and acting on it.
      const trigger = `powershell -WindowStyle Hidden -Command "& '${exePath}' --reminder-fire=${reminder.id}"`;

      const args = [
        '/create',
        '/tn', taskName(reminder.id),
        '/tr', trigger,
        '/sc', 'once',
        '/st', st,
        '/sd', sd,
        '/f',
      ];

      await run(`schtasks ${args.map((a) => (a.includes(' ') ? `"${a}"` : a)).join(' ')}`);
    } else if (process.platform === 'darwin' || process.platform === 'linux') {
      // No real LaunchAgent/systemd unit yet (future work) - fall back to an
      // in-process timer that only fires while Atlas is running.
      scheduleFallbackTimer(reminder);
    } else {
      return { ok: false, error: `Unsupported platform: ${process.platform}` };
    }

    const reminders = readAll();
    reminders.push(reminder);
    writeAll(reminders);

    return { ok: true, reminder };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function cancelReminder(id: string): Promise<{ ok: boolean; error?: string }> {
  try {
    if (process.platform === 'win32') {
      try {
        await run(`schtasks /delete /tn "${taskName(id)}" /f`);
      } catch {
        // The underlying task may already be gone (e.g. it already fired
        // and Task Scheduler cleaned it up, or it was deleted manually).
        // A cancelled reminder should still disappear from Atlas's own
        // list regardless, so this is intentionally swallowed.
      }
    } else if (process.platform === 'darwin' || process.platform === 'linux') {
      const timer = fallbackTimers.get(id);
      if (timer) {
        clearTimeout(timer);
        fallbackTimers.delete(id);
      }
    }

    const reminders = readAll().filter((r) => r.id !== id);
    writeAll(reminders);

    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
