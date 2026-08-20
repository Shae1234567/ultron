import { app, BrowserWindow, ipcMain, screen, shell } from 'electron';
import path from 'node:path';
import { env, loadEnv, setEnvKey, writableEnvPath } from './env';
import { getSettings, saveSettings } from './store';
import * as ollama from './ollama';
import * as news from './news';
import * as files from './files';
import * as memory from './memory';
import * as research from './research';
import * as github from './github';
import * as notion from './notion';
import * as discord from './discord';
import * as obsidian from './obsidian';
import * as gemini from './gemini';
import * as browserAgent from './browser';
import * as googleAuth from './googleAuth';
import * as googleGmail from './googleGmail';
import * as googleCalendarReal from './googleCalendarReal';
import * as googleDrive from './googleDrive';
import * as systemControl from './systemControl';
import * as notifications from './notifications';
import * as backup from './backup';
import * as vision from './vision';
import * as sessionMemory from './sessionMemory';
import * as backgroundMonitor from './backgroundMonitor';
import * as reminders from './reminders';
import * as flightFinder from './flightFinder';
import * as gameUpdater from './gameUpdater';
import * as remoteServer from './remoteServer';
import * as clipboardWatch from './clipboardWatch';
import * as telegram from './telegram';
import { getHardwareStats } from './hardwareStats';
import * as calculator from './calculator';
import * as wolframAlpha from './wolframAlpha';
import * as quickNotes from './quickNotes';
import * as joke from './joke';
import * as ipInfo from './ipInfo';
import * as batteryInfo from './batteryInfo';
import * as windowSwitch from './windowSwitch';
import * as screenshot from './screenshot';
import * as fileVisibility from './fileVisibility';
import * as geocode from './geocode';
import { setupTray, isAutoLaunchEnabled, setAutoLaunch } from './tray';

process.env.DIST = path.join(__dirname, '../dist');
const VITE_DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL;

let win: BrowserWindow | null = null;

function createWindow(): void {
  // Fit the work area so the window is never partly offscreen (which also
  // makes capturePage return uninitialised pixels).
  const work = screen.getPrimaryDisplay().workAreaSize;
  const width = Math.min(1560, work.width - 40);
  const height = Math.min(960, work.height - 40);

  win = new BrowserWindow({
    width,
    height,
    center: true,
    minWidth: 1120,
    minHeight: 720,
    show: false,
    frame: false,
    backgroundColor: '#060910',
    title: 'ATLAS',
    icon: path.join(__dirname, '../build-assets/icon.ico'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      // Powers BrowserPanel.tsx's <webview> - the "side tab" real browser.
      // Each <webview> is its own separate renderer process/origin, so it does
      // not inherit this window's preload API or Node access.
      webviewTag: true,
      // preload.ts only imports 'electron' (contextBridge, ipcRenderer), both
      // available under the sandbox - this is the real containment boundary
      // if a renderer-side dependency is ever compromised, and there was no
      // actual reason for it to be off.
      sandbox: true,
    },
  });

  win.once('ready-to-show', () => win?.show());
  setupTray(win, path.join(__dirname, '../build-assets/icon.ico'));

  // External links open in the real browser, never inside the HUD.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });

  // setWindowOpenHandler above only covers window.open/target=_blank - it
  // does nothing to stop the existing frame from being navigated away. If
  // any rendered content (a news headline, model output) ever contained a
  // link the user clicked, or a compromised dependency tried it, the page
  // would navigate to a remote origin that inherits this window's full
  // preload API (files:search, files:reveal, settings:save, ...). Block any
  // navigation that is not to our own app content.
  const ownOrigin = VITE_DEV_SERVER_URL ? new URL(VITE_DEV_SERVER_URL).origin : null;
  const blockForeignNavigation = (e: Electron.Event, url: string) => {
    const allowed = ownOrigin ? url.startsWith(ownOrigin) : url.startsWith('file://');
    if (allowed) return;
    e.preventDefault();
    if (/^https?:\/\//.test(url)) shell.openExternal(url);
  };
  win.webContents.on('will-navigate', blockForeignNavigation);

  if (VITE_DEV_SERVER_URL) {
    win.loadURL(VITE_DEV_SERVER_URL);
  } else {
    win.loadFile(path.join(process.env.DIST!, 'index.html'));
  }

  const emitWindowState = () => {
    if (!win || win.isDestroyed()) return;
    win.webContents.send('win:state', { maximized: win.isMaximized() });
  };
  win.on('maximize', emitWindowState);
  win.on('unmaximize', emitWindowState);
  win.on('closed', () => { win = null; });
}

// Tried enabling cross-origin isolation (COOP/COEP) here to unlock
// multi-threaded WASM for Whisper - real 2-4x speedup on paper. Verified
// live before keeping it, per the project's own rule, and the verification
// caught a real regression: under the packaged app's file:// origin, the
// Whisper Worker itself failed to construct under COEP ("Whisper worker
// crashed"), immediately breaking speech-to-text entirely - not a
// hypothetical risk, an observed one. A broken core feature is worse than a
// slower one, so this stays off. Revisit if bundling the worker with real
// Cross-Origin-Resource-Policy headers (e.g. serving over a custom
// same-origin protocol handler instead of file://) becomes worth the effort.
app.whenReady().then(() => {
  loadEnv(true);
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// Scout's headless Chromium instance is a real OS process - leaving it running
// after the HUD closes would silently leak a browser in the background.
app.on('before-quit', () => { void browserAgent.closeBrowser(); remoteServer.stopRemoteServer(); });

/* ── IPC: window chrome ─────────────────────────────────────────────── */

ipcMain.handle('win:minimize', () => win?.minimize());
ipcMain.handle('win:maximize', () => {
  if (!win) return false;
  if (win.isMaximized()) win.unmaximize();
  else win.maximize();
  return win.isMaximized();
});
ipcMain.handle('win:close', () => win?.close());
ipcMain.handle('win:show', () => { win?.show(); win?.focus(); });

/* ── IPC: notifications (native OS toast for background/proactive events) ── */

ipcMain.handle('notify:show', (_e, title: unknown, body: unknown) => {
  if (typeof title !== 'string' || typeof body !== 'string') return { ok: false };
  // No need to interrupt with a system toast if the operator is already
  // looking at the HUD - only fire when the window isn't focused.
  if (win && win.isFocused()) return { ok: true, skipped: true };
  notifications.showNotification(title, body);
  return { ok: true };
});

/* ── IPC: backup (settings + memory export/import, never API keys) ────── */

ipcMain.handle('backup:export', () => backup.exportBackup(win));
ipcMain.handle('backup:import', () => backup.importBackup(win));

/* ── IPC: vision (real screen capture, piped to Gemini for description) ── */

ipcMain.handle('vision:captureScreen', () => vision.captureScreen());
ipcMain.handle('vision:listScreenSources', () => vision.listScreenSources());

/* ── IPC: session memory (yesterday's recap, consumed once) ───────────── */

ipcMain.handle('sessionMemory:getPending', () => sessionMemory.getPendingSessionSummary());
ipcMain.handle('sessionMemory:save', (_e, text: unknown) =>
  typeof text === 'string' ? sessionMemory.saveSessionSummary(text) : undefined);
ipcMain.handle('sessionMemory:consume', () => sessionMemory.consumeSessionSummary());

/* ── IPC: background topic monitoring (opt-in, never crypto/financial) ── */

ipcMain.handle('monitor:list', () => backgroundMonitor.listMonitoredTopics());
ipcMain.handle('monitor:add', (_e, query: unknown) =>
  typeof query === 'string' ? backgroundMonitor.addMonitoredTopic(query) : { ok: false, error: 'Bad query' });
ipcMain.handle('monitor:remove', (_e, id: unknown) => {
  if (typeof id === 'string') backgroundMonitor.removeMonitoredTopic(id);
});
ipcMain.handle('monitor:checkAll', () => backgroundMonitor.checkAllTopics());

/* ── IPC: smart reminders ──────────────────────────────────────────────── */

ipcMain.handle('reminders:list', () => reminders.listReminders());
ipcMain.handle('reminders:schedule', (_e, text: unknown, whenISO: unknown) =>
  typeof text === 'string' && typeof whenISO === 'string'
    ? reminders.scheduleReminder(text, whenISO)
    : { ok: false, error: 'Bad payload' });
ipcMain.handle('reminders:cancel', (_e, id: unknown) =>
  typeof id === 'string' ? reminders.cancelReminder(id) : { ok: false, error: 'Bad id' });

/* ── IPC: flight finder / game updater ─────────────────────────────────── */

ipcMain.handle('flights:find', (_e, origin: unknown, destination: unknown, date: unknown) =>
  typeof origin === 'string' && typeof destination === 'string' && typeof date === 'string'
    ? flightFinder.findFlights(origin, destination, date)
    : { ok: false, results: [], error: 'Bad payload' });

ipcMain.handle('games:detect', () => gameUpdater.detectGameLaunchers());
ipcMain.handle('games:updateSteam', () => gameUpdater.triggerSteamUpdateCheck());
ipcMain.handle('games:updateEpic', () => gameUpdater.triggerEpicUpdateCheck());

/* ── IPC: remote phone dashboard (LAN-only, opt-in, QR pairing) ────────── */

ipcMain.handle('remote:start', async () => remoteServer.startRemoteServer((cmd) => {
  // Commands from the paired phone are treated exactly like a typed message
  // from the operator - never auto-executed as a privileged action.
  if (cmd.type === 'message' && win && !win.isDestroyed()) {
    win.webContents.send('remote:command', cmd);
  }
}));
ipcMain.handle('remote:stop', () => remoteServer.stopRemoteServer());
ipcMain.handle('remote:status', () => remoteServer.getRemoteServerStatus());

/* ── IPC: Telegram (real Bot API, opt-in) ───────────────────────────────── */

ipcMain.handle('telegram:hasToken', () => telegram.hasToken());
ipcMain.handle('telegram:verify', () => telegram.verify());
ipcMain.handle('telegram:send', (_e, chatId: unknown, text: unknown) =>
  typeof chatId === 'string' && typeof text === 'string'
    ? telegram.sendMessage(chatId, text)
    : { ok: false, error: 'Bad payload' });
ipcMain.handle('telegram:recentChats', () => telegram.getRecentChats());

ipcMain.handle('system:hardwareStats', () => getHardwareStats());

/* ── IPC: calculator / WolframAlpha ─────────────────────────────────────── */

ipcMain.handle('calc:evaluate', (_e, expr: unknown) =>
  typeof expr === 'string' ? calculator.evaluate(expr) : { ok: false, error: 'Bad expression' });
ipcMain.handle('wolfram:hasKey', () => wolframAlpha.hasKey());
ipcMain.handle('wolfram:ask', (_e, query: unknown) =>
  typeof query === 'string' ? wolframAlpha.askWolframAlpha(query) : { ok: false, error: 'Bad query' });

/* ── IPC: quick notes / joke ─────────────────────────────────────────────── */

ipcMain.handle('notes:add', (_e, text: unknown) =>
  typeof text === 'string' ? quickNotes.addNote(text) : undefined);
ipcMain.handle('notes:list', () => quickNotes.listNotes());
ipcMain.handle('notes:delete', (_e, id: unknown) => {
  if (typeof id === 'string') quickNotes.deleteNote(id);
});
ipcMain.handle('joke:random', () => joke.getRandomJoke());

/* ── IPC: IP / battery ───────────────────────────────────────────────────── */

ipcMain.handle('ip:info', () => ipInfo.getIpInfo());
ipcMain.handle('battery:info', () => batteryInfo.getBatteryInfo());

/* ── IPC: window switching ──────────────────────────────────────────────── */

ipcMain.handle('windows:list', () => windowSwitch.listOpenWindows());
ipcMain.handle('windows:switchTo', (_e, titleContains: unknown) =>
  typeof titleContains === 'string' ? windowSwitch.switchToWindow(titleContains) : { ok: false, error: 'Bad title' });
ipcMain.handle('windows:cycle', () => windowSwitch.cycleWindow());

/* ── IPC: screenshot ─────────────────────────────────────────────────────── */

ipcMain.handle('screenshot:take', (_e, filename: unknown) =>
  screenshot.takeScreenshotAndSave(typeof filename === 'string' ? filename : undefined));

/* ── IPC: file visibility (same folder containment as files.ts) ────────── */

ipcMain.handle('fileVisibility:hide', (_e, folderPath: unknown) =>
  typeof folderPath === 'string' ? fileVisibility.hideFolderContents(folderPath) : { ok: false, error: 'Bad folder' });
ipcMain.handle('fileVisibility:unhide', (_e, folderPath: unknown) =>
  typeof folderPath === 'string' ? fileVisibility.unhideFolderContents(folderPath) : { ok: false, error: 'Bad folder' });

/* ── IPC: geocoding / distance ───────────────────────────────────────────── */

ipcMain.handle('geo:place', (_e, query: unknown) =>
  typeof query === 'string' ? geocode.geocodePlace(query) : { ok: false, error: 'Bad query' });
ipcMain.handle('geo:distance', (_e, from: unknown, to: unknown) =>
  typeof from === 'string' && typeof to === 'string'
    ? geocode.distanceToPlace(from, to)
    : { ok: false, error: 'Bad payload' });

/* ── Clipboard Intelligence: watched from boot, opt-in via a Settings toggle
   handled entirely on the renderer side (it just ignores the events if the
   panel is disabled) - the watcher itself is cheap enough to always run. ── */
clipboardWatch.startClipboardWatch((text) => {
  if (win && !win.isDestroyed()) win.webContents.send('clipboard:newText', text);
});

/* ── IPC: brain (Ollama) ────────────────────────────────────────────── */

ipcMain.handle('ollama:status', () => ollama.status());

ipcMain.handle('ollama:chat', (event, payload: {
  requestId: string;
  messages: ollama.ChatMessage[];
  model?: string;
  temperature?: number;
}) => {
  // Fire and forget - tokens stream back over ollama:chunk / :done / :error
  void ollama.chatStream(event.sender, payload.requestId, payload.messages, {
    model: payload.model,
    temperature: payload.temperature,
  });
  return { started: true };
});

ipcMain.handle('ollama:cancel', (_e, requestId: string) => ollama.cancel(requestId));

ipcMain.handle('ollama:once', async (_e, payload: {
  messages: ollama.ChatMessage[];
  model?: string;
  temperature?: number;
  timeoutMs?: number;
  tools?: ollama.OllamaToolSpec[];
}) => {
  try {
    const { text, toolCalls } = await ollama.chatOnce(payload.messages, payload);
    return { ok: true as const, text, ...(toolCalls ? { toolCalls } : {}) };
  } catch (e) {
    return { ok: false as const, error: e instanceof Error ? e.message : String(e) };
  }
});

/* ── IPC: brain (Gemini - second, hosted brain) ───────────────────────── */

ipcMain.handle('gemini:status', () => gemini.status());

ipcMain.handle('gemini:chat', (event, payload: {
  requestId: string;
  messages: gemini.ChatMessage[];
  model?: string;
  temperature?: number;
}) => {
  void gemini.chatStream(event.sender, payload.requestId, payload.messages, {
    model: payload.model,
    temperature: payload.temperature,
  });
  return { started: true };
});

ipcMain.handle('gemini:cancel', (_e, requestId: string) => gemini.cancel(requestId));

// Live Voice (services/liveVoiceSession.ts) connects directly from the
// renderer to Google's Live API over its own WebSocket - unlike every other
// call in this app, there is no way to proxy that through the main process,
// so the renderer needs the raw key. This is the one deliberate exception to
// "secrets never leave the main process" in this codebase: acceptable for a
// personal local app using the operator's own key for their own use.
// Hardening note: Google's Live API supports short-lived ephemeral tokens
// for exactly this situation - minting one here instead of returning the
// long-lived key would be the next step for anything beyond personal use.
ipcMain.handle('gemini:getKeyForLiveSession', () => env('GEMINI_API_KEY'));

ipcMain.handle('gemini:once', async (_e, payload: {
  messages: gemini.ChatMessage[];
  model?: string;
  temperature?: number;
  timeoutMs?: number;
}) => {
  try {
    const text = await gemini.chatOnce(payload.messages, payload);
    return { ok: true as const, text };
  } catch (e) {
    return { ok: false as const, error: e instanceof Error ? e.message : String(e) };
  }
});

/* ── IPC: browser (Playwright - real autonomous web browsing) ─────────── */

ipcMain.handle('browser:search', (_e, query: unknown, limit?: number) =>
  typeof query === 'string' ? browserAgent.webSearch(query, limit) : { ok: false, results: [], error: 'Bad query' });
ipcMain.handle('browser:open', (_e, url: unknown) =>
  typeof url === 'string' ? browserAgent.openPage(url) : { ok: false, error: 'Bad url' });
ipcMain.handle('browser:click', (_e, selector: unknown) =>
  typeof selector === 'string' ? browserAgent.clickOnPage(selector) : { ok: false, error: 'Bad selector' });
ipcMain.handle('browser:type', (_e, selector: unknown, text: unknown, submit?: boolean) =>
  typeof selector === 'string' && typeof text === 'string'
    ? browserAgent.typeOnPage(selector, text, Boolean(submit))
    : { ok: false, error: 'Bad payload' });
ipcMain.handle('browser:youtubeSearch', (_e, query: unknown, limit?: number) =>
  typeof query === 'string' ? browserAgent.youtubeSearch(query, limit) : { ok: false, results: [], error: 'Bad query' });
ipcMain.handle('browser:screenshot', () => browserAgent.screenshotPage());
ipcMain.handle('browser:close', () => browserAgent.closeBrowser());

/* ── IPC: Google (Drive/Gmail/Calendar) - real OAuth, operator's own account ── */

ipcMain.handle('google:hasCredentials', () => googleAuth.hasCredentials());
ipcMain.handle('google:isConnected', () => googleAuth.isConnected());
ipcMain.handle('google:connect', (_e, scopes: unknown) =>
  Array.isArray(scopes) ? googleAuth.connect(scopes as string[]) : { ok: false, error: 'Bad scopes' });
ipcMain.handle('google:disconnect', () => googleAuth.disconnect());
ipcMain.handle('google:gmail:listUnread', (_e, limit?: number) => googleGmail.listUnread(limit));
ipcMain.handle('google:gmail:send', (_e, to: unknown, subject: unknown, body: unknown) =>
  typeof to === 'string' && typeof subject === 'string' && typeof body === 'string'
    ? googleGmail.sendMessage(to, subject, body)
    : { ok: false, error: 'Bad payload' });
ipcMain.handle('google:calendar:listUpcoming', (_e, limit?: number) => googleCalendarReal.listUpcoming(limit));
ipcMain.handle('google:calendar:createEvent', (_e, title: unknown, start: unknown, end: unknown, desc?: unknown) =>
  typeof title === 'string' && typeof start === 'string' && typeof end === 'string'
    ? googleCalendarReal.createEvent(title, start, end, typeof desc === 'string' ? desc : undefined)
    : { ok: false, error: 'Bad payload' });
ipcMain.handle('google:drive:listRecent', (_e, limit?: number) => googleDrive.listRecent(limit));
ipcMain.handle('google:drive:search', (_e, query: unknown, limit?: number) =>
  typeof query === 'string' ? googleDrive.searchFiles(query, limit) : { ok: false, error: 'Bad query' });

/* ── IPC: tray / auto-launch ────────────────────────────────────────── */

ipcMain.handle('tray:isAutoLaunchEnabled', () => isAutoLaunchEnabled());
ipcMain.handle('tray:setAutoLaunch', (_e, enabled: unknown) => setAutoLaunch(Boolean(enabled)));

/* ── IPC: system control - real OS integration on the operator's own machine ── */

ipcMain.handle('system:openApp', (_e, name: unknown) =>
  typeof name === 'string' ? systemControl.openApp(name) : { ok: false, error: 'Bad payload' });
ipcMain.handle('system:openGoogleService', (_e, service: unknown) =>
  typeof service === 'string' ? systemControl.openGoogleService(service) : { ok: false, error: 'Bad payload' });
ipcMain.handle('system:setVolume', (_e, direction: unknown) =>
  direction === 'up' || direction === 'down' || direction === 'mute'
    ? systemControl.setVolume(direction)
    : { ok: false, error: 'Bad direction' });
ipcMain.handle('system:lock', () => systemControl.lockComputer());
ipcMain.handle('system:sleep', () => systemControl.sleepComputer());
ipcMain.handle('system:openExplorer', (_e, path: unknown) =>
  systemControl.openFileExplorer(typeof path === 'string' ? path : undefined));
// Shutdown/restart are deliberately NOT exposed here without a dedicated,
// explicitly-confirmed channel - see the comments on those two functions in
// systemControl.ts. No IPC handler for them at all yet, by design.

/* ── IPC: news ──────────────────────────────────────────────────────── */

ipcMain.handle('news:fetch', (_e, manual: boolean) => news.fetchNews(Boolean(manual)));
ipcMain.handle('news:quota', () => news.quotaSnapshot());
ipcMain.handle('news:hasKey', () => news.hasApiKey());

/* ── IPC: settings + env ────────────────────────────────────────────── */

ipcMain.handle('settings:get', () => getSettings());
ipcMain.handle('settings:save', (_e, patch: unknown) => {
  if (!patch || typeof patch !== 'object') return getSettings();
  // `folders` is deliberately never settable through this channel - the
  // whole point of files.ts's design is that Atlas only ever indexes
  // folders added through the real OS picker (files:add). Accepting it here
  // would let any renderer-side bug or bad prompt output point the indexer
  // at an arbitrary path with no dialog in the way.
  const { folders: _ignoredFolders, ...rest } = patch as Record<string, unknown>;
  return saveSettings(rest);
});
ipcMain.handle('env:setKey', (_e, payload: unknown) => {
  if (
    !payload || typeof payload !== 'object' ||
    typeof (payload as { key?: unknown }).key !== 'string' ||
    typeof (payload as { value?: unknown }).value !== 'string'
  ) {
    return { ok: false, error: 'Bad payload' };
  }
  const { key, value } = payload as { key: string; value: string };
  const allowed = [
    'GNEWS_API_KEY', 'OLLAMA_HOST', 'OLLAMA_MODEL', 'GITHUB_TOKEN', 'NOTION_TOKEN',
    'DISCORD_WEBHOOK_URL', 'DISCORD_BOT_TOKEN', 'GEMINI_API_KEY', 'GEMINI_MODEL',
    'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'TELEGRAM_BOT_TOKEN', 'WOLFRAM_APP_ID',
  ];
  if (!allowed.includes(key)) return { ok: false, error: 'Key not allowed' };
  // Newlines in the value would let a value smuggle in an extra "KEY=..."
  // line, writing keys the allowlist above was supposed to block.
  if (/[\r\n]/.test(value)) return { ok: false, error: 'Value cannot contain line breaks' };
  try {
    const file = setEnvKey(key, value);
    return { ok: true, file };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
});
ipcMain.handle('env:path', () => writableEnvPath());

/* ── IPC: memory ────────────────────────────────────────────────────── */

ipcMain.handle('memory:get', () => memory.getMemory());
ipcMain.handle('memory:save', (_e, content: string) => memory.saveMemory(content));
ipcMain.handle('memory:path', () => memory.memoryPath());

/* ── IPC: research (the Researcher specialist's live lookup) ─────────── */

ipcMain.handle('research:wikipedia', (_e, query: unknown) =>
  typeof query === 'string' ? research.lookupWikipedia(query) : null);
ipcMain.handle('research:multi', (_e, query: unknown) =>
  typeof query === 'string' ? research.research(query) : []);
ipcMain.handle('research:weather', (_e, place: unknown) =>
  typeof place === 'string' ? research.getWeather(place) : null);
ipcMain.handle('research:onThisDay', () => research.getOnThisDay());

/* ── IPC: GitHub connector (real, not scaffolding) ────────────────────── */

ipcMain.handle('github:hasToken', () => github.hasToken());
ipcMain.handle('github:verify', () => github.verify());
ipcMain.handle('github:repos', (_e, limit?: number) => github.getRepos(limit));
ipcMain.handle('github:openWork', (_e, limit?: number) => github.getOpenWork(limit));

/* ── IPC: Notion connector (real, not scaffolding) ─────────────────────── */

ipcMain.handle('notion:hasToken', () => notion.hasToken());
ipcMain.handle('notion:verify', () => notion.verify());
ipcMain.handle('notion:search', (_e, limit?: number) => notion.search(limit));

/* ── IPC: Discord connector (real, webhook-based) ──────────────────────── */

ipcMain.handle('discord:hasWebhook', () => discord.hasWebhook());
ipcMain.handle('discord:verify', () => discord.verify());
// Posting is always a direct result of a button click in DiscordPanel - never
// reachable from LLM output, consistent with the file-mutation design choice.
ipcMain.handle('discord:postMessage', (_e, content: unknown) =>
  typeof content === 'string' ? discord.postMessage(content) : { ok: false, error: 'Bad payload' });

/* ── IPC: Discord bot mode (real, deliberately narrow - see discord.ts) ── */

ipcMain.handle('discord:hasBotToken', () => discord.hasBotToken());
ipcMain.handle('discord:verifyBot', () => discord.verifyBot());
ipcMain.handle('discord:guilds', () => discord.listGuilds());
ipcMain.handle('discord:channels', (_e, guildId: unknown) =>
  typeof guildId === 'string' ? discord.listChannels(guildId) : []);
ipcMain.handle('discord:messages', (_e, channelId: unknown, limit?: number) =>
  typeof channelId === 'string' ? discord.getRecentMessages(channelId, limit) : []);
ipcMain.handle('discord:postAsBot', (_e, channelId: unknown, content: unknown) =>
  typeof channelId === 'string' && typeof content === 'string'
    ? discord.postMessageAsBot(channelId, content)
    : { ok: false, error: 'Bad payload' });
ipcMain.handle('discord:roles', (_e, guildId: unknown) =>
  typeof guildId === 'string' ? discord.listRoles(guildId) : []);
ipcMain.handle('discord:members', (_e, guildId: unknown, limit?: number) =>
  typeof guildId === 'string' ? discord.listMembers(guildId, limit) : []);
ipcMain.handle('discord:assignRole', (_e, guildId: unknown, userId: unknown, roleId: unknown) =>
  typeof guildId === 'string' && typeof userId === 'string' && typeof roleId === 'string'
    ? discord.assignRole(guildId, userId, roleId)
    : { ok: false, error: 'Bad payload' });
ipcMain.handle('discord:removeRole', (_e, guildId: unknown, userId: unknown, roleId: unknown) =>
  typeof guildId === 'string' && typeof userId === 'string' && typeof roleId === 'string'
    ? discord.removeRole(guildId, userId, roleId)
    : { ok: false, error: 'Bad payload' });
ipcMain.handle('discord:createChannel', (_e, guildId: unknown, name: unknown) =>
  typeof guildId === 'string' && typeof name === 'string'
    ? discord.createChannel(guildId, name)
    : { ok: false, error: 'Bad payload' });
ipcMain.handle('discord:renameChannel', (_e, channelId: unknown, name: unknown) =>
  typeof channelId === 'string' && typeof name === 'string'
    ? discord.renameChannel(channelId, name)
    : { ok: false, error: 'Bad payload' });

/* ── IPC: Obsidian vault (real, no credentials - just indexed folders) ─── */

ipcMain.handle('obsidian:hasVault', () => obsidian.hasVault());
ipcMain.handle('obsidian:folders', () => obsidian.getVaultFolders());
ipcMain.handle('obsidian:recentNotes', (_e, limit?: number) => obsidian.getRecentNotes(limit));

/* ── IPC: files (phase 2) ───────────────────────────────────────────── */

ipcMain.handle('files:add', () => files.addFolder(win));
ipcMain.handle('files:remove', (_e, folderPath: string) => files.removeFolder(folderPath));
ipcMain.handle('files:list', (_e, limit?: number) => files.listFiles(limit));
ipcMain.handle('files:search', (_e, query: string) => files.searchFiles(query));
ipcMain.handle('files:rebuild', () => files.rebuildIndex().length);
ipcMain.handle('files:stats', () => files.indexStats());
// Validated against the indexed-folder allowlist inside files.ts itself -
// this channel never had a containment check before, so any path could be
// revealed regardless of whether the operator had actually indexed it.
ipcMain.handle('files:reveal', (_e, filePath: unknown) =>
  typeof filePath === 'string' ? files.revealSafe(filePath) : false);

/* ── IPC: files - organize & edit (real mutation, indexed folders only) */

ipcMain.handle('files:read', (_e, p: unknown) => (typeof p === 'string' ? files.readFileContent(p) : { ok: false, error: 'Bad path' }));
ipcMain.handle('files:write', (_e, p: unknown, content: unknown) =>
  typeof p === 'string' && typeof content === 'string'
    ? files.writeFileContent(p, content)
    : { ok: false, error: 'Bad payload' });
ipcMain.handle('files:rename', (_e, p: unknown, name: unknown) =>
  typeof p === 'string' && typeof name === 'string' ? files.renameFile(p, name) : { ok: false, error: 'Bad payload' });
ipcMain.handle('files:move', (_e, p: unknown, destFolder: unknown) =>
  typeof p === 'string' && typeof destFolder === 'string' ? files.moveFile(p, destFolder) : { ok: false, error: 'Bad payload' });
ipcMain.handle('files:delete', (_e, p: unknown) =>
  typeof p === 'string' ? files.deleteFile(p) : Promise.resolve({ ok: false, error: 'Bad path' }));
ipcMain.handle('files:createFile', (_e, folder: unknown, name: unknown, content: unknown) =>
  typeof folder === 'string' && typeof name === 'string'
    ? files.createFile(folder, name, typeof content === 'string' ? content : '')
    : { ok: false, error: 'Bad payload' });
ipcMain.handle('files:createFolder', (_e, folder: unknown, name: unknown) =>
  typeof folder === 'string' && typeof name === 'string' ? files.createSubfolder(folder, name) : { ok: false, error: 'Bad payload' });

/* ── IPC: misc ──────────────────────────────────────────────────────── */

ipcMain.handle('app:openExternal', async (_e, url: string) => {
  if (!/^https?:\/\//.test(url)) return false;
  await shell.openExternal(url); // resolves void on success - do not return it directly
  return true;
});
ipcMain.handle('app:versions', () => ({
  electron: process.versions.electron,
  chrome: process.versions.chrome,
  node: process.versions.node,
  platform: process.platform,
}));

/* ── Dev utility ────────────────────────────────────────────────────────
   ULTRON_CAPTURE=<file.png> launches the app, lets it settle, writes a
   screenshot of its own window and exits. Used to generate README shots
   and to eyeball the HUD without a manual screen grab.
   Optional: ULTRON_CAPTURE_DELAY (ms), ULTRON_CAPTURE_JS (snippet run first).  */

// Dev-only, hard gate: this runs arbitrary JS in the renderer and writes an
// arbitrary file path from two env vars. Fine for a local build tool; not
// something that may ever be reachable in a shipped install by whoever set
// an env var before launching the installed app.
if (!app.isPackaged && process.env.ULTRON_CAPTURE) {
  const target = process.env.ULTRON_CAPTURE;
  const rawDelay = Number(process.env.ULTRON_CAPTURE_DELAY);
  const delay = Number.isFinite(rawDelay) && rawDelay > 0 ? rawDelay : 4200;
  app.whenReady().then(() => {
    const timer = setTimeout(async () => {
      try {
        if (!win || win.isDestroyed()) throw new Error('window gone');
        const js = process.env.ULTRON_CAPTURE_JS;
        if (js) {
          const jsResult = await win.webContents.executeJavaScript(js);
          if (jsResult !== undefined) console.log('[ultron] js result:', jsResult);
          await new Promise((r) => setTimeout(r, 1500));
        }
        const image = await win.webContents.capturePage();
        const fs = require('node:fs') as typeof import('node:fs');
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, image.toPNG());
        console.log(`[ultron] captured -> ${target}`);
      } catch (e) {
        console.error('[ultron] capture failed:', e);
      } finally {
        clearTimeout(timer);
        app.quit();
      }
    }, delay);
  });
}
