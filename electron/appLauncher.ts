import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { shell } from 'electron';

/**
 * Opens anything installed on the PC by name: every Start-menu app (normal
 * programs and Microsoft Store apps alike, via Get-StartApps), Steam games
 * (from Steam's own library files), and well-known web apps when there is no
 * desktop app (ChatGPT, YouTube...). "chrome", "discord", "steam", "spotify",
 * "minecraft" all resolve the same way a person would find them in Start.
 */

const run = promisify(execFile);

export interface InstalledApp { name: string; id: string; kind: 'start' | 'steam' }

let cache: { at: number; apps: InstalledApp[] } | null = null;

async function startApps(): Promise<InstalledApp[]> {
  const { stdout } = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
    '[Console]::OutputEncoding=[Text.Encoding]::UTF8; Get-StartApps | Select-Object Name,AppID | ConvertTo-Json -Compress'], { windowsHide: true, maxBuffer: 8 * 1024 * 1024, timeout: 20_000 });
  const parsed = JSON.parse(stdout.trim() || '[]') as { Name?: string; AppID?: string } | { Name?: string; AppID?: string }[];
  return (Array.isArray(parsed) ? parsed : [parsed])
    .filter((a) => a.Name && a.AppID)
    .map((a) => ({ name: String(a.Name), id: String(a.AppID), kind: 'start' as const }));
}

/** Steam games from libraryfolders.vdf + appmanifest_*.acf (no Steam API, nothing leaves the PC). */
export function steamGamesIn(steamRoot: string): InstalledApp[] {
  const out: InstalledApp[] = [];
  const libs = new Set([path.join(steamRoot, 'steamapps')]);
  try {
    const vdf = fs.readFileSync(path.join(steamRoot, 'steamapps', 'libraryfolders.vdf'), 'utf8');
    for (const m of vdf.matchAll(/"path"\s+"([^"]+)"/g)) libs.add(path.join(m[1].replace(/\\\\/g, '\\'), 'steamapps'));
  } catch { /* only the main library */ }
  for (const lib of libs) {
    let files: string[] = [];
    try { files = fs.readdirSync(lib).filter((f) => /^appmanifest_\d+\.acf$/.test(f)); } catch { continue; }
    for (const f of files) {
      try {
        const acf = fs.readFileSync(path.join(lib, f), 'utf8');
        const id = /"appid"\s+"(\d+)"/.exec(acf)?.[1];
        const name = /"name"\s+"([^"]+)"/.exec(acf)?.[1];
        // Steam's own runtimes and redistributables are not games.
        if (id && name && !/^(steamworks|steam linux runtime|proton|steamvr)/i.test(name)) out.push({ name, id, kind: 'steam' });
      } catch { /* unreadable manifest */ }
    }
  }
  return out;
}

async function steamGames(): Promise<InstalledApp[]> {
  try {
    const { stdout } = await run('reg.exe', ['query', 'HKCU\\Software\\Valve\\Steam', '/v', 'SteamPath'], { windowsHide: true, timeout: 5000 });
    const root = /SteamPath\s+REG_SZ\s+(.+)/.exec(stdout)?.[1]?.trim();
    return root ? steamGamesIn(root.replace(/\//g, '\\')) : [];
  } catch {
    return [];
  }
}

export async function installedApps(fresh = false): Promise<InstalledApp[]> {
  if (!fresh && cache && Date.now() - cache.at < 10 * 60_000) return cache.apps;
  const [start, steam] = await Promise.all([startApps().catch(() => [] as InstalledApp[]), steamGames()]);
  const seen = new Set(start.map((a) => a.name.toLowerCase()));
  const apps = [...start, ...steam.filter((g) => !seen.has(g.name.toLowerCase()))];
  cache = { at: Date.now(), apps };
  return apps;
}

/** What people call apps vs. what Start calls them. */
const ALIASES: Record<string, string[]> = {
  chrome: ['google chrome'], 'google': ['google chrome'], edge: ['microsoft edge'], firefox: ['mozilla firefox', 'firefox'],
  opera: ['opera gx browser', 'opera browser', 'opera gx', 'opera'], 'opera gx': ['opera gx browser', 'opera gx'],
  word: ['word'], excel: ['excel'], powerpoint: ['powerpoint'], outlook: ['outlook'], onenote: ['onenote'], teams: ['microsoft teams', 'teams'],
  vscode: ['visual studio code'], 'vs code': ['visual studio code'], code: ['visual studio code'],
  explorer: ['file explorer'], files: ['file explorer'], 'file explorer': ['file explorer'],
  settings: ['settings'], calculator: ['calculator'], calc: ['calculator'], notepad: ['notepad'], paint: ['paint'],
  terminal: ['terminal', 'windows terminal'], cmd: ['command prompt'], 'task manager': ['task manager'], store: ['microsoft store'],
  camera: ['camera'], photos: ['photos'], clock: ['clock'], 'snipping tool': ['snipping tool'], xbox: ['xbox'],
  epic: ['epic games launcher'], 'epic games': ['epic games launcher'], battlenet: ['battle.net'], 'battle.net': ['battle.net'],
  obs: ['obs studio'], whatsapp: ['whatsapp'], chatgpt: ['chatgpt'], claude: ['claude'],
};

/** Web apps to open when there is no desktop app of that name. */
export const WEB_APPS: Record<string, string> = {
  chatgpt: 'https://chatgpt.com', claude: 'https://claude.ai', gemini: 'https://gemini.google.com',
  youtube: 'https://www.youtube.com', gmail: 'https://mail.google.com', 'google docs': 'https://docs.google.com',
  'google drive': 'https://drive.google.com', 'google calendar': 'https://calendar.google.com', netflix: 'https://www.netflix.com',
  instagram: 'https://www.instagram.com', tiktok: 'https://www.tiktok.com', twitter: 'https://x.com', x: 'https://x.com',
  reddit: 'https://www.reddit.com', twitch: 'https://www.twitch.tv', discord: 'https://discord.com/app',
  spotify: 'https://open.spotify.com', whatsapp: 'https://web.whatsapp.com', roblox: 'https://www.roblox.com/home',
  'google classroom': 'https://classroom.google.com', github: 'https://github.com', canva: 'https://www.canva.com',
  notion: 'https://www.notion.so', 'google maps': 'https://maps.google.com', maps: 'https://maps.google.com',
};

const clean = (s: string) => s.toLowerCase().replace(/\.exe$/, '').replace(/[^a-z0-9.+ ]/g, ' ').replace(/\s+/g, ' ').trim();

/** The best installed match for what the operator said, or null. Exact > alias > starts-with > every word present. */
export function findApp(apps: InstalledApp[], query: string): InstalledApp | null {
  const q = clean(query).replace(/^(the|my)\s+/, '').replace(/\s+(app|application|program|game)$/, '');
  if (!q) return null;
  const byName = (n: string) => apps.find((a) => clean(a.name) === n);
  const exact = byName(q);
  if (exact) return exact;
  for (const alias of ALIASES[q] ?? []) {
    const hit = byName(alias) ?? apps.find((a) => clean(a.name).startsWith(alias));
    if (hit) return hit;
  }
  const starts = apps.filter((a) => clean(a.name).startsWith(q)).sort((a, b) => a.name.length - b.name.length);
  if (starts.length) return starts[0];
  const words = q.split(' ');
  const all = apps.filter((a) => words.every((w) => clean(a.name).split(' ').some((x) => x.startsWith(w)))).sort((a, b) => a.name.length - b.name.length);
  // Uninstallers and helpers share the app's words - never open those for "open X".
  return all.find((a) => !/uninstall|readme|help|website|manual|release notes/i.test(a.name)) ?? null;
}

export interface LaunchResult { ok: boolean; opened?: string; how?: 'app' | 'steam' | 'web' | 'path'; error?: string; suggestions?: string[] }

const UNSAFE = /[&|;`\r\n<>^%]/;

export async function launch(query: string): Promise<LaunchResult> {
  const q = query.trim().replace(/^["']|["']$/g, '');
  if (!q) return { ok: false, error: 'No app name given.' };
  // A real file or folder path opens with its default app.
  if (/^[a-z]:[\\/]/i.test(q) && fs.existsSync(q)) {
    const err = await shell.openPath(q);
    return err ? { ok: false, error: err } : { ok: true, opened: q, how: 'path' };
  }
  const apps = await installedApps();
  const hit = findApp(apps, q);
  if (hit?.kind === 'steam') {
    await shell.openExternal(`steam://rungameid/${hit.id}`);
    return { ok: true, opened: hit.name, how: 'steam' };
  }
  if (hit) {
    // shell:AppsFolder starts Start-menu apps of every kind (Win32 and Store) by their AppID, like clicking them in Start.
    if (UNSAFE.test(hit.id)) return { ok: false, error: 'That app has an unusual ID - open it from Start instead.' };
    await run('explorer.exe', [`shell:AppsFolder\\${hit.id}`], { windowsHide: true }).catch(() => undefined); // explorer exits 1 even on success
    return { ok: true, opened: hit.name, how: 'app' };
  }
  const web = WEB_APPS[clean(q).replace(/\s+(app|website|site)$/, '')];
  if (web) {
    await shell.openExternal(web);
    return { ok: true, opened: web, how: 'web' };
  }
  const words = clean(q).split(' ');
  const suggestions = apps.filter((a) => words.some((w) => w.length > 2 && clean(a.name).includes(w))).slice(0, 8).map((a) => a.name);
  return { ok: false, error: `No installed app called "${q}" was found.`, suggestions };
}
