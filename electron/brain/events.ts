import type { BrowserWindow } from 'electron';

let window: BrowserWindow | null = null;

export function setEventWindow(win: BrowserWindow | null): void {
  window = win;
}

type Listener = (channel: string, payload: unknown) => void;
const listeners = new Set<Listener>();

/** Hears every event too (the phone handler waits for its run's answer this way). Returns the off switch. */
export function onEvent(fn: Listener): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

export function emit(channel: string, payload: unknown): void {
  for (const fn of listeners) {
    try { fn(channel, payload); } catch { /* a listener never breaks delivery */ }
  }
  try {
    if (window && !window.isDestroyed() && !window.webContents.isDestroyed()) {
      window.webContents.send(channel, payload);
    }
  } catch {
    /* renderer reloading - nothing to deliver to */
  }
}

/** Brings the HUD forward (e.g. an approval is waiting and the window is in the tray). */
export function surfaceWindow(): void {
  if (!window || window.isDestroyed()) return;
  if (!window.isVisible()) window.show();
  if (window.isMinimized()) window.restore();
  window.focus();
}

export function windowFocused(): boolean {
  return Boolean(window && !window.isDestroyed() && window.isVisible() && window.isFocused());
}
