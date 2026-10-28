import { BrowserWindow, session, shell, type Session } from 'electron';
import { getSettings } from './store';
import * as tasks from './tasks';
import { emit } from './brain/events';
import { keepAlive, keepAll, persistentCopy, watchSession, type AliveResult, type KeepAlive } from './keepSession';

/**
 * D2L Brightspace (CBE: d2l.cbe.ab.ca). Students can't get API keys, so the
 * operator signs in themselves in a normal window (school SSO, 2FA and all)
 * and Ultron keeps that session in its own cookie partition. Ultron never
 * sees or stores the password. Data then comes from Brightspace's own REST
 * API - the same calls the D2L website makes - using that session.
 */

const PARTITION = 'persist:d2l';

export interface D2LStatus { baseUrl: string; signedIn: boolean; user?: string; error?: string }
export interface D2LCourse { id: number; name: string; code: string; active: boolean }
export interface D2LDueItem { course: string; courseId: number; name: string; due: string | null; type: string; completed: boolean; url?: string }

let versions: { lp: string; le: string } | null = null;
let coursesCache: { at: number; list: D2LCourse[] } | null = null;
let loginWindow: BrowserWindow | null = null;

function ses(): Session {
  return session.fromPartition(PARTITION);
}

export function baseUrl(): string {
  const raw = (getSettings().d2l.baseUrl || 'https://d2l.cbe.ab.ca').trim();
  return raw.replace(/\/+$/, '').replace(/\/d2l(\/.*)?$/, '');
}

class D2LAuthError extends Error {}

/* ── Staying signed in ───────────────────────────────────────────────────
   The cookies are kept across restarts by keepSession.ts (saved the moment
   D2L or the school sign-on sets them). If D2L's own server session has
   timed out anyway, a hidden window reloads D2L so the school sign-on can
   sign back in silently - a visible window is only needed when a password is. */

export { persistentCopy };

/** Re-saves every session cookie in the D2L partition with an expiry date. Returns how many. */
export function keepSignedIn(): Promise<number> {
  return keepAll(ses());
}

/** Every 8 minutes while Ultron is open - well inside the time D2L lets a sign-in sit idle. */
export const ALIVE_EVERY_MS = 8 * 60_000;
let alive: KeepAlive | null = null;
let lastSeen: D2LStatus | null = null;

/** One keep-alive check: a single small read (whoami). An ended session gets the quiet re-sign-in first. */
async function aliveCheck(): Promise<AliveResult> {
  if (!(await hasSessionCookies())) return 'never';
  const s = await status();
  lastSeen = s;
  return s.signedIn ? 'ok' : s.error ? 'error' : 'lost';
}

/** From startup: save D2L's cookies whenever it sets or renews them, and keep the sign-in from timing out. */
export function startKeeping(everyMs = ALIVE_EVERY_MS): void {
  watchSession(ses());
  if (alive) return;
  alive = keepAlive({
    check: aliveCheck,
    everyMs,
    firstAfterMs: Math.min(30_000, everyMs),
    // The screen flips to "not signed in" straight away, from the check that just ran.
    onLost: () => { if (lastSeen) emit('d2l:changed', lastSeen); },
  });
  setInterval(() => void alive?.tick(), Math.min(60_000, everyMs / 2));
}

/** After the PC wakes or unlocks: check straight away rather than at the next tick. */
export function aliveNow(): void {
  void alive?.tick(true);
}

let silentTried = 0;

/** Reloads D2L in a hidden window so school SSO can re-establish the session without the operator. */
async function silentRefresh(): Promise<boolean> {
  if (Date.now() - silentTried < 10 * 60_000) return false;
  silentTried = Date.now();
  const win = new BrowserWindow({ show: false, webPreferences: { partition: PARTITION, contextIsolation: true, nodeIntegration: false, sandbox: true } });
  try {
    await win.loadURL(`${baseUrl()}/d2l/home`).catch(() => {});
    const until = Date.now() + 20_000;
    while (Date.now() < until && !win.isDestroyed()) {
      if (/\/d2l\/(home|le|lp)/.test(win.webContents.getURL())) {
        versions = null;
        const me = await whoami().catch(() => null);
        if (me) {
          await keepSignedIn();
          return true;
        }
      }
      await new Promise((r) => setTimeout(r, 1500));
    }
    return false;
  } finally {
    if (!win.isDestroyed()) win.destroy();
  }
}

async function getJson<T>(path: string): Promise<T> {
  const res = await ses().fetch(`${baseUrl()}${path}`, {
    credentials: 'include',
    headers: { Accept: 'application/json' },
    redirect: 'manual',
  });
  if (res.status === 401 || res.status === 403 || (res.status >= 300 && res.status < 400)) {
    throw new D2LAuthError('Not signed in to D2L (or the session expired). Sign in from the Apps panel.');
  }
  if (!res.ok) throw new Error(`D2L ${res.status} on ${path.split('?')[0]}`);
  const type = res.headers.get('content-type') ?? '';
  if (!type.includes('json')) throw new D2LAuthError('D2L returned a login page - sign in again from the Apps panel.');
  return (await res.json()) as T;
}

async function apiVersions(): Promise<{ lp: string; le: string }> {
  if (versions) return versions;
  try {
    const list = await getJson<{ ProductCode: string; LatestVersion: string }[]>('/d2l/api/versions/');
    const pick = (code: string, fallback: string) => list.find((v) => v.ProductCode === code)?.LatestVersion ?? fallback;
    versions = { lp: pick('lp', '1.40'), le: pick('le', '1.70') };
  } catch (e) {
    if (e instanceof D2LAuthError) throw e;
    versions = { lp: '1.40', le: '1.70' };
  }
  return versions;
}

interface WhoAmI { FirstName?: string; LastName?: string; UniqueName?: string }

async function whoami(): Promise<WhoAmI> {
  const v = await apiVersions();
  return getJson<WhoAmI>(`/d2l/api/lp/${v.lp}/users/whoami`);
}

async function hasSessionCookies(): Promise<boolean> {
  return (await ses().cookies.get({}).catch(() => [])).length > 0;
}

export async function status(): Promise<D2LStatus> {
  const url = baseUrl();
  try {
    const me = await whoami();
    void keepSignedIn().catch(() => {});
    alive?.signedIn();
    return { baseUrl: url, signedIn: true, user: [me.FirstName, me.LastName].filter(Boolean).join(' ') || me.UniqueName };
  } catch (e) {
    // Signed in before (cookies exist) but the server session lapsed: try once, quietly, before asking the operator.
    if (e instanceof D2LAuthError && (await hasSessionCookies()) && (await silentRefresh())) {
      const me = await whoami().catch(() => null);
      if (me) return { baseUrl: url, signedIn: true, user: [me.FirstName, me.LastName].filter(Boolean).join(' ') || me.UniqueName };
    }
    return { baseUrl: url, signedIn: false, error: e instanceof D2LAuthError ? undefined : e instanceof Error ? e.message : String(e) };
  }
}

/** Opens a real D2L sign-in window; resolves once the session works or the window is closed. */
export function signIn(): Promise<D2LStatus> {
  if (loginWindow && !loginWindow.isDestroyed()) {
    loginWindow.focus();
    return status();
  }
  versions = null;
  return new Promise((resolve) => {
    const win = new BrowserWindow({
      width: 1040,
      height: 780,
      title: 'Sign in to D2L - Ultron',
      autoHideMenuBar: true,
      backgroundColor: '#ffffff',
      webPreferences: { partition: PARTITION, contextIsolation: true, nodeIntegration: false, sandbox: true },
    });
    loginWindow = win;
    // School SSO sometimes pops a window; keep it inside the same signed-in session.
    win.webContents.setWindowOpenHandler(({ url }) => {
      if (/^https:\/\//.test(url)) {
        return { action: 'allow', overrideBrowserWindowOptions: { autoHideMenuBar: true, webPreferences: { partition: PARTITION, sandbox: true } } };
      }
      return { action: 'deny' };
    });
    let settled = false;
    const finish = async () => {
      if (settled) return;
      settled = true;
      clearInterval(poll);
      await keepSignedIn().catch(() => 0);
      const s = await status();
      if (!win.isDestroyed()) win.close();
      loginWindow = null;
      emit('d2l:changed', s);
      resolve(s);
    };
    const poll = setInterval(async () => {
      if (win.isDestroyed()) return;
      if (!/\/d2l\/(home|le|lp)/.test(win.webContents.getURL())) return;
      const s = await status();
      if (s.signedIn) void finish();
    }, 2000);
    win.on('closed', () => { void finish(); });
    void win.loadURL(`${baseUrl()}/d2l/home`);
  });
}

export async function signOut(): Promise<D2LStatus> {
  await ses().clearStorageData();
  versions = null;
  coursesCache = null;
  const s = await status();
  emit('d2l:changed', s);
  return s;
}

export function openInBrowser(): void {
  void shell.openExternal(`${baseUrl()}/d2l/home`);
}

function page<T>(data: unknown): T[] {
  if (Array.isArray(data)) return data as T[];
  const d = data as { Objects?: T[]; Items?: T[] } | null;
  return d?.Objects ?? d?.Items ?? [];
}

export async function courses(): Promise<D2LCourse[]> {
  if (coursesCache && Date.now() - coursesCache.at < 10 * 60_000) return coursesCache.list;
  const v = await apiVersions();
  const list: D2LCourse[] = [];
  let bookmark = '';
  for (let i = 0; i < 5; i++) {
    const data = await getJson<{ PagingInfo?: { Bookmark?: string; HasMoreItems?: boolean }; Items?: { OrgUnit: { Id: number; Name: string; Code?: string }; Access?: { IsActive?: boolean; CanAccess?: boolean; EndDate?: string | null } }[] }>(
      `/d2l/api/lp/${v.lp}/enrollments/myenrollments/?orgUnitTypeId=3${bookmark ? `&bookmark=${encodeURIComponent(bookmark)}` : ''}`,
    );
    for (const item of data.Items ?? []) {
      const ended = item.Access?.EndDate ? Date.parse(item.Access.EndDate) < Date.now() : false;
      list.push({
        id: item.OrgUnit.Id,
        name: item.OrgUnit.Name,
        code: item.OrgUnit.Code ?? '',
        active: Boolean(item.Access?.IsActive ?? true) && item.Access?.CanAccess !== false && !ended,
      });
    }
    if (!data.PagingInfo?.HasMoreItems || !data.PagingInfo.Bookmark) break;
    bookmark = data.PagingInfo.Bookmark;
  }
  coursesCache = { at: Date.now(), list };
  return list;
}

function matchCourse(list: D2LCourse[], query?: string): D2LCourse[] {
  const active = list.filter((c) => c.active);
  if (!query?.trim()) return active.length ? active : list;
  const q = query.toLowerCase();
  const hits = list.filter((c) => c.name.toLowerCase().includes(q) || c.code.toLowerCase().includes(q));
  return hits.length ? hits : active;
}

const ACTIVITY: Record<number, string> = { 1: 'content', 2: 'assignment', 3: 'quiz', 4: 'discussion', 5: 'survey', 6: 'checklist', 7: 'self-assessment' };

function utc(d: Date): string {
  return d.toISOString().replace(/\.\d{3}Z$/, '.000Z');
}

export async function dueItems(daysAhead = 14, courseQuery?: string): Promise<D2LDueItem[]> {
  const v = await apiVersions();
  const all = await courses();
  const scope = matchCourse(all, courseQuery);
  const names = new Map(all.map((c) => [c.id, c.name]));
  const start = new Date(Date.now() - 24 * 3600_000);
  const end = new Date(Date.now() + Math.max(1, daysAhead) * 24 * 3600_000);
  const ids = scope.map((c) => c.id).join(',');
  const out: D2LDueItem[] = [];
  const seen = new Set<string>();
  const push = (item: D2LDueItem) => {
    const key = `${item.courseId}|${item.name.toLowerCase()}|${item.due ?? ''}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push(item);
  };

  try {
    const data = await getJson<unknown>(`/d2l/api/le/${v.le}/content/myItems/due/?orgUnitIdsCSV=${ids}&startDateTime=${utc(start)}&endDateTime=${utc(end)}`);
    for (const it of page<{ OrgUnitId: number; ItemName: string; DueDate?: string | null; EndDate?: string | null; ActivityType?: number; ItemUrl?: string; DateCompleted?: string | null; IsExempt?: boolean }>(data)) {
      if (it.IsExempt) continue;
      push({
        course: names.get(it.OrgUnitId) ?? `Course ${it.OrgUnitId}`,
        courseId: it.OrgUnitId,
        name: it.ItemName,
        due: it.DueDate ?? it.EndDate ?? null,
        type: ACTIVITY[it.ActivityType ?? 0] ?? 'item',
        completed: Boolean(it.DateCompleted),
        url: it.ItemUrl,
      });
    }
  } catch (e) {
    if (e instanceof D2LAuthError) throw e;
    /* not every Brightspace exposes myItems - fall back to per-course assignment folders */
  }

  // Assignment folders carry due dates even where myItems is thin or disabled.
  for (const c of scope.slice(0, 15)) {
    try {
      const folders = await getJson<{ Id: number; Name: string; DueDate?: string | null; IsHidden?: boolean }[]>(`/d2l/api/le/${v.le}/${c.id}/dropbox/folders/`);
      for (const f of folders) {
        if (f.IsHidden || !f.DueDate) continue;
        const due = Date.parse(f.DueDate);
        if (due < start.getTime() || due > end.getTime()) continue;
        push({ course: c.name, courseId: c.id, name: f.Name, due: f.DueDate, type: 'assignment', completed: false });
      }
    } catch (e) {
      if (e instanceof D2LAuthError) throw e;
    }
  }
  return out.sort((a, b) => (a.due ? Date.parse(a.due) : Infinity) - (b.due ? Date.parse(b.due) : Infinity));
}

export async function overdue(): Promise<D2LDueItem[]> {
  const v = await apiVersions();
  const all = await courses();
  const names = new Map(all.map((c) => [c.id, c.name]));
  try {
    const data = await getJson<unknown>(`/d2l/api/le/${v.le}/overdueItems/myItems?orgUnitIdsCSV=${matchCourse(all).map((c) => c.id).join(',')}`);
    return page<{ OrgUnitId: number; ItemName: string; DueDate?: string | null }>(data).map((it) => ({
      course: names.get(it.OrgUnitId) ?? `Course ${it.OrgUnitId}`,
      courseId: it.OrgUnitId,
      name: it.ItemName,
      due: it.DueDate ?? null,
      type: 'overdue',
      completed: false,
    }));
  } catch (e) {
    if (e instanceof D2LAuthError) throw e;
    return [];
  }
}

export async function grades(courseQuery?: string): Promise<{ course: string; final?: string; items: { name: string; grade: string; points?: string }[] }[]> {
  const v = await apiVersions();
  const scope = matchCourse(await courses(), courseQuery).slice(0, 12);
  const out: { course: string; final?: string; items: { name: string; grade: string; points?: string }[] }[] = [];
  for (const c of scope) {
    try {
      const values = await getJson<{ GradeObjectName: string; DisplayedGrade?: string; PointsNumerator?: number | null; PointsDenominator?: number | null }[]>(
        `/d2l/api/le/${v.le}/${c.id}/grades/values/myGradeValues/`,
      );
      let final: string | undefined;
      try {
        const f = await getJson<{ DisplayedGrade?: string }>(`/d2l/api/le/${v.le}/${c.id}/grades/final/values/myGradeValue`);
        final = f.DisplayedGrade?.trim() || undefined;
      } catch { /* final grade often hidden */ }
      out.push({
        course: c.name,
        final,
        items: values.map((g) => ({
          name: g.GradeObjectName,
          grade: (g.DisplayedGrade ?? '').trim() || '-',
          points: g.PointsDenominator ? `${g.PointsNumerator ?? '?'}/${g.PointsDenominator}` : undefined,
        })),
      });
    } catch (e) {
      if (e instanceof D2LAuthError) throw e;
      out.push({ course: c.name, items: [] });
    }
  }
  return out;
}

function htmlToText(html: string): string {
  return html
    .replace(/<(br|\/p|\/div|\/li|\/h\d)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#39;|&rsquo;/g, "'")
    .replace(/&quot;|&ldquo;|&rdquo;/g, '"')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export async function announcements(courseQuery?: string, limit = 8): Promise<{ course: string; title: string; date: string | null; text: string }[]> {
  const v = await apiVersions();
  const scope = matchCourse(await courses(), courseQuery).slice(0, 12);
  const out: { course: string; title: string; date: string | null; text: string }[] = [];
  for (const c of scope) {
    try {
      const items = await getJson<{ Title: string; StartDate?: string | null; Body?: { Text?: string; Html?: string }; IsPublished?: boolean }[]>(`/d2l/api/le/${v.le}/${c.id}/news/`);
      for (const n of items) {
        if (n.IsPublished === false) continue;
        const text = n.Body?.Text?.trim() || htmlToText(n.Body?.Html ?? '');
        out.push({ course: c.name, title: n.Title, date: n.StartDate ?? null, text: text.slice(0, 1200) });
      }
    } catch (e) {
      if (e instanceof D2LAuthError) throw e;
    }
  }
  return out.sort((a, b) => (b.date ?? '').localeCompare(a.date ?? '')).slice(0, Math.min(limit, 30));
}

/** Copies upcoming D2L due dates into Ultron's own task list (with reminders), skipping ones already there. */
export async function syncToTasks(daysAhead = 21): Promise<{ added: string[]; skipped: number }> {
  const items = (await dueItems(daysAhead)).filter((i) => !i.completed && i.due && Date.parse(i.due) > Date.now());
  const existing = tasks.listTasks('all').map((t) => t.title.toLowerCase());
  const added: string[] = [];
  let skipped = 0;
  for (const it of items) {
    const title = `${it.name} (${it.course})`;
    if (existing.includes(title.toLowerCase())) { skipped++; continue; }
    const due = new Date(it.due!);
    // Remind the evening before, or 3 hours before if it's due sooner than that.
    const eveningBefore = new Date(due);
    eveningBefore.setDate(eveningBefore.getDate() - 1);
    eveningBefore.setHours(18, 0, 0, 0);
    const remind = eveningBefore.getTime() > Date.now() ? eveningBefore : new Date(Math.max(Date.now() + 60_000, due.getTime() - 3 * 3600_000));
    tasks.addTask({
      title,
      due: due.toISOString(),
      remindAt: remind.toISOString(),
      notes: `From D2L (${it.type}).${it.url ? ` ${baseUrl()}${it.url.startsWith('/') ? it.url : `/${it.url}`}` : ''}`,
      priority: due.getTime() - Date.now() < 48 * 3600_000 ? 'high' : 'normal',
      source: 'ultron',
    });
    existing.push(title.toLowerCase());
    added.push(title);
  }
  return { added, skipped };
}

export function isAuthError(e: unknown): boolean {
  return e instanceof D2LAuthError;
}

/* ── Everything else on D2L, read-only (School, build step 4) ──────────────
   Course content (modules and topics, and the files inside them), assignment instructions and
   attachments, his own submissions with the teacher's published feedback, grade comments, the
   calendar and quiz dates. Nothing here posts, submits or changes anything on D2L - these are
   all GET requests over the session he signed in with.                                  */

export interface D2LTopic {
  courseId: number; course: string;
  /** "Unit 2 > Lesson 3" */
  module: string;
  title: string; topicId: number;
  kind: 'file' | 'html' | 'link' | 'other';
  url?: string; modified?: string;
}

interface TocTopic { TopicId: number; Title: string; Url?: string; TypeIdentifier?: string; IsHidden?: boolean; IsBroken?: boolean; IsExempt?: boolean; LastModifiedDate?: string | null }
interface TocModule { ModuleId: number; Title: string; Modules?: TocModule[]; Topics?: TocTopic[]; IsHidden?: boolean }

/** The table of contents, flattened to topics with their module path. Pure, for tests. */
export function flattenToc(toc: { Modules?: TocModule[] }, courseId: number, course: string): D2LTopic[] {
  const out: D2LTopic[] = [];
  const walk = (mods: TocModule[] = [], path: string[]) => {
    for (const m of mods) {
      if (m.IsHidden) continue;
      const here = [...path, m.Title.trim()];
      for (const t of m.Topics ?? []) {
        if (t.IsHidden || t.IsBroken) continue;
        const type = (t.TypeIdentifier ?? '').toLowerCase();
        const url = t.Url ?? undefined;
        const kind: D2LTopic['kind'] = type === 'link' ? 'link' : type === 'file' ? (/\.html?(\?|$)/i.test(url ?? '') ? 'html' : 'file') : 'other';
        out.push({ courseId, course, module: here.join(' > '), title: t.Title.trim(), topicId: t.TopicId, kind, url, modified: t.LastModifiedDate ?? undefined });
      }
      walk(m.Modules, here);
    }
  };
  walk(toc.Modules, []);
  return out;
}

const tocCache = new Map<number, { at: number; topics: D2LTopic[] }>();

export async function contents(courseQuery?: string): Promise<{ course: string; courseId: number; topics: D2LTopic[] }[]> {
  const v = await apiVersions();
  const scope = matchCourse(await courses(), courseQuery).slice(0, 12);
  const out: { course: string; courseId: number; topics: D2LTopic[] }[] = [];
  for (const c of scope) {
    const hit = tocCache.get(c.id);
    if (hit && Date.now() - hit.at < 15 * 60_000) { out.push({ course: c.name, courseId: c.id, topics: hit.topics }); continue; }
    try {
      const toc = await getJson<{ Modules?: TocModule[] }>(`/d2l/api/le/${v.le}/${c.id}/content/toc`);
      const topics = flattenToc(toc, c.id, c.name);
      tocCache.set(c.id, { at: Date.now(), topics });
      out.push({ course: c.name, courseId: c.id, topics });
    } catch (e) {
      if (e instanceof D2LAuthError) throw e;
      out.push({ course: c.name, courseId: c.id, topics: [] });
    }
  }
  return out;
}

const MAX_FILE = 25 * 1024 * 1024;

/** The file name from a Content-Disposition header (either form), or null. Pure, for tests. */
export function dispositionName(cd: string): string | null {
  const star = /filename\*\s*=\s*(?:UTF-8|utf-8)?'[^']*'([^;]+)/.exec(cd)?.[1];
  if (star) { try { return decodeURIComponent(star.trim()); } catch { return star.trim(); } }
  const plain = /filename\s*=\s*"?([^";]+)"?/i.exec(cd)?.[1];
  return plain ? plain.trim() : null;
}

/** A file from D2L as bytes, with its name and type. Login pages are caught, not read as files. */
async function getFile(path: string): Promise<{ buf: Buffer; name: string; type: string }> {
  const res = await ses().fetch(`${baseUrl()}${path}`, { credentials: 'include', redirect: 'follow' });
  if (res.status === 401 || res.status === 403 || /\/d2l\/login|saml|\/adfs\/|login\.microsoftonline/i.test(res.url)) {
    throw new D2LAuthError('Not signed in to D2L (or the session expired). Sign in from the Apps panel.');
  }
  if (!res.ok) throw new Error(`D2L ${res.status} on ${path.split('?')[0]}`);
  const len = Number(res.headers.get('content-length') ?? 0);
  if (len > MAX_FILE) throw new Error(`that file is ${Math.round(len / 1048576)} MB - too big to read here`);
  const buf = Buffer.from(await res.arrayBuffer());
  const name = dispositionName(res.headers.get('content-disposition') ?? '') ?? path.split('?')[0].split('/').pop() ?? 'file';
  return { buf, name, type: res.headers.get('content-type') ?? '' };
}

/* ── Going through D2L freely, read-only (12 Oct 2026) ────────────────────
   Any D2L page or file, over his own sign-in, the way a browser would GET
   it - but never a click, a form or a post, so nothing can be submitted,
   started or changed. The few addresses that DO something when merely
   opened (logging out, starting or continuing a quiz attempt, submitting,
   deleting...) are refused outright.                                      */

const UNSAFE = [
  /logout|logoff|signout/i,
  /\/quizzing\/user\/(?!quizzes_list|quiz_summary)/i, // a quiz attempt starts by opening it
  /quiz_start|attempt\.d2l|\/attempts?\/(?:new|start)/i,
  /\/survey\/user\/(?:attempt|survey_start)/i,
  /\/selfassessments?\/.*\b(?:attempt|start)/i,
  /submit/i,
  /(?:^|[/_?&=-])(?:delete|remove|unenroll|subscribe|unsubscribe|markasread|markread|mark_read|markcomplete|setcomplete|togglecomplete)(?:[/_?&=.-]|$)/i,
];

/** Whether an address is a D2L page that is safe to open (read-only). Pure, for tests. */
export function isSafeD2lUrl(url: string, base = baseUrl()): boolean {
  let u: URL;
  try { u = new URL(url, base); } catch { return false; }
  if (u.origin !== new URL(base).origin) return false;
  const where = `${u.pathname}${u.search}`;
  return !UNSAFE.some((re) => re.test(where));
}

export interface D2LPage { url: string; contentType?: string; html?: string; buf?: Buffer; name?: string; offsite?: boolean }

/** One D2L page or file by address (full, or a path like /d2l/home/12345). Redirects off D2L are handed back to be read elsewhere. */
export async function fetchPage(input: string): Promise<D2LPage> {
  const url = new URL(input.trim(), `${baseUrl()}/`).href;
  if (!isSafeD2lUrl(url)) {
    if (new URL(url).origin !== new URL(baseUrl()).origin) throw new Error('That is not a D2L address.');
    throw new Error('That D2L address does something when it is opened (a quiz attempt, a submission, signing out...) - Ultron only reads D2L, so it won\'t open it.');
  }
  const res = await ses().fetch(url, { credentials: 'include', redirect: 'follow' });
  // Electron leaves the final address blank when there was no redirect.
  const at = res.url || url;
  if (res.status === 401 || res.status === 403 || /\/d2l\/login|saml|\/adfs\/|login\.microsoftonline/i.test(at)) {
    throw new D2LAuthError('Not signed in to D2L (or the session expired). Sign in from the Apps panel.');
  }
  if (new URL(at).origin !== new URL(baseUrl()).origin) return { url: at, offsite: true };
  if (!isSafeD2lUrl(at)) throw new Error('D2L sent that link on to a page that does something when opened - Ultron won\'t follow it.');
  if (!res.ok) throw new Error(`D2L ${res.status} on ${new URL(at).pathname}`);
  const type = res.headers.get('content-type') ?? '';
  if (/html/i.test(type)) return { url: at, contentType: type, html: await res.text() };
  const len = Number(res.headers.get('content-length') ?? 0);
  if (len > MAX_FILE) throw new Error(`that file is ${Math.round(len / 1048576)} MB - too big to read here`);
  const buf = Buffer.from(await res.arrayBuffer());
  const name = dispositionName(res.headers.get('content-disposition') ?? '') ?? decodeURIComponent(new URL(at).pathname.split('/').pop() || 'file');
  return { url: at, contentType: type, buf, name };
}

/**
 * Any of Brightspace's own read API (GET only): discussions, news, grades, checklists, rubrics,
 * calendars... `{lp}` and `{le}` in the path become the right API versions. A path that is a
 * file (…/file) comes back as the file, for the reader.
 */
export async function api(pathIn: string): Promise<{ json: unknown } | { file: { buf: Buffer; name: string; type: string } }> {
  const v = await apiVersions();
  const p = pathIn.trim().replace(/\{lp\}/g, v.lp).replace(/\{le\}/g, v.le);
  if (!/^\/d2l\/api\//.test(p)) throw new Error('d2l_api only takes paths that start with /d2l/api/.');
  if (!isSafeD2lUrl(p)) throw new Error('That API path is one Ultron does not open.');
  if (/\/file(\?|$)|\/attachments?\/\d+(\?|$)|\/download(\?|$)/i.test(p)) return { file: await getFile(p) };
  return { json: await getJson<unknown>(p) };
}

/** One content topic as text: a file read through the document reader, a page as text, a link as its address. */
export async function readTopic(courseId: number, topicId: number): Promise<{ title: string; course: string; module: string; kind: string; text: string; url?: string; truncated?: boolean } | { error: string }> {
  const v = await apiVersions();
  const course = (await courses()).find((c) => c.id === courseId);
  if (!course) return { error: 'No course with that id - list courses or content first.' };
  const known = (await contents(course.name)).flatMap((c) => c.topics).find((t) => t.topicId === topicId);
  if (!known) return { error: 'That topic is not in the course content (it may be hidden or removed).' };
  if (known.kind === 'link') {
    // 12 Oct 2026: links are read too - a teacher's Google Doc or Slides, a YouTube lesson, a web page.
    const { readLink } = await import('./reader');
    const r = known.url ? await readLink(known.url) : { error: 'This link topic has no address.' };
    if ('error' in r) {
      return { title: known.title, course: course.name, module: known.module, kind: 'link', url: known.url, text: `This topic is a link: ${known.url ?? '(no address)'}. It could not be read here: ${r.error}` };
    }
    return { title: known.title, course: course.name, module: known.module, kind: `link - ${r.kind}`, url: known.url, text: r.text, truncated: r.truncated };
  }
  if (known.kind === 'other') return { error: `"${known.title}" is an activity (a quiz, discussion or similar), not a file - it can't be read as text.` };
  const { readBytes } = await import('./reader');
  const f = await getFile(`/d2l/api/le/${v.le}/${courseId}/content/topics/${topicId}/file?stream=true`);
  const r = await readBytes(f.buf, f.name || known.url || known.title, f.type);
  if ('error' in r) return r;
  return { title: known.title, course: course.name, module: known.module, kind: r.kind, text: r.text, truncated: r.truncated };
}

export interface D2LAssignment {
  course: string; courseId: number; folderId: number; name: string;
  due: string | null; instructions: string; attachments: { fileId: number; name: string }[];
  outOf?: number; rubrics: string[];
  /** His own: when he submitted (latest), and the teacher's published feedback. */
  submittedAt?: string; score?: number | null; feedback?: string; graded?: boolean;
}

interface DropboxFolder { Id: number; Name: string; DueDate?: string | null; IsHidden?: boolean; CustomInstructions?: { Text?: string; Html?: string }; Attachments?: { FileId: number; FileName: string }[]; Assessment?: { ScoreDenominator?: number | null; Rubrics?: { Name?: string }[] } }
interface MySubmission { Submissions?: { SubmissionDate?: string }[]; Feedback?: { Score?: number | null; Feedback?: { Text?: string; Html?: string }; IsGraded?: boolean } | null; CompletionDate?: string | null }

/** A folder plus his own submissions, as one assignment. Pure, for tests. */
export function toAssignment(course: { id: number; name: string }, f: DropboxFolder, mine: MySubmission[] = []): D2LAssignment {
  const a: D2LAssignment = {
    course: course.name, courseId: course.id, folderId: f.Id, name: f.Name, due: f.DueDate ?? null,
    instructions: (f.CustomInstructions?.Text?.trim() || htmlToText(f.CustomInstructions?.Html ?? '')).slice(0, 6000),
    attachments: (f.Attachments ?? []).map((x) => ({ fileId: x.FileId, name: x.FileName })),
    outOf: f.Assessment?.ScoreDenominator ?? undefined,
    rubrics: (f.Assessment?.Rubrics ?? []).map((r) => r.Name ?? '').filter(Boolean),
  };
  const subs = mine.flatMap((m) => m.Submissions ?? []).map((s) => s.SubmissionDate).filter((d): d is string => Boolean(d)).sort();
  a.submittedAt = subs[subs.length - 1];
  const fb = mine.find((m) => m.Feedback)?.Feedback;
  if (fb) {
    a.score = fb.Score ?? null;
    a.feedback = (fb.Feedback?.Text?.trim() || htmlToText(fb.Feedback?.Html ?? '')).slice(0, 4000) || undefined;
    a.graded = fb.IsGraded;
  }
  return a;
}

export async function assignments(courseQuery?: string, withMine = true): Promise<D2LAssignment[]> {
  const v = await apiVersions();
  const scope = matchCourse(await courses(), courseQuery).slice(0, 12);
  const out: D2LAssignment[] = [];
  for (const c of scope) {
    let folders: DropboxFolder[] = [];
    try { folders = await getJson<DropboxFolder[]>(`/d2l/api/le/${v.le}/${c.id}/dropbox/folders/`); } catch (e) { if (e instanceof D2LAuthError) throw e; continue; }
    for (const f of folders.filter((x) => !x.IsHidden).slice(0, 40)) {
      let mine: MySubmission[] = [];
      if (withMine) {
        try { mine = await getJson<MySubmission[]>(`/d2l/api/le/${v.le}/${c.id}/dropbox/folders/${f.Id}/submissions/mysubmissions/`); } catch (e) { if (e instanceof D2LAuthError) throw e; }
      }
      out.push(toAssignment({ id: c.id, name: c.name }, f, mine));
    }
  }
  return out.sort((x, y) => (y.due ?? '').localeCompare(x.due ?? ''));
}

/** An assignment's attached file (the worksheet, the rubric PDF), read as text. */
export async function readAttachment(courseId: number, folderId: number, fileId: number): Promise<{ name: string; kind: string; text: string; truncated?: boolean } | { error: string }> {
  const v = await apiVersions();
  const { readBytes } = await import('./reader');
  const f = await getFile(`/d2l/api/le/${v.le}/${courseId}/dropbox/folders/${folderId}/attachments/${fileId}`);
  const r = await readBytes(f.buf, f.name, f.type);
  return 'error' in r ? r : { name: f.name, kind: r.kind, text: r.text, truncated: r.truncated };
}

/** Marks with the teacher's comments - from the gradebook and from assignment feedback. */
export async function feedback(courseQuery?: string): Promise<{ course: string; item: string; grade: string; comment: string; source: 'gradebook' | 'assignment' }[]> {
  const v = await apiVersions();
  const scope = matchCourse(await courses(), courseQuery).slice(0, 12);
  const out: { course: string; item: string; grade: string; comment: string; source: 'gradebook' | 'assignment' }[] = [];
  for (const c of scope) {
    try {
      const values = await getJson<{ GradeObjectName: string; DisplayedGrade?: string; Comments?: { Text?: string; Html?: string } }[]>(`/d2l/api/le/${v.le}/${c.id}/grades/values/myGradeValues/`);
      for (const g of values) {
        const comment = (g.Comments?.Text?.trim() || htmlToText(g.Comments?.Html ?? '')).slice(0, 3000);
        if (comment) out.push({ course: c.name, item: g.GradeObjectName, grade: (g.DisplayedGrade ?? '').trim() || '-', comment, source: 'gradebook' });
      }
    } catch (e) { if (e instanceof D2LAuthError) throw e; }
  }
  for (const a of await assignments(courseQuery)) {
    if (a.feedback) out.push({ course: a.course, item: a.name, grade: a.score !== undefined && a.score !== null ? `${a.score}${a.outOf ? `/${a.outOf}` : ''}` : '-', comment: a.feedback, source: 'assignment' });
  }
  return out;
}

export interface D2LEvent { course: string; title: string; start: string | null; end: string | null; kind: string }

export async function calendar(daysAhead = 21): Promise<D2LEvent[]> {
  const v = await apiVersions();
  const all = await courses();
  const start = new Date(Date.now() - 24 * 3600_000);
  const end = new Date(Date.now() + Math.max(1, daysAhead) * 24 * 3600_000);
  try {
    const data = await getJson<unknown>(`/d2l/api/le/${v.le}/calendar/events/myEvents/?orgUnitIdsCSV=${matchCourse(all).map((c) => c.id).join(',')}&startDateTime=${utc(start)}&endDateTime=${utc(end)}`);
    return page<{ Title: string; StartDateTime?: string | null; EndDateTime?: string | null; OrgUnitName?: string; AssociatedEntity?: { AssociatedEntityType?: string } | null }>(data)
      .map((e) => ({ course: e.OrgUnitName ?? '', title: e.Title, start: e.StartDateTime ?? null, end: e.EndDateTime ?? null, kind: (e.AssociatedEntity?.AssociatedEntityType ?? 'event').replace(/^D2L\.LE\./, '').toLowerCase() }))
      .sort((a, b) => (a.start ?? '').localeCompare(b.start ?? ''));
  } catch (e) {
    if (e instanceof D2LAuthError) throw e;
    return [];
  }
}

export interface D2LQuiz { course: string; courseId: number; name: string; start: string | null; end: string | null; due: string | null; openNow: boolean }

/** Whether a quiz is open right now, from its window. Pure, for tests. */
export function quizOpen(q: { StartDate?: string | null; EndDate?: string | null; DueDate?: string | null }, now = Date.now()): boolean {
  const s = q.StartDate ? Date.parse(q.StartDate) : -Infinity;
  const e = q.EndDate ? Date.parse(q.EndDate) : q.DueDate ? Date.parse(q.DueDate) : Infinity;
  return s <= now && now <= e && Number.isFinite(e);
}

/** Quiz names and dates only - never the questions. "openNow" is what the live-quiz rule checks. */
export async function quizzes(courseQuery?: string, now = Date.now()): Promise<D2LQuiz[]> {
  const v = await apiVersions();
  const scope = matchCourse(await courses(), courseQuery).slice(0, 12);
  const out: D2LQuiz[] = [];
  for (const c of scope) {
    try {
      const data = await getJson<unknown>(`/d2l/api/le/${v.le}/${c.id}/quizzes/`);
      for (const q of page<{ Name: string; IsActive?: boolean; StartDate?: string | null; EndDate?: string | null; DueDate?: string | null }>(data)) {
        if (q.IsActive === false) continue;
        out.push({ course: c.name, courseId: c.id, name: q.Name, start: q.StartDate ?? null, end: q.EndDate ?? null, due: q.DueDate ?? null, openNow: quizOpen(q, now) });
      }
    } catch (e) { if (e instanceof D2LAuthError) throw e; }
  }
  return out;
}

/** His own submissions to one assignment folder (and any published feedback) - for the on-time count. */
export async function mySubmission(courseId: number, folderId: number): Promise<{ submittedAt?: string; score?: number | null }> {
  const v = await apiVersions();
  const mine = await getJson<MySubmission[]>(`/d2l/api/le/${v.le}/${courseId}/dropbox/folders/${folderId}/submissions/mysubmissions/`);
  const a = toAssignment({ id: courseId, name: '' }, { Id: folderId, Name: '' }, mine);
  return { submittedAt: a.submittedAt, score: a.score };
}
