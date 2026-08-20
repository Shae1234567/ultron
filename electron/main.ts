import { app, BrowserWindow, ipcMain, screen, shell } from 'electron';
import path from 'node:path';
import { loadEnv, setEnvKey, writableEnvPath } from './env';
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
    title: 'ULTRON',
    icon: path.join(__dirname, '../build-assets/icon.ico'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      // preload.ts only imports 'electron' (contextBridge, ipcRenderer), both
      // available under the sandbox - this is the real containment boundary
      // if a renderer-side dependency is ever compromised, and there was no
      // actual reason for it to be off.
      sandbox: true,
    },
  });

  win.once('ready-to-show', () => win?.show());

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

/* ── IPC: window chrome ─────────────────────────────────────────────── */

ipcMain.handle('win:minimize', () => win?.minimize());
ipcMain.handle('win:maximize', () => {
  if (!win) return false;
  if (win.isMaximized()) win.unmaximize();
  else win.maximize();
  return win.isMaximized();
});
ipcMain.handle('win:close', () => win?.close());

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
}) => {
  try {
    const text = await ollama.chatOnce(payload.messages, payload);
    return { ok: true as const, text };
  } catch (e) {
    return { ok: false as const, error: e instanceof Error ? e.message : String(e) };
  }
});

/* ── IPC: news ──────────────────────────────────────────────────────── */

ipcMain.handle('news:fetch', (_e, manual: boolean) => news.fetchNews(Boolean(manual)));
ipcMain.handle('news:quota', () => news.quotaSnapshot());
ipcMain.handle('news:hasKey', () => news.hasApiKey());

/* ── IPC: settings + env ────────────────────────────────────────────── */

ipcMain.handle('settings:get', () => getSettings());
ipcMain.handle('settings:save', (_e, patch: unknown) => {
  if (!patch || typeof patch !== 'object') return getSettings();
  // `folders` is deliberately never settable through this channel - the
  // whole point of files.ts's design is that Ultron only ever indexes
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
  const allowed = ['GNEWS_API_KEY', 'OLLAMA_HOST', 'OLLAMA_MODEL', 'GITHUB_TOKEN', 'NOTION_TOKEN', 'DISCORD_WEBHOOK_URL', 'DISCORD_BOT_TOKEN'];
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
