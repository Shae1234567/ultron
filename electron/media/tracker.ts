import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { getSettings, readDoc, writeDoc } from '../store';
import { emit } from '../brain/events';
import { allGames } from './library';

/*
 * Playtime for every game, any launcher - the closest thing to "what did I play this week"
 * when Epic keeps no playtime and consoles aren't on the PC. Every two minutes, the list of
 * running program names (Windows' own tasklist) is matched against the games installed on this
 * PC, plus Minecraft and Roblox. Only game names and start/stop times are kept - nothing else
 * about what runs is recorded. Local, private, with its own switch (Settings - trackers).
 */

export interface Session { game: string; start: number; end: number }
interface Doc { sessions: Session[]; open: Record<string, { start: number; seen: number }> }

const DOC = 'departments/media-play.json';
const GAP = 5 * 60_000;
const NOT_GAME_EXE = /^(unitycrashhandler|crashreport|unins|vc_?redist|dxsetup|setup|install|launcher_?helper|easyanticheat|be(service|launcher)|ue4prereq|dotnet|vcredist|crashpad|cefprocess)/i;

export function load(): Doc {
  const d = readDoc<Partial<Doc>>(DOC, {});
  return { sessions: Array.isArray(d.sessions) ? d.sessions : [], open: d.open && typeof d.open === 'object' ? d.open : {} };
}

/** Game programs seen running now -> open sessions extended, finished ones closed. Pure. */
export function update(doc: Doc, running: string[], now: number): Doc {
  const open = { ...doc.open };
  const sessions = [...doc.sessions];
  for (const g of running) open[g] = open[g] ? { ...open[g], seen: now } : { start: now, seen: now };
  for (const [g, o] of Object.entries(open)) {
    if (running.includes(g)) continue;
    if (now - o.seen > GAP) {
      if (o.seen - o.start >= 60_000) sessions.push({ game: g, start: o.start, end: o.seen });
      delete open[g];
    }
  }
  return { sessions: sessions.slice(-600), open };
}

/** Minutes per game over the last `days`, open sessions included. Pure. */
export function playtime(doc: Doc, now = Date.now(), days = 7): { game: string; minutes: number; sessions: number }[] {
  const since = now - days * 86_400_000;
  const all = [...doc.sessions, ...Object.entries(doc.open).map(([game, o]) => ({ game, start: o.start, end: o.seen }))];
  const by = new Map<string, { minutes: number; sessions: number }>();
  for (const s of all.filter((x) => x.end >= since)) {
    const m = Math.round((s.end - Math.max(s.start, since)) / 60_000);
    const cur = by.get(s.game) ?? { minutes: 0, sessions: 0 };
    by.set(s.game, { minutes: cur.minutes + m, sessions: cur.sessions + 1 });
  }
  return [...by.entries()].map(([game, v]) => ({ game, ...v })).sort((a, b) => b.minutes - a.minutes);
}

/** exe name (lowercase) -> game name, from what is installed: Epic's launch exe, the exes in each Steam game folder. */
export function exeMap(): Map<string, string> {
  const map = new Map<string, string>([['robloxplayerbeta.exe', 'Roblox'], ['minecraft.windows.exe', 'Minecraft'], ['minecraftlauncher.exe', 'Minecraft']]);
  for (const g of allGames()) {
    if (g.exe) map.set(g.exe.toLowerCase(), g.name);
    if (!g.installDir) continue;
    const scan = (dir: string, depth: number) => {
      let entries: fs.Dirent[] = [];
      try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
      for (const e of entries.slice(0, 200)) {
        if (e.isFile() && /\.exe$/i.test(e.name) && !NOT_GAME_EXE.test(e.name)) map.set(e.name.toLowerCase(), g.name);
        else if (e.isDirectory() && depth > 0 && !/^(_|redist|support|directx|vcredist|engine)/i.test(e.name)) scan(path.join(dir, e.name), depth - 1);
      }
    };
    scan(g.installDir, 2);
  }
  return map;
}

/** tasklist's CSV: image name and window title per process. Pure. */
export function parseTasklist(csv: string): { exe: string; title: string }[] {
  return csv.split(/\r?\n/).filter(Boolean).map((line) => {
    const cells = [...line.matchAll(/"((?:[^"]|"")*)"/g)].map((m) => m[1]);
    return { exe: (cells[0] ?? '').toLowerCase(), title: cells[cells.length - 1] ?? '' };
  }).filter((p) => p.exe);
}

/** Which games are running, from the process list. Java Minecraft (and Lunar Client) is told apart by its window title. Pure. */
export function gamesRunning(procs: { exe: string; title: string }[], map: Map<string, string>): string[] {
  const out = new Set<string>();
  for (const p of procs) {
    const g = map.get(p.exe);
    if (g) out.add(g);
    if (p.exe === 'javaw.exe' && /minecraft|lunar client/i.test(p.title)) out.add('Minecraft');
  }
  return [...out];
}

function tasklist(): Promise<string> {
  return new Promise((resolve) => {
    execFile('tasklist.exe', ['/v', '/fo', 'csv', '/nh'], { windowsHide: true, timeout: 20_000, maxBuffer: 8 * 1024 * 1024 }, (err, stdout) => resolve(err ? '' : stdout));
  });
}

export const on = () => (getSettings() as { trackers?: { games?: boolean } }).trackers?.games !== false;

let timer: ReturnType<typeof setInterval> | null = null;
let map: { at: number; m: Map<string, string> } | null = null;

export function startGameTracker(): void {
  if (timer || process.platform !== 'win32') return;
  const tick = async () => {
    if (!on()) return;
    if (!map || Date.now() - map.at > 6 * 3600_000) map = { at: Date.now(), m: exeMap() };
    const running = gamesRunning(parseTasklist(await tasklist()), map.m);
    const before = load();
    const next = update(before, running, Date.now());
    writeDoc(DOC, next);
    if (next.sessions.length !== before.sessions.length) emit('media:changed', { at: Date.now() });
  };
  setTimeout(() => void tick(), 60_000);
  timer = setInterval(() => void tick(), 2 * 60_000);
}

/** What the tracker has collected, in full - shown to him when he asks. */
export function collected(): { game: string; from: string; to: string }[] {
  return load().sessions.map((s) => ({ game: s.game, from: new Date(s.start).toLocaleString('en-CA'), to: new Date(s.end).toLocaleString('en-CA') }));
}
