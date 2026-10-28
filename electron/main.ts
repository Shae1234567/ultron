import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { app, BrowserWindow, Notification, powerMonitor, screen, shell } from 'electron';
import * as ollama from './ollama';
import { registerIpc } from './ipc';
import { setupTray } from './tray';
import { emit, setEventWindow } from './brain/events';
import { refreshGemini } from './brain/llm';
import { importLegacyEnv } from './secrets';
import * as tasks from './tasks';
import * as browserAgent from './browser';
import * as clipboardWatch from './clipboardWatch';
import * as d2l from './d2l';
import * as powerschool from './powerschool';
import { getSettings, readDoc, writeDoc } from './store';
import { warmUp } from './brain/providers/ollama';
import { ensureVault, writeNote } from './memory/vault';
import { syncIndex } from './memory/semantic';
import * as hindsight from './hindsight';
import { flushUsage } from './brainUse';
import { prepareVoice, stopVoice, voiceStatus } from './voice/kokoro';
import { startDashboard } from './dashboard';
import { startReflecting } from './reflect';
import { startLibrarian } from './memory/librarian';
import { startPcActivity } from './departments/health/pcActivity';
import { startBedtimeNudge } from './departments/health/nudge';
import { startSchoolRefresh } from './departments/school/refresh';
import { startHelios } from './helios/sweep';
import { startSundayReview } from './olympus';
import { startGameTracker } from './media/tracker';
import { showNotification } from './notifications';
import { startPhone } from './discordGateway';
import { handlePhone } from './phone';
import { isRunning as teamBusy, once } from './brain/team';
import { proveAllClouds, refreshAllClouds, startCloudWatch } from './clouds';
import { startVaultBackups } from './vaultBackup';
import { startBriefing } from './briefing';
import { redactSecrets } from './memory/redact';

process.env.DIST = path.join(__dirname, '../dist');
const VITE_DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL;
const APP_ID = 'com.shae.ultron';

app.setName('Ultron');
app.setAppUserModelId(APP_ID);
// Dev-only: run a test instance against a throwaway profile so test chats never land in the real vault.
if (!app.isPackaged && process.env.ULTRON_USER_DATA) app.setPath('userData', process.env.ULTRON_USER_DATA);
// Dev-only, for automated checks on a throwaway profile: run one agent tool directly (never in an installed build).
if (!app.isPackaged && process.env.ULTRON_USER_DATA && process.env.ULTRON_TOOL_HOOK === '1') {
  (globalThis as Record<string, unknown>).__ultronTool = async (name: string, args: Record<string, unknown>) => {
    const { ALL_TOOLS } = await import('./brain/tools/index');
    const t = ALL_TOOLS.find((x) => x.name === name);
    if (!t) return { error: `no tool called ${name}` };
    const tab = { id: 'hook', runId: 'hook', agent: t.owner, label: 'hook' };
    return t.run(args, { runId: 'hook', agent: t.owner, tab, signal: new AbortController().signal, resultBudget: 20_000, approve: async () => false, progress: () => {}, post: () => {} });
  };
}

/*
 * A background job that throws must never take Ultron down. 12 Oct 2026: the Discord connection hit a bundling
 * slip in `ws`, and Electron froze the whole app behind a "JavaScript error occurred" box until OK was clicked.
 * Now the error goes to logs/main-errors.log in his profile (secrets blanked) and everything else keeps running.
 */
function logMainError(kind: string, e: unknown): void {
  const text = redactSecrets(e instanceof Error ? e.stack ?? e.message : String(e));
  console.error(`[ultron] ${kind}:`, text);
  try {
    const dir = path.join(app.getPath('userData'), 'logs');
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, 'main-errors.log');
    if (fs.existsSync(file) && fs.statSync(file).size > 1_000_000) fs.renameSync(file, `${file}.old`);
    fs.appendFileSync(file, `${new Date().toISOString()} ${kind}: ${text}\n`);
  } catch { /* logging must never throw */ }
}
process.on('uncaughtException', (e) => logMainError('uncaught exception', e));
process.on('unhandledRejection', (e) => logMainError('unhandled rejection', e));

let win: BrowserWindow | null = null;
const startHidden = process.argv.includes('--hidden');

function iconPath(): string {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'icon.ico')
    : path.join(__dirname, '../build-assets/icon.ico');
}

function showWindow(): void {
  if (!win || win.isDestroyed()) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

interface WindowState { x: number; y: number; width: number; height: number; maximized: boolean }

/** The last window position, if it still fits on a connected screen (monitors change). */
function savedBounds(): WindowState | null {
  const s = readDoc<WindowState | null>('window-state.json', null);
  if (!s || !Number.isFinite(s.width) || !Number.isFinite(s.height)) return null;
  const area = screen.getDisplayMatching({ x: s.x, y: s.y, width: s.width, height: s.height }).workArea;
  const visible = s.x < area.x + area.width - 100 && s.y < area.y + area.height - 100 && s.x + s.width > area.x + 100 && s.y >= area.y - 10;
  return visible ? s : null;
}

function rememberBounds(w: BrowserWindow): void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const save = () => {
    if (w.isDestroyed() || w.isMinimized()) return;
    const b = w.getNormalBounds();
    writeDoc('window-state.json', { ...b, maximized: w.isMaximized() } satisfies WindowState);
  };
  const soon = () => { if (timer) clearTimeout(timer); timer = setTimeout(save, 600); };
  w.on('resize', soon);
  w.on('move', soon);
  w.on('maximize', save);
  w.on('unmaximize', save);
  w.on('close', save);
}

function createWindow(): void {
  // Fit the work area so the window is never partly offscreen (which also
  // makes capturePage return uninitialised pixels). Where the operator left it wins.
  const work = screen.getPrimaryDisplay().workAreaSize;
  const last = savedBounds();
  win = new BrowserWindow({
    width: last?.width ?? Math.min(1560, work.width - 40),
    height: last?.height ?? Math.min(960, work.height - 40),
    ...(last ? { x: last.x, y: last.y } : { center: true }),
    minWidth: 1120,
    minHeight: 720,
    show: false,
    frame: false,
    backgroundColor: '#060910',
    title: 'ULTRON',
    icon: iconPath(),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  setEventWindow(win);
  rememberBounds(win);
  if (last?.maximized) win.maximize();

  win.once('ready-to-show', () => { if (!startHidden) showWindow(); });
  setupTray(win, iconPath());

  // External links open in the real browser, never inside the HUD.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });

  // Never let the HUD itself navigate to a remote page - it would inherit the
  // whole preload API. Links go to the real browser instead.
  const ownOrigin = VITE_DEV_SERVER_URL ? new URL(VITE_DEV_SERVER_URL).origin : null;
  win.webContents.on('will-navigate', (e, url) => {
    const allowed = ownOrigin ? url.startsWith(ownOrigin) : url.startsWith('file://');
    if (allowed) return;
    e.preventDefault();
    if (/^https?:\/\//.test(url)) void shell.openExternal(url);
  });

  if (VITE_DEV_SERVER_URL) void win.loadURL(VITE_DEV_SERVER_URL);
  else void win.loadFile(path.join(process.env.DIST!, 'index.html'));

  const emitWindowState = () => {
    if (win && !win.isDestroyed()) win.webContents.send('win:state', { maximized: win.isMaximized() });
  };
  win.on('maximize', emitWindowState);
  win.on('unmaximize', emitWindowState);
  win.on('closed', () => { win = null; setEventWindow(null); });
}

/**
 * One-time carry-over from the Atlas build (userData %APPDATA%\Atlas): the
 * newer settings/news cache, and its memory file as the vault's seed profile.
 * The Atlas folder itself is left untouched.
 */
function migrateFromAtlas(): string | undefined {
  // A test profile must never pull in the real Atlas settings (they point at the operator's real vault).
  if (!app.isPackaged && process.env.ULTRON_USER_DATA) return undefined;
  const userData = app.getPath('userData');
  const marker = path.join(userData, '.migrated-from-atlas');
  const atlasDir = path.join(app.getPath('appData'), 'Atlas');
  let seed: string | undefined;
  try {
    fs.mkdirSync(userData, { recursive: true });
    if (!fs.existsSync(marker) && fs.existsSync(atlasDir)) {
      let complete = true;
      for (const f of ['settings.json', 'news-cache.json', 'news-quota.json']) {
        const src = path.join(atlasDir, f);
        const dst = path.join(userData, f);
        if (fs.existsSync(src) && (!fs.existsSync(dst) || fs.statSync(src).mtimeMs > fs.statSync(dst).mtimeMs)) {
          fs.copyFileSync(src, dst);
          // The first launch of a fresh install once "copied" without an error and without changing the file
          // (antivirus scanning the new exe is the likely cause) - only call it done once the copy is really there.
          if (fs.statSync(dst).size !== fs.statSync(src).size) complete = false;
        }
      }
      if (complete) fs.writeFileSync(marker, new Date().toISOString(), 'utf8');
      else console.warn('[ultron] Atlas migration incomplete - will retry next launch');
    }
    for (const candidate of [path.join(atlasDir, 'memory.md'), path.join(userData, 'memory.md')]) {
      if (fs.existsSync(candidate)) {
        seed = fs.readFileSync(candidate, 'utf8');
        break;
      }
    }
  } catch (e) {
    console.warn('[ultron] Atlas migration skipped:', e);
  }
  return seed;
}

/** Installed app: make sure a Start Menu shortcut carries our AppUserModelID, which Windows needs to show toasts. */
function ensureStartMenuShortcut(): void {
  if (!app.isPackaged || process.platform !== 'win32') return;
  try {
    const lnk = path.join(app.getPath('appData'), 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Ultron.lnk');
    if (fs.existsSync(lnk)) return;
    shell.writeShortcutLink(lnk, 'create', {
      target: process.execPath,
      appUserModelId: APP_ID,
      icon: iconPath(),
      iconIndex: 0,
      description: 'Ultron - personal AI command center',
    });
  } catch { /* shortcut is a nicety, not a requirement */ }
}

/** If Ollama is installed but not running, start it in the background (what the old launcher script did). */
async function ensureOllama(): Promise<void> {
  if (!(await ollama.status()).running) {
    const exe = path.join(process.env.LOCALAPPDATA ?? '', 'Programs', 'Ollama', 'ollama app.exe');
    if (!fs.existsSync(exe)) return;
    try {
      spawn(exe, [], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
    } catch { return; /* the brain setup panel explains how to start it by hand */ }
  }
  // Load the model now, while the HUD boots, so the first request doesn't wait for it.
  for (let i = 0; i < 20; i++) {
    const s = await ollama.status();
    if (s.running && s.modelInstalled) {
      const { host, model } = getSettings().ollama;
      await warmUp(host.replace(/\/$/, ''), model);
      return;
    }
    await new Promise((r) => setTimeout(r, 1500));
  }
}

let mirrorTimer: ReturnType<typeof setTimeout> | null = null;
function mirrorTasksToVault(): void {
  if (mirrorTimer) clearTimeout(mirrorTimer);
  mirrorTimer = setTimeout(() => {
    try { writeNote('Tasks/Tasks.md', tasks.tasksMarkdown()); } catch { /* vault unavailable */ }
  }, 1500);
}

function startTaskScheduler(): void {
  tasks.startScheduler({
    onChange: (all) => {
      emit('tasks:changed', all);
      mirrorTasksToVault();
    },
    onFire: (task, missed) => {
      if (Notification.isSupported()) {
        const n = new Notification({
          title: missed ? 'Ultron - missed reminder' : 'Ultron - reminder',
          body: tasks.describeTask(task),
          icon: iconPath(),
        });
        n.on('click', () => {
          showWindow();
          emit('ui:focus', { tab: 'tasks' });
        });
        n.show();
      }
      emit('tasks:reminder', { task, missed });
    },
  });
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  // Ultron is already running (probably in the tray) - that instance shows itself.
  app.quit();
} else {
  app.on('second-instance', () => showWindow());

  app.whenReady().then(() => {
    const seed = migrateFromAtlas();
    const imported = importLegacyEnv();
    if (imported.length) console.log('[ultron] imported keys from .env:', imported.join(', '));
    try { ensureVault(seed); } catch (e) { console.warn('[ultron] vault unavailable:', e); }

    registerIpc(() => win);
    createWindow();
    startTaskScheduler();
    startDashboard();
    startReflecting();
    startLibrarian(teamBusy);
    // Health's sleep pre-fill: when the PC is in use, nothing more (Settings -> trackers).
    startPcActivity(() => powerMonitor.getSystemIdleTime());
    startBedtimeNudge({ idleSeconds: () => powerMonitor.getSystemIdleTime(), notify: showNotification });
    // School's copy of D2L (what's due, grades, quiz windows): every two hours while idle.
    startSchoolRefresh(teamBusy);
    // Ultron's voice: the first time, download it in the background (about 330 MB, once) so it's
    // ready by the time he talks to it. Once downloaded it only loads when something is said.
    setTimeout(() => {
      if (getSettings().voice.engine === 'ultron' && !voiceStatus().downloaded) prepareVoice();
    }, 20_000);
    // School sign-ins: every cookie D2L or PowerSchool sets is saved at once, so a crash or shutdown can't lose it.
    // Dev-only: a test can shorten the 8-minute keep-alive to seconds.
    const aliveMs = !app.isPackaged ? Number(process.env.ULTRON_ALIVE_MS) || undefined : undefined;
    d2l.startKeeping(aliveMs);
    powerschool.startKeeping(aliveMs);
    // Timers stop while the PC sleeps - check both as soon as it's back, before a timeout can land.
    const schoolCheckNow = () => { d2l.aliveNow(); powerschool.aliveNow(); };
    powerMonitor.on('resume', schoolCheckNow);
    powerMonitor.on('unlock-screen', schoolCheckNow);
    // Helios: hourly free feed pulls and three sweeps a day while idle - AI only on a cloud brain, 40 calls a day at most.
    startHelios({ busy: teamBusy, write: (system, user) => once({ system, user, tier: 'fast', temperature: 0.4, noLocal: true }) });
    // The Sunday review: each department's number and next week's top three, from their data (no AI).
    startSundayReview(teamBusy);
    // Media's game tracker: which installed games are running, every two minutes (Settings - trackers).
    startGameTracker();
    // Log from his phone: DMs to his own bot, from his linked account only.
    startPhone(handlePhone);
    startVaultBackups();
    startBriefing();
    // Re-checks a used-up or stumbled service every half hour, so the operator never
    // has to press anything to get a brain back.
    startCloudWatch();
    ensureStartMenuShortcut();
    void ensureOllama();
    void refreshGemini(true).catch(() => {});
    void refreshAllClouds().then(() => proveAllClouds()).catch(() => {});
    // Give Ollama a moment after login before embedding anything that changed in the vault.
    setTimeout(() => { void syncIndex().catch(() => {}); }, 8000);

    clipboardWatch.startClipboardWatch((text) => {
      if (win && !win.isDestroyed()) win.webContents.send('clipboard:newText', text);
    });

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
      else showWindow();
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });

  // Before quitting: keep the D2L session (its cookies would otherwise die with the app), then shut the
  // agents' browser down - it's a real OS process and must never outlive Ultron.
  let finalSaveDone = false;
  // Hindsight's memory server starts in the background with Ultron and goes when Ultron does.
  setTimeout(() => { void hindsight.ensureRunning(); }, 15_000);
  app.on('will-quit', () => { hindsight.stop(); flushUsage(); stopVoice(false); });
  app.on('before-quit', (e) => {
    tasks.stopScheduler();
    if (finalSaveDone) return;
    e.preventDefault();
    const giveUp = new Promise((r) => setTimeout(r, 4000));
    void Promise.race([Promise.all([d2l.keepSignedIn().catch(() => 0), powerschool.keepSignedIn().catch(() => {}), browserAgent.closeBrowser()]), giveUp]).finally(() => {
      finalSaveDone = true;
      app.quit();
    });
  });
}

/* ── Dev utility ────────────────────────────────────────────────────────
   ULTRON_CAPTURE=<file.png> launches the app, lets it settle, writes a
   screenshot of its own window and exits. Hard-gated to unpackaged builds:
   it runs arbitrary JS from an env var. Optional: ULTRON_CAPTURE_DELAY (ms),
   ULTRON_CAPTURE_JS (snippet run first).                                   */
if (!app.isPackaged && process.env.ULTRON_CAPTURE) {
  const target = process.env.ULTRON_CAPTURE;
  const rawDelay = Number(process.env.ULTRON_CAPTURE_DELAY);
  const delay = Number.isFinite(rawDelay) && rawDelay > 0 ? rawDelay : 4200;
  app.whenReady().then(() => {
    setTimeout(async () => {
      try {
        if (!win || win.isDestroyed()) throw new Error('window gone');
        const js = process.env.ULTRON_CAPTURE_JS;
        if (js) {
          const jsResult = await win.webContents.executeJavaScript(js);
          if (jsResult !== undefined) console.log('[ultron] js result:', jsResult);
          await new Promise((r) => setTimeout(r, 1500));
        }
        const image = await win.webContents.capturePage();
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, image.toPNG());
        console.log(`[ultron] captured -> ${target}`);
      } catch (e) {
        console.error('[ultron] capture failed:', e);
      } finally {
        app.exit(0);
      }
    }, delay);
  });
}
