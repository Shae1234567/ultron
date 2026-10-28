import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { keepAlive, watchSession, type AliveResult, type StoredCookie } from './keepSession';

type Cookie = StoredCookie & { expirationDate?: number };

/** A cookie jar that behaves like Electron's: setting an existing cookie fires an 'overwrite' removal, then the add. */
function fakeSession() {
  const jar = new Map<string, Cookie>();
  const cookies = Object.assign(new EventEmitter(), {
    sets: 0,
    get: async () => [...jar.values()],
    flushStore: async () => {},
    set: async (d: Electron.CookiesSetDetails) => {
      cookies.sets++;
      const domain = d.domain ?? new URL(d.url).hostname;
      put({ name: d.name!, value: d.value!, domain, hostOnly: !d.domain, path: d.path ?? '/', secure: Boolean(d.secure), httpOnly: Boolean(d.httpOnly), sameSite: d.sameSite ?? 'unspecified', session: !d.expirationDate, expirationDate: d.expirationDate });
    },
  });
  const key = (c: Cookie) => `${c.domain}|${c.path}|${c.name}`;
  const put = (c: Cookie) => {
    const old = jar.get(key(c));
    if (old) cookies.emit('changed', {}, old, 'overwrite', true);
    jar.set(key(c), c);
    cookies.emit('changed', {}, c, 'explicit', false);
  };
  const remove = (c: Cookie) => { jar.delete(key(c)); cookies.emit('changed', {}, c, 'explicit', true); };
  return { s: { cookies } as unknown as Electron.Session, jar, put, remove, cookies };
}

const sessionCookie = (name: string, value: string): Cookie => ({ name, value, domain: 'd2l.cbe.ab.ca', hostOnly: true, path: '/', secure: true, httpOnly: true, sameSite: 'no_restriction', session: true });

describe('watchSession (school sign-ins survive a crash or shutdown)', () => {
  afterEach(() => { vi.useRealTimers(); });

  it('saves a session cookie with an expiry as soon as the site sets it', async () => {
    vi.useFakeTimers();
    const f = fakeSession();
    const stop = watchSession(f.s, 500);
    f.put(sessionCookie('d2lSessionVal', 'first'));
    await vi.advanceTimersByTimeAsync(600);
    const saved = f.jar.get('d2l.cbe.ab.ca|/|d2lSessionVal');
    expect(saved?.session).toBe(false);
    expect(saved?.value).toBe('first');
    expect(saved?.expirationDate).toBeGreaterThan(Date.now() / 1000 + 29 * 86400);
    stop();
  });

  it('keeps the renewed value when the site renews the cookie', async () => {
    vi.useFakeTimers();
    const f = fakeSession();
    const stop = watchSession(f.s, 500);
    f.put(sessionCookie('d2lSessionVal', 'first'));
    await vi.advanceTimersByTimeAsync(600);
    f.put(sessionCookie('d2lSessionVal', 'renewed'));
    await vi.advanceTimersByTimeAsync(600);
    const saved = f.jar.get('d2l.cbe.ab.ca|/|d2lSessionVal');
    expect(saved?.value).toBe('renewed');
    expect(saved?.session).toBe(false);
    stop();
  });

  it('does not loop on its own re-save, and batches a burst of cookies', async () => {
    vi.useFakeTimers();
    const f = fakeSession();
    const stop = watchSession(f.s, 500);
    f.put(sessionCookie('a', '1'));
    f.put(sessionCookie('b', '2'));
    f.put(sessionCookie('c', '3'));
    await vi.advanceTimersByTimeAsync(5000);
    expect(f.cookies.sets).toBe(3);
    stop();
  });

  it('leaves a cookie the site deleted deleted (signing out still signs out)', async () => {
    vi.useFakeTimers();
    const f = fakeSession();
    const stop = watchSession(f.s, 500);
    const c = sessionCookie('d2lSessionVal', 'x');
    f.put(c);
    f.remove(c);
    await vi.advanceTimersByTimeAsync(600);
    expect(f.jar.has('d2l.cbe.ab.ca|/|d2lSessionVal')).toBe(false);
    expect(f.cookies.sets).toBe(0);
    stop();
  });

  it('leaves cookies the site already gave an expiry alone', async () => {
    vi.useFakeTimers();
    const f = fakeSession();
    const stop = watchSession(f.s, 500);
    f.put({ ...sessionCookie('pref', 'dark'), session: false, expirationDate: 1 });
    await vi.advanceTimersByTimeAsync(600);
    expect(f.cookies.sets).toBe(0);
    stop();
  });

  it('watches a partition only once', () => {
    const f = fakeSession();
    const stop1 = watchSession(f.s);
    const stop2 = watchSession(f.s);
    expect(f.cookies.listenerCount('changed')).toBe(1);
    stop2();
    stop1();
    expect(f.cookies.listenerCount('changed')).toBe(0);
  });
});

describe('keepAlive (school sign-ins do not time out while Ultron is open)', () => {
  const MIN = 60_000;
  const make = (results: AliveResult[], onLost = vi.fn()) => {
    let t = 1_000_000;
    const calls: number[] = [];
    const ka = keepAlive({
      check: async () => { calls.push(t); return results.shift() ?? 'ok'; },
      everyMs: 8 * MIN, lostRetryMs: 60 * MIN, firstAfterMs: 30_000, onLost, now: () => t,
    });
    return { ka, calls, onLost, advance: (ms: number) => { t += ms; } };
  };

  it('waits 30 s after start, then checks every 8 minutes', async () => {
    const k = make([]);
    expect(await k.ka.tick()).toBeNull();
    k.advance(30_000);
    expect(await k.ka.tick()).toBe('ok');
    k.advance(7 * MIN);
    expect(await k.ka.tick()).toBeNull();
    k.advance(1 * MIN);
    expect(await k.ka.tick()).toBe('ok');
    expect(k.calls).toHaveLength(2);
  });

  it('says once when the site ends the sign-in, then only looks hourly', async () => {
    const k = make(['ok', 'lost', 'lost', 'lost']);
    k.advance(30_000);
    await k.ka.tick();
    k.advance(8 * MIN);
    expect(await k.ka.tick()).toBe('lost');
    expect(k.onLost).toHaveBeenCalledTimes(1);
    k.advance(8 * MIN);
    expect(await k.ka.tick()).toBeNull();
    k.advance(52 * MIN);
    expect(await k.ka.tick()).toBe('lost');
    expect(k.onLost).toHaveBeenCalledTimes(1);
  });

  it('goes back to every 8 minutes once he signs in again', async () => {
    const k = make(['lost']);
    k.advance(30_000);
    await k.ka.tick();
    expect(k.ka.state.lost).toBe(true);
    k.ka.signedIn();
    k.advance(8 * MIN);
    expect(await k.ka.tick()).toBe('ok');
  });

  it('a network blip is not a lost sign-in', async () => {
    const k = make(['error']);
    k.advance(30_000);
    expect(await k.ka.tick()).toBe('error');
    expect(k.ka.state.lost).toBe(false);
    expect(k.onLost).not.toHaveBeenCalled();
  });

  it('checks straight away after the PC wakes (force), but never two at once', async () => {
    let release: () => void = () => {};
    let n = 0;
    const ka = keepAlive({ check: () => { n++; return new Promise<AliveResult>((r) => { release = () => r('ok'); }); }, everyMs: 8 * MIN });
    const first = ka.tick(true);
    expect(await ka.tick(true)).toBeNull();
    release();
    expect(await first).toBe('ok');
    expect(n).toBe(1);
  });

  it('a check that throws counts as an error, not a crash', async () => {
    const ka = keepAlive({ check: async () => { throw new Error('offline'); }, everyMs: 8 * MIN });
    expect(await ka.tick(true)).toBe('error');
  });
});
