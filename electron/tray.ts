import { Tray, Menu, app } from 'electron';
import type { BrowserWindow } from 'electron';

/**
 * System tray + background-mode + auto-launch.
 *
 * This is what makes "listen even when the window is closed" possible: the
 * close ('X') button no longer quits the process, it just hides the window.
 * The Electron process (and the renderer inside it, including the wake-word
 * listener in src/services/wakeWord.ts) keeps running in the tray, ready to
 * be summoned back with a show()/focus() the moment the wake word fires.
 * Only the tray's own "Quit" item, or a real app-level before-quit (OS
 * shutdown, updater, etc.), actually ends the process.
 */

let tray: Tray | null = null;

export function setupTray(win: BrowserWindow, iconPath: string): void {
  // A real quit needs to bypass the close-guard below - before-quit fires
  // first and flips this flag so the subsequent 'close' event on win is let
  // through instead of trapped into a hide().
  app.on('before-quit', () => {
    (win as any).__forceQuit = true;
  });

  win.on('close', (e) => {
    if (!(win as any).__forceQuit) {
      e.preventDefault();
      win.hide();
    }
  });

  tray = new Tray(iconPath);
  tray.setToolTip('Atlas');

  const buildMenu = () =>
    Menu.buildFromTemplate([
      {
        label: 'Show Atlas',
        click: () => { win.show(); win.focus(); },
      },
      { type: 'separator' },
      {
        label: 'Start with Windows',
        type: 'checkbox',
        checked: isAutoLaunchEnabled(),
        click: (item) => setAutoLaunch(item.checked),
      },
      { type: 'separator' },
      {
        label: 'Quit',
        click: () => app.exit(0),
      },
    ]);

  tray.setContextMenu(buildMenu());

  // Double-click is the expected "bring it back" gesture on Windows.
  tray.on('double-click', () => { win.show(); win.focus(); });
}

export function isAutoLaunchEnabled(): boolean {
  return app.getLoginItemSettings().openAtLogin;
}

export function setAutoLaunch(enabled: boolean): void {
  app.setLoginItemSettings({ openAtLogin: enabled });
}
