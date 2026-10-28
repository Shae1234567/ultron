import fs from 'node:fs';
import path from 'node:path';

/*
 * His game libraries, read from the launchers' own files on this PC - nothing signed in to,
 * nothing sent: Steam's library folders and app manifests (installed games, last played) and
 * its local config (playtime per game), and Epic's install manifests. Read-only.
 */

export interface Game { id: string; name: string; launcher: 'steam' | 'epic'; installDir?: string; lastPlayed?: number; playtimeMin?: number; sizeGb?: number; exe?: string }

type Vdf = { [k: string]: string | Vdf };

/** Valve's KeyValues text format ("key" "value" / "key" { ... }). Pure. */
export function parseVdf(text: string): Vdf {
  const root: Vdf = {};
  const stack: Vdf[] = [root];
  const re = /"((?:[^"\\]|\\.)*)"|([{}])/g;
  let key: string | null = null;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    const top = stack[stack.length - 1];
    if (m[2] === '{') {
      const child: Vdf = {};
      if (key !== null) top[key] = child;
      stack.push(child);
      key = null;
    } else if (m[2] === '}') {
      if (stack.length > 1) stack.pop();
      key = null;
    } else {
      const s = m[1].replace(/\\\\/g, '\\').replace(/\\"/g, '"');
      if (key === null) key = s;
      else { top[key] = s; key = null; }
    }
  }
  return root;
}

const get = (v: Vdf | string | undefined, ...keys: string[]): Vdf | string | undefined => {
  let cur: Vdf | string | undefined = v;
  for (const k of keys) {
    if (!cur || typeof cur === 'string') return undefined;
    const hit = Object.keys(cur).find((x) => x.toLowerCase() === k.toLowerCase());
    cur = hit ? cur[hit] : undefined;
  }
  return cur;
};

const NOT_GAMES = /redistributable|steamworks|proton|runtime|soundtrack|dedicated server|sdk\b/i;

export const STEAM_DIR = 'C:\\Program Files (x86)\\Steam';

export function steamGames(steamDir = STEAM_DIR): Game[] {
  const read = (p: string) => { try { return fs.readFileSync(p, 'utf8'); } catch { return ''; } };
  const libs = new Set<string>([steamDir]);
  const folders = parseVdf(read(path.join(steamDir, 'steamapps', 'libraryfolders.vdf')));
  const lf = get(folders, 'libraryfolders');
  if (lf && typeof lf !== 'string') for (const v of Object.values(lf)) { const p = get(v, 'path'); if (typeof p === 'string') libs.add(p); }
  // Playtime lives in each Steam user's local config.
  const playtime = new Map<string, { min: number; last: number }>();
  try {
    for (const user of fs.readdirSync(path.join(steamDir, 'userdata'))) {
      const apps = get(parseVdf(read(path.join(steamDir, 'userdata', user, 'config', 'localconfig.vdf'))), 'UserLocalConfigStore', 'Software', 'Valve', 'Steam', 'apps');
      if (!apps || typeof apps === 'string') continue;
      for (const [id, a] of Object.entries(apps)) {
        const min = Number(get(a, 'Playtime') ?? 0);
        const last = Number(get(a, 'LastPlayed') ?? 0);
        const prev = playtime.get(id);
        playtime.set(id, { min: Math.max(min, prev?.min ?? 0), last: Math.max(last, prev?.last ?? 0) });
      }
    }
  } catch { /* no Steam users on this PC */ }
  const out: Game[] = [];
  for (const lib of libs) {
    let files: string[] = [];
    try { files = fs.readdirSync(path.join(lib, 'steamapps')).filter((f) => /^appmanifest_\d+\.acf$/.test(f)); } catch { continue; }
    for (const f of files) {
      const st = get(parseVdf(read(path.join(lib, 'steamapps', f))), 'AppState');
      if (!st || typeof st === 'string') continue;
      const id = String(get(st, 'appid') ?? '');
      const name = String(get(st, 'name') ?? '');
      if (!id || !name || NOT_GAMES.test(name)) continue;
      const pt = playtime.get(id);
      const last = Math.max(Number(get(st, 'LastPlayed') ?? 0), pt?.last ?? 0);
      out.push({
        id, name, launcher: 'steam', installDir: path.join(lib, 'steamapps', 'common', String(get(st, 'installdir') ?? '')),
        lastPlayed: last ? last * 1000 : undefined, playtimeMin: pt?.min || undefined,
        sizeGb: Math.round(Number(get(st, 'SizeOnDisk') ?? 0) / 1e8) / 10 || undefined,
      });
    }
  }
  return out;
}

export const EPIC_MANIFESTS = 'C:\\ProgramData\\Epic\\EpicGamesLauncher\\Data\\Manifests';

export function epicGames(dir = EPIC_MANIFESTS): Game[] {
  let files: string[] = [];
  try { files = fs.readdirSync(dir).filter((f) => f.endsWith('.item')); } catch { return []; }
  const out: Game[] = [];
  for (const f of files) {
    try {
      const m = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')) as { DisplayName?: string; AppName?: string; InstallLocation?: string; LaunchExecutable?: string; InstallSize?: number; bIsApplication?: boolean };
      if (!m.DisplayName || m.bIsApplication === false) continue;
      out.push({ id: m.AppName ?? f, name: m.DisplayName, launcher: 'epic', installDir: m.InstallLocation, exe: m.LaunchExecutable ? path.basename(m.LaunchExecutable) : undefined, sizeGb: m.InstallSize ? Math.round(m.InstallSize / 1e8) / 10 : undefined });
    } catch { /* a half-written manifest - skip it */ }
  }
  return out;
}

export function allGames(): Game[] {
  return [...steamGames(), ...epicGames()].sort((a, b) => (b.lastPlayed ?? 0) - (a.lastPlayed ?? 0));
}

/** Patch notes and news for a Steam game (public, no key). */
export async function steamNews(appId: string, count = 3): Promise<{ title: string; date: number; url: string; text: string }[]> {
  const res = await fetch(`https://api.steampowered.com/ISteamNews/GetNewsForApp/v2/?appid=${encodeURIComponent(appId)}&count=${count}&maxlength=400&format=json`, { signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`Steam answered ${res.status}`);
  const body = (await res.json()) as { appnews?: { newsitems?: { title: string; date: number; url: string; contents?: string }[] } };
  return (body.appnews?.newsitems ?? []).map((n) => ({ title: n.title, date: n.date * 1000, url: n.url, text: (n.contents ?? '').replace(/\[[^\]]+\]|<[^>]+>/g, '').replace(/\s+/g, ' ').trim().slice(0, 400) }));
}

export interface FreeGame { title: string; until?: string; from?: string; url: string; now: boolean }

/** Epic's free games this week and next (their public store feed). Ultron never claims - he opens the page and clicks Get. Pure parse. */
export function parseEpicFree(body: unknown, now = Date.now()): FreeGame[] {
  type Offer = { startDate: string; endDate: string; discountSetting?: { discountPercentage?: number } };
  type El = { title: string; productSlug?: string | null; offerMappings?: { pageSlug: string }[]; catalogNs?: { mappings?: { pageSlug: string }[] }; promotions?: { promotionalOffers?: { promotionalOffers: Offer[] }[]; upcomingPromotionalOffers?: { promotionalOffers: Offer[] }[] } | null };
  const els = ((body as { data?: { Catalog?: { searchStore?: { elements?: El[] } } } })?.data?.Catalog?.searchStore?.elements ?? []);
  const out: FreeGame[] = [];
  for (const e of els) {
    const slug = e.offerMappings?.[0]?.pageSlug ?? e.catalogNs?.mappings?.[0]?.pageSlug ?? e.productSlug ?? '';
    const url = slug ? `https://store.epicgames.com/en-US/p/${slug.replace(/\/home$/, '')}` : 'https://store.epicgames.com/en-US/free-games';
    for (const o of (e.promotions?.promotionalOffers ?? []).flatMap((p) => p.promotionalOffers)) {
      if (o.discountSetting?.discountPercentage === 0 && Date.parse(o.startDate) <= now && now <= Date.parse(o.endDate)) out.push({ title: e.title, until: o.endDate, url, now: true });
    }
    for (const o of (e.promotions?.upcomingPromotionalOffers ?? []).flatMap((p) => p.promotionalOffers)) {
      if (o.discountSetting?.discountPercentage === 0) out.push({ title: e.title, from: o.startDate, until: o.endDate, url, now: false });
    }
  }
  return out;
}

export async function epicFreeGames(): Promise<FreeGame[]> {
  const res = await fetch('https://store-site-backend-static.ak.epicgames.com/freeGamesPromotions?locale=en-US&country=CA&allowCountries=CA', { signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`Epic answered ${res.status}`);
  return parseEpicFree(await res.json());
}
