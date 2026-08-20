# Proposal: Native OS Notifications for Tray-Hidden State

## Problem
When Atlas is backgrounded to the tray (`electron/tray.ts`), proactive speech
(`src/services/proactive.ts`) and wake-word triggers (`src/services/wakeWord.ts`)
fire with zero visual cue. The operator only notices if they happen to be
listening for audio.

## Module: `electron/notifications.ts`
Main process only, no new dependency:

```ts
import { Notification } from 'electron';

export function showNotification(title: string, body: string): void {
  if (!Notification.isSupported()) return;
  new Notification({ title, body, silent: true }).show();
}
```

`silent: true` because Atlas already speaks via TTS — a system notification
sound on top would double up. One function is enough; callers just build
their own title/body strings.

## Trigger points (4)
1. **`proactive.ts` `sayProactively()`** (line ~53) — after `pushEntry`, if
   `!win.isFocused()` (main process check via IPC, see below), fire
   `showNotification('Atlas', trimmed)`. Covers both `initProactiveGreeting()`
   and `greetNow()` since both call `sayProactively`.
2. **`proactive.ts` `attemptCheckIn()`** (line ~225) — same call site as
   above; already routed through `sayProactively`, so triggers automatically
   once #1 is wired.
3. **`wakeWord.ts` `runLoop()`** (line ~74) — `if (WAKE_RE.test(text)) onWake()`.
   Fire `showNotification('Atlas', 'Wake word detected')` here specifically
   because the window may still be hidden at this exact instant (before
   `onWake`'s window-restore logic runs), so it's the earliest confirmable cue.
4. **`electron/tray.ts`** — when the tray icon itself is clicked while the
   window is hidden and restoring takes >0 visible delay, optionally skip;
   not needed since the click is already a visible action. (Kept at 3 real
   triggers; a 4th candidate — `main.ts`'s `win.on('hide')` — is not needed
   since hiding isn't the missed-event case.)

## Renderer -> main IPC
New channel `notify:show`, following the existing never-throw `{ ok, ... }`
pattern (see `electron/preload.ts`'s `tray`/`system` blocks):

**preload.ts** (add to `api`):
```ts
notify: {
  show: (title: string, body: string) => ipcRenderer.invoke('notify:show', title, body),
},
```

**main.ts**:
```ts
ipcMain.handle('notify:show', (_e, title: string, body: string) => {
  try {
    showNotification(title, body);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
});
```

Since triggers #1 and #2 live in renderer-side `proactive.ts`, they'd call
`window.ultron.notify.show('Atlas', trimmed)` inside `sayProactively()`,
gated by a main-process visibility check (add `win.isFocused()` /
`win.isVisible()` to the `notify:show` handler itself, so the renderer
doesn't need its own visibility state — the handler just no-ops the OS
notification if the window is already focused and visible).
