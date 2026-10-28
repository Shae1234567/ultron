import type { Session } from 'electron';

/*
 * Keeping the school sign-ins (D2L, PowerSchool) across restarts.
 *
 * Both sites - and the school's sign-on page D2L goes through - use session cookies (no expiry
 * date), which Chromium drops when the app quits. So each one is saved again with an expiry,
 * the same thing a browser's "continue where you left off" does. Ultron never sees or stores the
 * password; it only keeps what the site itself handed out, and the site still decides how long
 * that stays valid.
 *
 * 11 Oct 2026: cookies used to be re-saved only after signing in and at a clean quit, so a
 * cookie the site renewed while he used it was lost to a crash, a forced close or the PC
 * shutting down - and the next start asked him to sign in again. They're now saved the moment
 * the site sets them.
 */

const KEEP_DAYS = 30;

export type StoredCookie = Pick<Electron.Cookie, 'name' | 'value' | 'domain' | 'hostOnly' | 'path' | 'secure' | 'httpOnly' | 'sameSite' | 'session'>;

/** The same cookie, made to outlive the app: host-only cookies must not gain a domain. */
export function persistentCopy(c: StoredCookie, nowMs = Date.now()): Electron.CookiesSetDetails {
  const host = (c.domain ?? '').replace(/^\./, '');
  return {
    url: `${c.secure ? 'https' : 'http'}://${host}${c.path || '/'}`,
    name: c.name,
    value: c.value,
    ...(c.hostOnly ? {} : { domain: c.domain }),
    path: c.path || '/',
    secure: c.secure,
    httpOnly: c.httpOnly,
    sameSite: c.sameSite,
    expirationDate: Math.floor(nowMs / 1000) + KEEP_DAYS * 86400,
  };
}

/** Re-saves every session cookie in a partition with an expiry date. Returns how many. */
export async function keepAll(s: Session): Promise<number> {
  let kept = 0;
  for (const c of await s.cookies.get({})) {
    if (!c.session) continue;
    try {
      await s.cookies.set(persistentCopy(c));
      kept++;
    } catch {
      /* an unusual cookie the API won't re-set - the rest still count */
    }
  }
  await s.cookies.flushStore().catch(() => {});
  return kept;
}

const keyOf = (c: StoredCookie) => `${c.domain}|${c.path}|${c.name}`;
const watching = new WeakSet<object>();

/**
 * Saves each session cookie as soon as the site sets or renews it (batched over half a second).
 * A cookie the site deletes - signing out, or its own expiry - stays deleted. Returns a stop function.
 */
export function watchSession(s: Session, delayMs = 500): () => void {
  if (watching.has(s)) return () => {};
  watching.add(s);
  const pending = new Map<string, StoredCookie>();
  let timer: ReturnType<typeof setTimeout> | null = null;

  const flush = async () => {
    timer = null;
    const batch = [...pending.values()];
    pending.clear();
    for (const c of batch) {
      try { await s.cookies.set(persistentCopy(c)); } catch { /* the rest still count */ }
    }
    await s.cookies.flushStore().catch(() => {});
  };

  const onChange = (_e: unknown, cookie: Electron.Cookie, _cause: string, removed: boolean) => {
    if (removed) { pending.delete(keyOf(cookie)); return; }
    // Our own re-save comes back through here with an expiry, so it's left alone - no loop.
    if (!cookie.session) return;
    pending.set(keyOf(cookie), cookie);
    if (!timer) timer = setTimeout(() => void flush(), delayMs);
  };

  s.cookies.on('changed', onChange);
  return () => {
    s.cookies.removeListener('changed', onChange);
    watching.delete(s);
    if (timer) clearTimeout(timer);
  };
}

/* ── Keep-alive (11 Oct 2026, at his request) ─────────────────────────────
   The school's servers end a sign-in that sits idle (PowerSchool after a
   short while; D2L later), and a saved cookie can't bring an ended one back.
   So while Ultron is open it quietly checks each signed-in site every few
   minutes - one small read, like the sites' own pages do while left open.
   If a site has ended the session anyway (the PC was off or asleep), it
   says so once and only looks again hourly instead of every few minutes.  */

/** ok: still signed in. lost: the site ended it. error: couldn't reach it. never: not signed in here at all. */
export type AliveResult = 'ok' | 'lost' | 'error' | 'never';

export interface KeepAliveOptions {
  check: () => Promise<AliveResult>;
  /** How often while signed in. */
  everyMs: number;
  /** How often once the site has ended the session. */
  lostRetryMs?: number;
  /** The first check, this long after starting. */
  firstAfterMs?: number;
  /** Called once when a working sign-in turns out to have ended. */
  onLost?: () => void;
  now?: () => number;
}

export interface KeepAlive {
  /** Runs a check if one is due (or now, with force). Null when skipped. */
  tick(force?: boolean): Promise<AliveResult | null>;
  /** A sign-in worked (signed in again, or any good read): back to the normal pace. */
  signedIn(): void;
  readonly state: { lastCheck: number; lastOk?: number; lost: boolean };
}

export function keepAlive(o: KeepAliveOptions): KeepAlive {
  const now = o.now ?? Date.now;
  const state: KeepAlive['state'] = { lastCheck: now() - o.everyMs + (o.firstAfterMs ?? 30_000), lost: false };
  let running = false;
  const due = (t: number) => t - state.lastCheck >= (state.lost ? o.lostRetryMs ?? 3_600_000 : o.everyMs);

  return {
    state,
    signedIn() {
      state.lost = false;
      state.lastOk = now();
      state.lastCheck = now();
    },
    async tick(force = false) {
      if (running || (!force && !due(now()))) return null;
      running = true;
      try {
        const r = await o.check().catch((): AliveResult => 'error');
        state.lastCheck = now();
        if (r === 'ok') {
          state.lost = false;
          state.lastOk = state.lastCheck;
        } else if (r === 'lost' && !state.lost) {
          state.lost = true;
          o.onLost?.();
        }
        return r;
      } finally {
        running = false;
      }
    },
  };
}
