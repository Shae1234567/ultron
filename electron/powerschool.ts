import { BrowserWindow, session, shell, type Session } from 'electron';
import { getSettings } from './store';
import { emit } from './brain/events';
import { keepAlive, keepAll, watchSession, type AliveResult, type KeepAlive } from './keepSession';
import { htmlText } from './docs';

/*
 * PowerSchool - CBE's student information system, "MyCBE" (sis.cbe.ab.ca): report-card grades,
 * attendance and the timetable. There is no student API, so it works like D2L: he signs in
 * himself in a normal window (CBE ID and password, any 2-step check) and Ultron keeps only the
 * signed-in session, in its own cookie partition. It then reads his own pages, read-only.
 * Ultron never sees or stores the password, and never changes anything in PowerSchool.
 *
 * The pages are parsed where their layout is the standard PowerSchool one; where CBE's layout
 * differs, the page's text is returned instead so nothing is lost or guessed.
 */

const PARTITION = 'persist:powerschool';
let loginWindow: BrowserWindow | null = null;

export interface PSStatus { baseUrl: string; signedIn: boolean; error?: string }
export interface PSCourse { course: string; teacher?: string; room?: string; grades: Record<string, string>; absences?: number; tardies?: number }

const ses = (): Session => session.fromPartition(PARTITION);

export function baseUrl(): string {
  const raw = ((getSettings() as { powerschool?: { baseUrl?: string } }).powerschool?.baseUrl || 'https://sis.cbe.ab.ca').trim();
  return raw.replace(/\/+$/, '').replace(/\/(public|guardian)(\/.*)?$/, '');
}

class PSAuthError extends Error {}

async function page(path: string): Promise<string> {
  const res = await ses().fetch(`${baseUrl()}${path}`, { credentials: 'include', redirect: 'manual' });
  if (res.status === 401 || res.status === 403 || (res.status >= 300 && res.status < 400)) throw new PSAuthError('Not signed in to PowerSchool (or the session expired). Sign in from the Apps panel.');
  if (!res.ok) throw new Error(`PowerSchool ${res.status} on ${path}`);
  const html = await res.text();
  if (isLoginPage(html)) throw new PSAuthError('Not signed in to PowerSchool (or the session expired). Sign in from the Apps panel.');
  return html;
}

/** The sign-in form, rather than his pages. Pure, for tests. */
export function isLoginPage(html: string): boolean {
  return /id=["']?LoginForm|name=["']?pw["'\s>]|fieldPassword|\/public\/home\.html["'][^>]*>\s*sign in/i.test(html) && !/linkDescList|grid|scores\.html/i.test(html);
}

/** Re-saves the PowerSchool session cookies with an expiry date (keepSession.ts). */
export async function keepSignedIn(): Promise<void> {
  await keepAll(ses());
}

/** Every 8 minutes while Ultron is open - PowerSchool ends an idle sign-in after a short while. */
export const ALIVE_EVERY_MS = 8 * 60_000;
let alive: KeepAlive | null = null;
let lastSeen: PSStatus | null = null;

/** One keep-alive check: his home page, read-only. PowerSchool has no quiet re-sign-in - an ended session needs him. */
async function aliveCheck(): Promise<AliveResult> {
  if (!(await ses().cookies.get({}).catch(() => [])).length) return 'never';
  const s = await status();
  lastSeen = s;
  return s.signedIn ? 'ok' : s.error ? 'error' : 'lost';
}

/** From startup: save PowerSchool's cookies whenever it sets or renews them, and keep the sign-in from timing out. */
export function startKeeping(everyMs = ALIVE_EVERY_MS): void {
  watchSession(ses());
  if (alive) return;
  alive = keepAlive({
    check: aliveCheck,
    everyMs,
    firstAfterMs: Math.min(30_000, everyMs),
    // The screen flips to "not signed in" straight away, from the check that just ran.
    onLost: () => { if (lastSeen) emit('powerschool:changed', lastSeen); },
  });
  setInterval(() => void alive?.tick(), Math.min(60_000, everyMs / 2));
}

/** After the PC wakes or unlocks: check straight away rather than at the next tick. */
export function aliveNow(): void {
  void alive?.tick(true);
}

export async function status(): Promise<PSStatus> {
  try {
    await page('/guardian/home.html');
    void keepSignedIn();
    alive?.signedIn();
    return { baseUrl: baseUrl(), signedIn: true };
  } catch (e) {
    return { baseUrl: baseUrl(), signedIn: false, error: e instanceof PSAuthError ? undefined : e instanceof Error ? e.message : String(e) };
  }
}

/** A real PowerSchool sign-in window; resolves once his pages load or the window is closed. */
export function signIn(): Promise<PSStatus> {
  if (loginWindow && !loginWindow.isDestroyed()) { loginWindow.focus(); return status(); }
  return new Promise((resolve) => {
    const win = new BrowserWindow({
      width: 1040, height: 780, title: 'Sign in to PowerSchool (MyCBE) - Ultron', autoHideMenuBar: true, backgroundColor: '#ffffff',
      webPreferences: { partition: PARTITION, contextIsolation: true, nodeIntegration: false, sandbox: true },
    });
    loginWindow = win;
    win.webContents.setWindowOpenHandler(({ url }) => (/^https:\/\//.test(url)
      ? { action: 'allow', overrideBrowserWindowOptions: { autoHideMenuBar: true, webPreferences: { partition: PARTITION, sandbox: true } } }
      : { action: 'deny' }));
    let settled = false;
    const finish = async () => {
      if (settled) return;
      settled = true;
      clearInterval(poll);
      await keepSignedIn().catch(() => {});
      const s = await status();
      if (!win.isDestroyed()) win.close();
      loginWindow = null;
      emit('powerschool:changed', s);
      resolve(s);
    };
    const poll = setInterval(async () => {
      if (win.isDestroyed() || !/\/guardian\//.test(win.webContents.getURL())) return;
      if ((await status()).signedIn) void finish();
    }, 2000);
    win.on('closed', () => { void finish(); });
    void win.loadURL(`${baseUrl()}/public/home.html`);
  });
}

export async function signOut(): Promise<PSStatus> {
  await ses().clearStorageData();
  const s = await status();
  emit('powerschool:changed', s);
  return s;
}

export function openInBrowser(): void {
  void shell.openExternal(`${baseUrl()}/public/home.html`);
}

/* ── Reading his pages ─────────────────────────────────────────────── */

const cellText = (html: string) => htmlText(html.replace(/<br\s*\/?>/gi, ' ')).replace(/\s+/g, ' ').trim();

/**
 * The grades-and-attendance table on the standard PowerSchool home page: one row per class,
 * the course cell with the teacher's email link, then a cell per term (Q1, S1...), then
 * absences and tardies. Pure, for tests. Returns [] when the layout isn't the standard one.
 */
export function parseHome(html: string): PSCourse[] {
  const table = /<table[^>]*class="[^"]*linkDescList[^"]*"[^>]*>([\s\S]*?)<\/table>/i.exec(html)?.[1];
  if (!table) return [];
  const rows = table.match(/<tr\b[\s\S]*?<\/tr>/gi) ?? [];
  const head = rows.find((r) => /<th[^>]*>\s*Course\s*<\/th>/i.test(r));
  if (!head) return [];
  const labels = (head.match(/<th\b[\s\S]*?<\/th>/gi) ?? []).map(cellText);
  const after = labels.slice(labels.findIndex((l) => /^course$/i.test(l)) + 1);
  const out: PSCourse[] = [];
  for (const r of rows) {
    if (r === head || /<th/i.test(r)) continue;
    const cells = r.match(/<td\b[\s\S]*?<\/td>/gi) ?? [];
    const ci = cells.findIndex((c) => /mailto:|align="?left/i.test(c));
    if (ci < 0) continue;
    const raw = cells[ci];
    const teacher = /mailto:[^"']*["'][^>]*>([^<]+)</i.exec(raw)?.[1]?.trim();
    const room = /Rm:\s*([^<\s]+)/i.exec(raw)?.[1];
    const course = cellText(raw.split(/<br|Email|&nbsp;-|<a /i)[0]).replace(/\s*-?\s*Rm:.*$/i, '').trim();
    const grades: Record<string, string> = {};
    let absences: number | undefined;
    let tardies: number | undefined;
    cells.slice(ci + 1).forEach((c, i) => {
      const label = after[i] ?? `col ${i + 1}`;
      const text = cellText(c);
      if (/^absences?$/i.test(label)) absences = Number(text) || 0;
      else if (/^tard(ies|y)$/i.test(label)) tardies = Number(text) || 0;
      else if (text && !/^\[\s*i\s*\]$|^-+$|^\[\s*\]$/.test(text)) grades[label] = text;
    });
    if (course) out.push({ course, teacher, room, grades, absences, tardies });
  }
  return out;
}

export async function home(): Promise<{ courses: PSCourse[]; text?: string }> {
  const html = await page('/guardian/home.html');
  const courses = parseHome(html);
  // A layout this parser doesn't know: hand over the page text rather than nothing.
  return courses.length ? { courses } : { courses, text: htmlText(html).slice(0, 12_000) };
}

export async function schedule(): Promise<string> {
  for (const p of ['/guardian/myschedule.html', '/guardian/myschedulematrix.html']) {
    try { return htmlText(await page(p)).slice(0, 12_000); } catch (e) { if (e instanceof PSAuthError) throw e; }
  }
  return 'PowerSchool did not show a schedule page.';
}

export function isAuthError(e: unknown): boolean {
  return e instanceof PSAuthError;
}
