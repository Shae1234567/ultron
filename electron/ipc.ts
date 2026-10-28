import fs from 'node:fs';
import path from 'node:path';
import { app, clipboard, dialog, ipcMain, shell, type BrowserWindow } from 'electron';
import { getSettings, saveSettings, type Settings } from './store';
import { cleanSecret, getSecret, isSecretName, secretsStatus, setSecret } from './secrets';
import { keyFromClipboard, wrongBox } from './keyShapes';
import * as ollama from './ollama';
import * as news from './news';
import * as files from './files';
import * as research from './research';
import * as backup from './backup';
import * as notifications from './notifications';
import * as tasks from './tasks';
import * as composio from './composio';
import * as d2l from './d2l';
import * as powerschool from './powerschool';
import { collected as pcCollected } from './departments/health/pcActivity';
import { collected as gamesCollected } from './media/tracker';
import { writeDoc } from './store';
import { refreshSchool } from './departments/school/refresh';
import { searchLibrary, syncLibrary } from './departments/school/library';
import { makeStudyPlan } from './brain/tools/school';
import { load as loadSchool } from './departments/school/store';
import { schoolNumber, schoolSnapshotText } from './departments/school/summary';
import { focusState } from './focus';
import * as discord from './discord';
import * as addons from './addons';
import * as hindsight from './hindsight';
import { loadTranscript, saveTranscript } from './transcript';
import * as browserAgent from './browser';
import { getHardwareStats } from './hardwareStats';
import { isAutoLaunchEnabled, setAutoLaunch } from './tray';
import { ask, cancelRun, newRunId, once } from './brain/team';
import { brainStatus, brainUsage, refreshGemini } from './brain/llm';
import { greet, type GreetKind } from './brain/proactive';
import { AGENTS } from './brain/agents';
import * as council from './council';
import * as healthApi from './departments/health/api';
import { pendingApprovals, respond as respondApproval } from './brain/approvals';
import { emit, windowFocused } from './brain/events';
import * as dashboard from './dashboard';
import * as learn from './learn';
import * as clouds from './clouds';
import * as focus from './focus';
import { backupVault, listBackups } from './vaultBackup';
import { briefingNow } from './briefing';
import { reflectNow } from './reflect';
import { mindGraph, readMindNote } from './memory/graph';
import { hqRoot, isHqNote } from './memory/hq';
import { prepareVoice, synthesize, ULTRON_VOICES, voiceStatus } from './voice/kokoro';
import { runSelfTest } from './selftest';
import { memoryBlock, persona } from './brain/prompts';
import { ensureVault, profileForPrompt, readProfile, recentNotes, saveProfile, vaultRoot, vaultStats } from './memory/vault';
import { forgetIndex, searchMemory, syncIndex } from './memory/semantic';

type GetWin = () => BrowserWindow | null;

const isStr = (v: unknown): v is string => typeof v === 'string';

/** Reads (never writes) Obsidian's own vault registry. */
function obsidianKnowsVault(root: string): boolean {
  try {
    const registry = JSON.parse(fs.readFileSync(path.join(app.getPath('appData'), 'obsidian', 'obsidian.json'), 'utf8')) as { vaults?: Record<string, { path?: string }> };
    const want = path.resolve(root).toLowerCase();
    return Object.values(registry.vaults ?? {}).some((v) => v.path && path.resolve(v.path).toLowerCase() === want);
  } catch {
    return false;
  }
}

export function registerIpc(getWin: GetWin): void {
  /* ── window chrome ─────────────────────────────────────────────── */
  ipcMain.handle('win:minimize', () => getWin()?.minimize());
  ipcMain.handle('win:maximize', () => {
    const win = getWin();
    if (!win) return false;
    if (win.isMaximized()) win.unmaximize();
    else win.maximize();
    return win.isMaximized();
  });
  ipcMain.handle('win:close', () => getWin()?.close());
  ipcMain.handle('win:show', () => { const w = getWin(); w?.show(); w?.focus(); });

  ipcMain.handle('notify:show', (_e, title: unknown, body: unknown) => {
    if (!isStr(title) || !isStr(body)) return { ok: false };
    if (windowFocused()) return { ok: true, skipped: true };
    notifications.showNotification(title, body);
    return { ok: true };
  });

  /* ── brain ─────────────────────────────────────────────────────── */
  ipcMain.handle('brain:ask', (_e, payload: unknown) => {
    const p = payload as { text?: unknown; history?: unknown };
    if (!isStr(p?.text) || !p.text.trim()) return { ok: false, error: 'Empty message.' };
    const history = Array.isArray(p.history)
      ? p.history
          .filter((m): m is { role: 'user' | 'assistant'; content: string } =>
            Boolean(m) && (m.role === 'user' || m.role === 'assistant') && isStr(m.content))
          .slice(-30)
      : [];
    const runId = newRunId();
    void ask({ runId, text: p.text.slice(0, 8000), history });
    return { ok: true, runId };
  });
  ipcMain.handle('brain:cancel', (_e, runId: unknown) => { if (isStr(runId)) cancelRun(runId); });
  ipcMain.handle('brain:status', () => brainStatus());
  ipcMain.handle('brain:recheck', async () => {
    await Promise.all([refreshGemini(true), clouds.refreshAllClouds(true).then(() => clouds.proveAllClouds())]);
    return brainStatus();
  });
  ipcMain.handle('brain:once', async (_e, payload: unknown) => {
    const p = payload as { system?: unknown; user?: unknown; tier?: unknown; temperature?: unknown };
    if (!isStr(p?.system)) return { ok: false, error: 'Bad payload' };
    try {
      const text = await once({
        system: p.system,
        user: isStr(p.user) ? p.user : undefined,
        tier: p.tier === 'main' ? 'main' : 'fast',
        temperature: typeof p.temperature === 'number' ? p.temperature : undefined,
      });
      return { ok: true, text };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });
  ipcMain.handle('brain:greet', async (_e, kind: unknown) => {
    const k: GreetKind = kind === 'wake' || kind === 'checkin' ? kind : 'boot';
    try {
      return { ok: true, text: await greet(k) };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });
  ipcMain.handle('brain:agents', () =>
    Object.values(AGENTS).map(({ id, name, title, summary, color, department }) => ({ id, name, title, summary, color, department })));
  // The council chamber: real seats, numbers and brains; each head's line; Convene; linking his phone.
  ipcMain.handle('council:state', () => council.councilState());
  ipcMain.handle('council:line', (_e, id: unknown) => (typeof id === 'string' ? council.seatLine(id) : ''));
  ipcMain.handle('council:convene', () => council.convene());
  ipcMain.handle('council:phoneLink', () => council.phoneLink());
  ipcMain.handle('council:helios', (_e, on: unknown) => { saveSettings({ helios: { on: on === true } }); return council.councilState().helios; });
  // The Health app: one day's view, logging, editing, deleting (with undo), the food helpers and the schedule.
  // Every payload is checked in departments/health/api.ts before it reaches the log.
  ipcMain.handle('health:view', (_e, date: unknown) => healthApi.view(date));
  ipcMain.handle('health:log', (_e, kind: unknown, p: unknown) => healthApi.log(kind, p));
  ipcMain.handle('health:edit', (_e, kind: unknown, id: unknown, p: unknown) => healthApi.edit(kind, id, p));
  ipcMain.handle('health:remove', (_e, kind: unknown, id: unknown) => healthApi.remove(kind, id));
  ipcMain.handle('health:restore', (_e, kind: unknown, entry: unknown) => healthApi.restore(kind, entry));
  ipcMain.handle('health:preview', (_e, text: unknown) => healthApi.preview(text));
  ipcMain.handle('health:search', (_e, q: unknown) => healthApi.search(q));
  ipcMain.handle('health:barcode', (_e, code: unknown) => healthApi.barcode(code));
  ipcMain.handle('health:saveUsual', (_e, name: unknown, p: unknown) => healthApi.saveUsual(name, p));
  ipcMain.handle('health:removeUsual', (_e, name: unknown) => healthApi.removeUsual(name));
  ipcMain.handle('health:scheduleAdd', (_e, p: unknown) => healthApi.scheduleAdd(p));
  ipcMain.handle('health:scheduleRemove', (_e, id: unknown) => healthApi.scheduleRemove(id));
  ipcMain.handle('health:program', (_e, action: unknown) => healthApi.program(action));
  // Live Voice streams audio straight from the renderer to Google, so it needs
  // the key there - the one deliberate exception to "keys stay in main".
  ipcMain.handle('brain:liveVoice', async () => {
    const status = await brainStatus();
    const system = `${persona(getSettings(), memoryBlock(profileForPrompt(1800), []))}\n\nYou are in a real-time spoken voice conversation right now - keep replies short and natural, like talking, not writing.`;
    return { key: getSecret('GEMINI_API_KEY'), model: status.gemini.liveModel, system };
  });

  ipcMain.handle('approval:respond', (_e, id: unknown, approved: unknown, all: unknown) => {
    if (isStr(id)) respondApproval(id, approved === true, all === true);
  });
  ipcMain.handle('approval:pending', () => pendingApprovals());

  /* ── secrets ───────────────────────────────────────────────────── */
  ipcMain.handle('secrets:status', () => secretsStatus());
  // Which brains Ultron is really using right now, in order, with today's answers.
  ipcMain.handle('brain:usage', () => brainUsage());
  // AI services he adds himself: presets, any OpenAI-compatible address, their keys, and removing them.
  ipcMain.handle('clouds:presets', () => clouds.PRESETS.map(({ id, label, baseUrl, signup, free, noKey }) => ({ id, label, baseUrl, signup, free, noKey, needsAccount: baseUrl.includes('{account_id}') }))
    .filter((p) => !clouds.cloudDef(p.id)));
  ipcMain.handle('clouds:add', async (_e, p: unknown) => {
    const o = (p ?? {}) as Record<string, unknown>;
    const str = (k: string) => (typeof o[k] === 'string' ? (o[k] as string) : undefined);
    return clouds.addCloud({ preset: str('preset'), label: str('label'), baseUrl: str('baseUrl'), model: str('model'), key: str('key') ?? '', accountId: str('accountId') });
  });
  ipcMain.handle('clouds:remove', (_e, id: unknown) => (isStr(id) ? clouds.removeCloud(id) : false));
  ipcMain.handle('clouds:setKey', async (_e, id: unknown, value: unknown) =>
    (isStr(id) && isStr(value) ? clouds.setCloudKey(id, value) : { ok: false, error: 'Bad payload' }));
  ipcMain.handle('secrets:set', async (_e, name: unknown, value: unknown) => saveKey(name, value));
  // "Paste & test" on a refused key: the key goes from the clipboard straight to the encrypted store,
  // in this process - it never passes through the page, and works whether or not the window has focus.
  ipcMain.handle('clouds:pasteKey', async (_e, id: unknown) => {
    const def = isStr(id) ? clouds.cloudDef(id) : undefined;
    if (!def) return { ok: false, error: 'Unknown service.' };
    const got = await keyFromClipboard(() => clipboard.readText(), def.label, cleanSecret);
    if ('error' in got) return { ok: false, error: got.error };
    return def.custom ? clouds.setCloudKey(def.id, got.key) : saveKey(def.secret, got.key);
  });
  async function saveKey(name: unknown, value: unknown) {
    if (!isStr(name) || !isSecretName(name) || !isStr(value)) return { ok: false, error: 'Bad payload' };
    // A key pasted into the wrong service's box is caught here, before it replaces a good one.
    const shapeOf: Partial<Record<string, string>> = { GROQ_API_KEY: 'groq', OPENROUTER_API_KEY: 'openrouter', NVIDIA_API_KEY: 'nvidia', HUGGINGFACE_API_KEY: 'huggingface', DEEPSEEK_API_KEY: 'deepseek', OPENAI_API_KEY: 'openai', GEMINI_API_KEY: 'gemini' };
    const misplaced = shapeOf[name] && value.trim() ? wrongBox(shapeOf[name]!, cleanSecret(value)) : null;
    if (misplaced) return { ok: false, error: misplaced };
    try {
      setSecret(name, value);
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
    // A key for one of the free AI services: check it answers and see which models it offers.
    const cloud = clouds.CLOUDS.find((c) => c.secret === name);
    if (cloud) {
      if (!value.trim()) return { ok: true, status: secretsStatus() };
      // A real call, not just a model list - these services list models to anyone.
      const v = await clouds.verifyCloud(cloud.id);
      return v.ok
        ? { ok: true, status: secretsStatus(), detail: `${cloud.label} connected - using ${v.model}.${v.error ? ` (${v.error})` : ''}` }
        : { ok: false, status: secretsStatus(), error: v.error ?? `${cloud.label} did not accept the key.` };
    }
    // Verify on save so a bad key is caught here, not mid-conversation.
    if (name === 'GEMINI_API_KEY') {
      const g = await refreshGemini(true);
      if (!value.trim()) return { ok: true, status: secretsStatus() };
      return g.valid ? { ok: true, status: secretsStatus(), detail: `Gemini connected - using ${g.model}.` } : { ok: false, status: secretsStatus(), error: g.error ?? 'Gemini did not accept the key.' };
    }
    if (name === 'COMPOSIO_API_KEY' && value.trim()) {
      const s = await composio.appsStatus();
      emit('apps:changed', s);
      return s.ok ? { ok: true, status: secretsStatus(), detail: 'Composio connected.' } : { ok: false, status: secretsStatus(), error: s.hint ?? s.error };
    }
    if (name === 'DISCORD_BOT_TOKEN' && value.trim()) {
      const d = await discord.status();
      return d.ok
        ? { ok: true, status: secretsStatus(), detail: `Discord bot "${d.bot}" connected${d.servers?.length ? ` - in ${d.servers.map((s) => s.name).join(', ')}` : ' - now add it to your server'}` }
        : { ok: false, status: secretsStatus(), error: d.error ?? 'Discord did not accept the token.' };
    }
    return { ok: true, status: secretsStatus() };
  }
  ipcMain.handle('discord:status', () => discord.status());
  ipcMain.handle('addons:status', async () => ({ addons: addons.addonStatus(getSettings().addons.askBrowserAgent), hindsight: await hindsight.status() }));
  ipcMain.handle('addons:setHindsight', async (_e, on: unknown) => {
    saveSettings({ addons: { ...getSettings().addons, hindsight: on === true } });
    if (on === true) void hindsight.ensureRunning();
    else hindsight.stop();
    return { addons: addons.addonStatus(getSettings().addons.askBrowserAgent), hindsight: await hindsight.status() };
  });
  ipcMain.handle('addons:setAskBrowserAgent', (_e, on: unknown) => {
    saveSettings({ addons: { ...getSettings().addons, askBrowserAgent: on === true } });
    return getSettings().addons.askBrowserAgent;
  });

  /* ── settings ──────────────────────────────────────────────────── */
  ipcMain.handle('settings:get', () => getSettings());
  ipcMain.handle('settings:save', (_e, patch: unknown) => {
    if (!patch || typeof patch !== 'object') return getSettings();
    // folders only ever come from the real OS picker (files:add), never from the renderer.
    const { folders: _ignored, ...rest } = patch as Partial<Settings>;
    const before = getSettings();
    const next = saveSettings(rest);
    if (next.vault.path !== before.vault.path) {
      ensureVault();
      forgetIndex();
      void syncIndex().catch(() => {});
    }
    return next;
  });

  /* ── Ollama ────────────────────────────────────────────────────── */
  ipcMain.handle('ollama:status', () => ollama.status());
  ipcMain.handle('ollama:pull', (_e, model: unknown) => {
    if (!isStr(model)) return { ok: false, error: 'Bad model' };
    void ollama.pullModel(model, (p) => emit('ollama:pullProgress', p));
    return { ok: true };
  });

  /* ── memory vault ──────────────────────────────────────────────── */
  ipcMain.handle('vault:stats', () => vaultStats());
  // The Memory tab's mind sphere: every note, its group and its [[links]]; and one note's text for its preview.
  ipcMain.handle('memory:graph', () => mindGraph());
  ipcMain.handle('vault:read', (_e, rel: unknown) => (isStr(rel) ? readMindNote(rel) : null));
  ipcMain.handle('vault:recent', (_e, limit: unknown) => recentNotes(typeof limit === 'number' ? limit : 12));
  ipcMain.handle('vault:search', async (_e, q: unknown) => (isStr(q) ? searchMemory(q, 8) : []));
  ipcMain.handle('vault:profile', () => readProfile());
  ipcMain.handle('vault:saveProfile', (_e, text: unknown) => {
    if (!isStr(text)) return { ok: false };
    saveProfile(text);
    void syncIndex(['Profile/Operator.md']).catch(() => {});
    return { ok: true };
  });
  ipcMain.handle('vault:open', async (_e, rel: unknown) => {
    // An HQ file (shown in the mind sphere) opens from HQ itself, read-only to Ultron.
    if (isStr(rel) && rel.startsWith('HQ/')) {
      const hq = hqRoot();
      const inner = rel.slice(3);
      if (!hq || !isHqNote(inner)) return { ok: false, error: 'That HQ file is not one Ultron reads.' };
      const err = await shell.openPath(path.join(hq, ...inner.split('/')));
      return err ? { ok: false, error: err } : { ok: true, via: 'explorer' };
    }
    const root = vaultRoot();
    const target = isStr(rel) && rel ? path.join(root, ...rel.split('/')) : root;
    // obsidian:// only works once Obsidian has registered this folder as a vault.
    if (obsidianKnowsVault(root)) {
      try {
        await shell.openExternal(`obsidian://open?path=${encodeURIComponent(target)}`);
        return { ok: true, via: 'obsidian' };
      } catch { /* fall through to Explorer */ }
    }
    const err = await shell.openPath(root);
    return err
      ? { ok: false, error: err }
      : { ok: true, via: 'explorer', hint: 'To browse it in Obsidian: Obsidian > Open folder as vault > pick this folder (once).' };
  });
  ipcMain.handle('vault:reveal', async () => {
    const err = await shell.openPath(vaultRoot());
    return err ? { ok: false, error: err } : { ok: true };
  });
  ipcMain.handle('vault:choose', async () => {
    const win = getWin();
    const opts = { title: 'Choose where Ultron keeps its vault', properties: ['openDirectory' as const, 'createDirectory' as const] };
    const res = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts);
    if (res.canceled || !res.filePaths[0]) return { ok: false };
    const next = saveSettings({ vault: { path: res.filePaths[0] } });
    ensureVault(readProfile() || undefined);
    forgetIndex();
    void syncIndex().catch(() => {});
    return { ok: true, settings: next };
  });
  ipcMain.handle('vault:reindex', async () => {
    forgetIndex();
    await syncIndex();
    return vaultStats();
  });

  /* ── tasks ─────────────────────────────────────────────────────── */
  ipcMain.handle('web:status', () => browserAgent.webLoginStatus());
  ipcMain.handle('web:signIn', (_e, url: unknown) => browserAgent.openSignIn(isStr(url) ? url : undefined));
  ipcMain.handle('web:clear', async () => { await browserAgent.clearWebLogins(); return browserAgent.webLoginStatus(); });

  ipcMain.handle('transcript:load', () => loadTranscript());
  ipcMain.handle('transcript:save', (_e, entries: unknown) => { saveTranscript(entries); return true; });

  ipcMain.handle('tasks:list', () => tasks.listTasks('all'));
  ipcMain.handle('tasks:add', (_e, input: unknown) => {
    const p = input as { title?: unknown; due?: unknown; priority?: unknown };
    if (!isStr(p?.title) || !p.title.trim()) return { ok: false, error: 'A task needs a title.' };
    try {
      const task = tasks.addTask({
        title: p.title,
        due: isStr(p.due) && p.due.trim() ? p.due : undefined,
        priority: p.priority === 'high' || p.priority === 'low' ? p.priority : undefined,
        source: 'operator',
      });
      return { ok: true, task };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });
  ipcMain.handle('tasks:complete', (_e, id: unknown) => (isStr(id) ? tasks.completeTask(id) : null));
  ipcMain.handle('tasks:reopen', (_e, id: unknown) => (isStr(id) ? tasks.reopenTask(id) : null));
  ipcMain.handle('tasks:remove', (_e, id: unknown) => (isStr(id) ? tasks.removeTask(id) : null));
  ipcMain.handle('tasks:snooze', (_e, id: unknown, minutes: unknown) =>
    (isStr(id) ? tasks.snoozeTask(id, typeof minutes === 'number' ? minutes : 10) : null));
  ipcMain.handle('tasks:update', (_e, id: unknown, patch: unknown) => {
    if (!isStr(id) || !patch || typeof patch !== 'object') return null;
    const p = patch as Record<string, unknown>;
    return tasks.updateTask(id, {
      title: isStr(p.title) ? p.title : undefined,
      due: p.due === null || isStr(p.due) ? (p.due as string | null) : undefined,
      priority: p.priority === 'high' || p.priority === 'low' || p.priority === 'normal' ? p.priority : undefined,
      notes: isStr(p.notes) ? p.notes : undefined,
    });
  });
  ipcMain.handle('tasks:clearDone', () => tasks.clearCompleted());

  /* ── apps (Composio) ───────────────────────────────────────────── */
  ipcMain.handle('apps:status', () => composio.appsStatus());
  ipcMain.handle('apps:connect', (_e, slug: unknown) => (isStr(slug) ? composio.connectApp(slug) : { ok: false, error: 'Bad app' }));
  ipcMain.handle('apps:signIn', () => composio.signIn());
  ipcMain.handle('apps:signOut', () => composio.signOut());
  ipcMain.handle('apps:disconnect', (_e, slug: unknown) => (isStr(slug) ? composio.disconnectApp(slug) : { ok: false, error: 'Bad app' }));

  /* ── D2L ───────────────────────────────────────────────────────── */
  /* ── focus sessions and vault backups ─────────────────────────── */
  ipcMain.handle('briefing:now', () => briefingNow());
  ipcMain.handle('focus:state', () => focus.focusState());
  ipcMain.handle('focus:start', (_e, subject: unknown, minutes: unknown) => focus.startFocus(isStr(subject) ? subject : 'study', typeof minutes === 'number' ? minutes : 25));
  ipcMain.handle('focus:stop', () => focus.stopFocus());
  ipcMain.handle('vault:backups', () => listBackups());
  ipcMain.handle('vault:backupNow', () => backupVault(true));

  /* ── what Ultron has learned ──────────────────────────────────── */
  ipcMain.handle('learn:summary', () => learn.summary());
  ipcMain.handle('learn:reflect', () => reflectNow(true));
  ipcMain.handle('learn:selftest', () => runSelfTest());

  /* ── Life dashboard ────────────────────────────────────────────── */
  ipcMain.handle('dashboard:get', () => dashboard.getSnapshot());
  ipcMain.handle('dashboard:refresh', () => dashboard.refresh());
  ipcMain.handle('dashboard:spotify', (_e, action: unknown) => dashboard.pollSpotify(
    action === 'toggle' || action === 'next' || action === 'previous' ? action : 'status'));
  ipcMain.handle('dashboard:open', (_e, url: unknown) => (isStr(url) ? dashboard.open(url) : false));

  ipcMain.handle('d2l:status', () => d2l.status());
  ipcMain.handle('d2l:signIn', () => d2l.signIn());
  ipcMain.handle('d2l:signOut', () => d2l.signOut());
  ipcMain.handle('d2l:open', () => d2l.openInBrowser());
  ipcMain.handle('d2l:sync', async () => {
    try {
      return { ok: true, ...(await d2l.syncToTasks(21)) };
    } catch (e) {
      return { ok: false, error: d2l.isAuthError(e) ? 'Sign in to D2L first (Apps panel).' : e instanceof Error ? e.message : String(e) };
    }
  });

  // Ultron's voice (Kokoro on this PC + the Ultron effect in the window).
  ipcMain.handle('voice:status', () => voiceStatus());
  ipcMain.handle('voice:prepare', () => { prepareVoice(); return voiceStatus(); });
  ipcMain.handle('voice:voices', () => ULTRON_VOICES);
  ipcMain.handle('voice:synth', (_e, text: string, voice: string, speed: number) => synthesize(String(text ?? ''), String(voice ?? ''), Number(speed) || 1));

  // PowerSchool (MyCBE): its own sign-in window - he signs in himself; Ultron keeps only the session.
  ipcMain.handle('powerschool:status', () => powerschool.status());
  ipcMain.handle('powerschool:signIn', async () => {
    const s = await powerschool.signIn();
    if (s.signedIn) void refreshSchool().catch(() => undefined);
    return s;
  });
  ipcMain.handle('powerschool:signOut', () => powerschool.signOut());
  ipcMain.handle('powerschool:open', () => powerschool.openInBrowser());
  // School's copy (what's due, grades, on time) for the screen, and a fresh read on demand.
  ipcMain.handle('school:state', () => {
    const doc = loadSchool();
    const f = focusState();
    return { doc, number: schoolNumber(doc), text: schoolSnapshotText(doc, { streak: f.streak, todayMinutes: f.todayMinutes, recent: f.recent }), focus: { streak: f.streak, todayMinutes: f.todayMinutes } };
  });
  ipcMain.handle('school:refresh', () => refreshSchool());
  // Every automatic tracker shows exactly what it has collected - and he can wipe it.
  ipcMain.handle('trackers:collected', (_e, kind: unknown) => (kind === 'games' ? gamesCollected().map((s) => `${s.game}: ${s.from} - ${s.to}`) : pcCollected().map((s) => `PC in use ${s.from} - ${s.to}`)));
  ipcMain.handle('trackers:forget', (_e, kind: unknown) => {
    if (kind === 'games') writeDoc('departments/media-play.json', { sessions: [], open: {} });
    else if (kind === 'pc') writeDoc('departments/health-pc.json', { spans: [] });
    else return false;
    return true;
  });
  ipcMain.handle('school:courses', async () => {
    try {
      const lib = Object.values(loadSchool().library);
      const list = await d2l.contents();
      return { ok: true, courses: list.map((c) => ({ course: c.course, courseId: c.courseId, topics: c.topics.filter((t) => t.kind === 'file' || t.kind === 'html').length, inLibrary: lib.filter((l) => l.course === c.course).length })) };
    } catch (e) {
      return { ok: false, error: d2l.isAuthError(e) ? 'Sign in to D2L first (Apps panel).' : `Couldn't reach D2L right now (${e instanceof Error ? e.message : String(e)}).` };
    }
  });
  ipcMain.handle('school:sync', async (_e, course: unknown) => {
    try {
      const r = await syncLibrary(isStr(course) && course ? course : undefined, 30);
      return { ok: true, ...r };
    } catch (e) {
      return { ok: false, error: d2l.isAuthError(e) ? 'Sign in to D2L first (Apps panel).' : e instanceof Error ? e.message : String(e) };
    }
  });
  ipcMain.handle('school:search', async (_e, q: unknown, course: unknown) => (isStr(q) && q.trim() ? searchLibrary(q.slice(0, 200), isStr(course) && course ? course : undefined, 8) : []));
  ipcMain.handle('school:plan', async (_e, p: unknown) => {
    const o = (p ?? {}) as Record<string, unknown>;
    return makeStudyPlan(String(o.what ?? ''), String(o.due ?? ''), Number(o.total) || 120, Number(o.block) || 30);
  });

  /* ── news / weather / hardware ─────────────────────────────────── */
  ipcMain.handle('news:fetch', (_e, manual: boolean) => news.fetchNews(Boolean(manual)));
  ipcMain.handle('news:quota', () => news.quotaSnapshot());
  ipcMain.handle('news:hasKey', () => news.hasApiKey());
  ipcMain.handle('research:weather', (_e, place: unknown) => (isStr(place) ? research.getWeather(place) : null));
  ipcMain.handle('system:hardwareStats', () => getHardwareStats());

  /* ── files tab (indexed folders) ───────────────────────────────── */
  ipcMain.handle('files:add', () => files.addFolder(getWin()));
  ipcMain.handle('files:remove', (_e, folderPath: string) => files.removeFolder(folderPath));
  ipcMain.handle('files:list', (_e, limit?: number) => files.listFiles(limit));
  ipcMain.handle('files:search', (_e, query: string) => files.searchFiles(query));
  ipcMain.handle('files:rebuild', () => files.rebuildIndex().length);
  ipcMain.handle('files:stats', () => files.indexStats());
  ipcMain.handle('files:reveal', (_e, filePath: unknown) => (isStr(filePath) ? files.revealSafe(filePath) : false));
  ipcMain.handle('files:read', (_e, p: unknown) => (isStr(p) ? files.readFileContent(p) : { ok: false, error: 'Bad path' }));
  ipcMain.handle('files:write', (_e, p: unknown, content: unknown) =>
    (isStr(p) && isStr(content) ? files.writeFileContent(p, content) : { ok: false, error: 'Bad payload' }));
  ipcMain.handle('files:rename', (_e, p: unknown, name: unknown) =>
    (isStr(p) && isStr(name) ? files.renameFile(p, name) : { ok: false, error: 'Bad payload' }));
  ipcMain.handle('files:move', (_e, p: unknown, destFolder: unknown) =>
    (isStr(p) && isStr(destFolder) ? files.moveFile(p, destFolder) : { ok: false, error: 'Bad payload' }));
  ipcMain.handle('files:delete', (_e, p: unknown) => (isStr(p) ? files.deleteFile(p) : Promise.resolve({ ok: false, error: 'Bad path' })));
  ipcMain.handle('files:createFile', (_e, folder: unknown, name: unknown, content: unknown) =>
    (isStr(folder) && isStr(name) ? files.createFile(folder, name, isStr(content) ? content : '') : { ok: false, error: 'Bad payload' }));
  ipcMain.handle('files:createFolder', (_e, folder: unknown, name: unknown) =>
    (isStr(folder) && isStr(name) ? files.createSubfolder(folder, name) : { ok: false, error: 'Bad payload' }));

  /* ── misc ──────────────────────────────────────────────────────── */
  ipcMain.handle('backup:export', () => backup.exportBackup(getWin()));
  ipcMain.handle('backup:import', () => backup.importBackup(getWin()));
  ipcMain.handle('tray:isAutoLaunchEnabled', () => isAutoLaunchEnabled());
  ipcMain.handle('tray:setAutoLaunch', (_e, enabled: unknown) => setAutoLaunch(Boolean(enabled)));
  ipcMain.handle('app:openExternal', async (_e, url: unknown) => {
    if (!isStr(url) || !/^https?:\/\//.test(url)) return false;
    await shell.openExternal(url);
    return true;
  });
  ipcMain.handle('app:versions', () => ({
    app: app.getVersion(),
    packaged: app.isPackaged,
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
    platform: process.platform,
  }));
}
