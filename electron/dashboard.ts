import fs from 'node:fs';
import path from 'node:path';
import { app, shell } from 'electron';
import * as composio from './composio';
import * as d2l from './d2l';
import * as dc from './discord';
import * as spotify from './spotifyLocal';
import { emit } from './brain/events';

/**
 * The Life dashboard (left panel): today's email, D2L work, YouTube, Discord,
 * Spotify and Drive in one place. Everything is read-only and fetched
 * straight from the apps (Composio actions, the D2L session, the operator's
 * own Discord bot, Windows' media controls) - no AI in between, so it is
 * fast, free and exact. Refreshed every hour and on demand; the last
 * snapshot is kept on disk so the panel is full the moment Ultron opens.
 */

export type SectionId = 'gmail' | 'd2l' | 'youtube' | 'discord' | 'spotify' | 'drive';
export interface DashItem {
  id: string;
  title: string;
  sub?: string;
  /** ISO time the item is about (received, due, published, edited). */
  time?: string | null;
  url?: string;
  thumb?: string;
  unread?: boolean;
  urgent?: boolean;
}
export interface DashGroup { label: string; items: DashItem[] }
export interface DashSection {
  id: SectionId;
  state: 'ok' | 'off' | 'error';
  /** Why it is off or failed, in words the operator can act on. */
  note?: string;
  /** The one-line summary under the section title ("3 unread · 7 today"). */
  headline?: string;
  count?: number;
  groups: DashGroup[];
  updatedAt: number;
}
export interface SpotifyNow { playing: boolean; open: boolean; title?: string; artist?: string; album?: string; recent: { title: string; artist?: string; at: number }[] }
export interface DashSnapshot { updatedAt: number; nextAt: number; refreshing: boolean; sections: DashSection[]; spotify: SpotifyNow }

const HOUR = 60 * 60_000;
const ORDER: SectionId[] = ['gmail', 'd2l', 'youtube', 'discord', 'spotify', 'drive'];

/* ------------------------------------------------------------- parsing helpers */

/** Composio results arrive wrapped differently by the SDK and Connect - find the list wherever it is. */
export function findArray(data: unknown, key: string, depth = 0): unknown[] {
  if (depth > 6 || data == null) return [];
  if (typeof data === 'string') {
    const t = data.trim();
    if (!t.startsWith('{') && !t.startsWith('[')) return [];
    try { return findArray(JSON.parse(t), key, depth + 1); } catch { return []; }
  }
  if (Array.isArray(data)) {
    for (const v of data) {
      const hit = findArray(v, key, depth + 1);
      if (hit.length) return hit;
    }
    return [];
  }
  if (typeof data === 'object') {
    const o = data as Record<string, unknown>;
    if (Array.isArray(o[key])) return o[key] as unknown[];
    for (const v of Object.values(o)) {
      if (v && typeof v === 'object' || typeof v === 'string') {
        const hit = findArray(v, key, depth + 1);
        if (hit.length) return hit;
      }
    }
  }
  return [];
}

const rec = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' ? v as Record<string, unknown> : {});
const s = (v: unknown): string => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '');

/** Epoch milliseconds or seconds, or any date string -> ISO; null when it is not a time. */
export function toIso(v: unknown): string | null {
  const t = s(v).trim();
  if (!t) return null;
  if (/^\d{10,13}$/.test(t)) return new Date(Number(t) * (t.length === 10 ? 1000 : 1)).toISOString();
  const ms = Date.parse(t);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

/** "Coach Sam <sam@club.com>" -> "Coach Sam"; a bare address keeps its name part. */
export function senderName(from: string): string {
  const m = /^\s*"?([^"<]+?)"?\s*<[^>]+>\s*$/.exec(from);
  if (m) return m[1].trim();
  return from.replace(/@.*$/, '').trim() || from;
}

export function isSameLocalDay(iso: string | null | undefined, now = new Date()): boolean {
  if (!iso) return false;
  const d = new Date(iso);
  return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
}

export function gmailItems(data: unknown, now = new Date()): DashItem[] {
  return findArray(data, 'messages')
    .map(rec)
    .map((m) => {
      const labels = Array.isArray(m.labelIds) ? (m.labelIds as unknown[]).map(s) : [];
      const preview = rec(m.preview);
      return {
        id: s(m.messageId) || s(m.id),
        title: (s(m.subject) || s(preview.subject) || '(no subject)').trim(),
        sub: senderName(s(m.sender) || s(m.from)),
        time: toIso(m.messageTimestamp ?? m.internalDate ?? m.date),
        url: s(m.threadId) ? `https://mail.google.com/mail/u/0/#inbox/${s(m.threadId)}` : 'https://mail.google.com/mail/u/0/#inbox',
        unread: labels.includes('UNREAD'),
        urgent: labels.includes('IMPORTANT') && labels.includes('UNREAD'),
      } satisfies DashItem;
    })
    .filter((m) => m.id && isSameLocalDay(m.time, now))
    .sort((a, b) => Date.parse(b.time ?? '') - Date.parse(a.time ?? ''));
}

function thumbOf(snippet: Record<string, unknown>): string | undefined {
  const t = rec(snippet.thumbnails);
  const best = rec(t.medium).url ?? rec(t.default).url ?? rec(t.high).url;
  return typeof best === 'string' ? best : undefined;
}

/** playlistItems (liked videos, a channel's uploads) -> watch links. */
export function youtubeItems(data: unknown): DashItem[] {
  return findArray(data, 'items')
    .map(rec)
    .map((it) => {
      const sn = rec(it.snippet);
      const cd = rec(it.contentDetails);
      const videoId = s(cd.videoId) || s(rec(sn.resourceId).videoId) || (typeof it.id === 'string' && it.id.length === 11 ? it.id : s(rec(it.id).videoId));
      return {
        id: videoId,
        title: s(sn.title),
        sub: s(sn.videoOwnerChannelTitle) || s(sn.channelTitle),
        time: toIso(cd.videoPublishedAt ?? sn.publishedAt),
        url: videoId ? `https://www.youtube.com/watch?v=${videoId}` : undefined,
        thumb: thumbOf(sn),
      } satisfies DashItem;
    })
    // Removed and private videos stay in playlists as "Deleted video" / "Private video".
    .filter((v) => v.id && v.title && !/^(deleted|private) video$/i.test(v.title));
}

const KIND: [RegExp, string][] = [
  [/document/, 'Doc'], [/spreadsheet/, 'Sheet'], [/presentation/, 'Slides'], [/form/, 'Form'], [/drawing/, 'Drawing'],
  [/pdf/, 'PDF'], [/^image\//, 'Image'], [/^video\//, 'Video'], [/^audio\//, 'Audio'], [/zip|compressed/, 'Archive'], [/text\//, 'Text'],
];

export function driveItems(data: unknown): DashItem[] {
  return findArray(data, 'files')
    .map(rec)
    .map((f) => {
      const mime = s(f.mimeType);
      const kind = KIND.find(([re]) => re.test(mime))?.[1] ?? 'File';
      const editor = rec(f.lastModifyingUser);
      const by = editor.me === true || !s(editor.displayName) ? '' : ` · edited by ${s(editor.displayName)}`;
      return { id: s(f.id), title: s(f.name), sub: `${kind}${by}`, time: toIso(f.modifiedTime), url: s(f.webViewLink) || undefined } satisfies DashItem;
    })
    .filter((f) => f.id && f.title);
}

/** A Discord id is a snowflake: its high bits are milliseconds since 2015 - newest channel activity without fetching it. */
export function snowflakeTime(id: string | null | undefined): number {
  if (!id || !/^\d+$/.test(id)) return 0;
  return Number((BigInt(id) >> 22n) + 1420070400000n);
}

/* ------------------------------------------------------------- the sections */

const off = (id: SectionId, note: string): DashSection => ({ id, state: 'off', note, groups: [], updatedAt: Date.now() });
const failed = (id: SectionId, e: unknown): DashSection => ({ id, state: 'error', note: e instanceof Error ? e.message : String(e), groups: [], updatedAt: Date.now() });

async function run(slug: string, args: Record<string, unknown>): Promise<unknown> {
  const r = await composio.runAction(slug, args);
  if (!r.ok) throw new Error(r.error ?? `${slug} failed`);
  return r.data;
}

async function connected(): Promise<Set<string>> {
  try {
    return new Set((await composio.connectedApps()).map((a) => a.slug));
  } catch {
    return new Set(composio.connectedSlugs());
  }
}

async function gmailSection(apps: Set<string>): Promise<DashSection> {
  const slug = apps.has('gmail') ? 'GMAIL_FETCH_EMAILS' : apps.has('googlesuper') ? 'GOOGLESUPER_FETCH_EMAILS' : '';
  if (!slug) return off('gmail', 'Connect Gmail in Apps to see today\'s email here.');
  // Two days, then today in local time: Gmail's after:/newer_than: work in UTC.
  const data = await run(slug, { query: 'in:inbox newer_than:2d', max_results: 25, verbose: false, include_payload: false, user_id: 'me' });
  const today = gmailItems(data);
  const unread = today.filter((m) => m.unread).length;
  return {
    id: 'gmail',
    state: 'ok',
    count: today.length,
    headline: today.length ? `${unread} unread · ${today.length} today` : 'No email today',
    groups: today.length ? [{ label: 'TODAY', items: today.slice(0, 8) }] : [],
    updatedAt: Date.now(),
  };
}

async function d2lSection(): Promise<DashSection> {
  const st = await d2l.status();
  if (!st.signedIn) return off('d2l', st.baseUrl ? 'Signed out of D2L - sign in again in Apps.' : 'Sign in to D2L in Apps to see your assignments here.');
  const [due, late] = await Promise.all([d2l.dueItems(14), d2l.overdue().catch(() => [] as d2l.D2LDueItem[])]);
  const base = d2l.baseUrl();
  const item = (d: d2l.D2LDueItem, urgent = false): DashItem => ({
    id: `${d.courseId}-${d.name}`,
    title: d.name,
    sub: d.course,
    time: d.due,
    url: d.url ? (d.url.startsWith('http') ? d.url : `${base}${d.url}`) : `${base}/d2l/home/${d.courseId}`,
    urgent,
  });
  const open = due.filter((d) => !d.completed);
  const soon = open.filter((d) => d.due && Date.parse(d.due) - Date.now() < 2 * 86_400_000).length;
  const groups: DashGroup[] = [];
  if (late.length) groups.push({ label: 'OVERDUE', items: late.slice(0, 5).map((d) => item(d, true)) });
  if (open.length) groups.push({ label: 'DUE IN THE NEXT 2 WEEKS', items: open.slice(0, 8).map((d) => item(d, Boolean(d.due && Date.parse(d.due) - Date.now() < 86_400_000))) });
  return {
    id: 'd2l',
    state: 'ok',
    count: open.length + late.length,
    headline: [late.length ? `${late.length} overdue` : '', open.length ? `${open.length} due${soon ? ` (${soon} in 2 days)` : ''}` : ''].filter(Boolean).join(' · ') || 'Nothing due - all clear',
    groups,
    updatedAt: Date.now(),
  };
}

async function youtubeSection(apps: Set<string>): Promise<DashSection> {
  if (!apps.has('youtube')) return off('youtube', 'Connect YouTube in Apps to see your liked videos and subscriptions.');
  const errors: string[] = [];
  const attempt = <T>(p: Promise<T>, fallback: T): Promise<T> => p.catch((e: unknown) => { errors.push(e instanceof Error ? e.message : String(e)); return fallback; });

  const [liked, subs, mine] = await Promise.all([
    // "LL" is the signed-in account's own Liked videos playlist.
    attempt(run('YOUTUBE_LIST_PLAYLIST_ITEMS', { playlistId: 'LL', maxResults: 6, part: 'snippet,contentDetails' }).then(youtubeItems), [] as DashItem[]),
    attempt(run('YOUTUBE_LIST_USER_SUBSCRIPTIONS', { maxResults: 8, part: 'snippet' }), null as unknown),
    attempt(run('YOUTUBE_LIST_CHANNEL_VIDEOS', { mine: true, maxResults: 3 }).then(youtubeItems), [] as DashItem[]),
  ]);
  // The newest upload of each subscribed channel: its uploads playlist is the channel id with UC -> UU (1 quota unit each).
  const channels = findArray(subs, 'items').map(rec).map((it) => s(rec(rec(it.snippet).resourceId).channelId)).filter((id) => id.startsWith('UC')).slice(0, 8);
  const latest = (await Promise.all(channels.map((id) =>
    run('YOUTUBE_LIST_PLAYLIST_ITEMS', { playlistId: `UU${id.slice(2)}`, maxResults: 1, part: 'snippet,contentDetails' }).then(youtubeItems).catch(() => [] as DashItem[]),
  ))).flat().sort((a, b) => Date.parse(b.time ?? '') - Date.parse(a.time ?? ''));

  const groups: DashGroup[] = [];
  if (latest.length) groups.push({ label: 'NEW FROM YOUR SUBSCRIPTIONS', items: latest.slice(0, 5) });
  if (liked.length) groups.push({ label: 'YOUR LIKED VIDEOS', items: liked.slice(0, 5) });
  if (mine.length) groups.push({ label: 'YOUR CHANNEL', items: mine.slice(0, 3) });
  if (!groups.length && errors.length) throw new Error(errors[0]);
  const fresh = latest.filter((v) => v.time && Date.now() - Date.parse(v.time) < 2 * 86_400_000).length;
  return {
    id: 'youtube',
    state: 'ok',
    count: latest.length + liked.length,
    headline: [fresh ? `${fresh} new upload${fresh > 1 ? 's' : ''} in 2 days` : latest.length ? `${latest.length} channels checked` : '', liked.length ? `${liked.length} recent likes` : ''].filter(Boolean).join(' · ') || 'Nothing to show yet',
    groups,
    updatedAt: Date.now(),
  };
}

type ChannelWithLast = dc.Channel & { last_message_id?: string | null };

async function discordSection(): Promise<DashSection> {
  if (!dc.hasToken()) return off('discord', 'Set up your own Discord bot in Apps to see your server here.');
  const guilds = (await dc.servers()).slice(0, 2);
  if (!guilds.length) return { ...off('discord', 'Your bot is not in a server yet - Apps > Add bot to a server.'), state: 'ok' };
  const groups: DashGroup[] = [];
  let channelCount = 0;
  for (const g of guilds) {
    const all = await dc.api<ChannelWithLast[]>('GET', `/guilds/${g.id}/channels`);
    const talk = all.filter((c) => [0, 2, 5, 13, 15].includes(c.type));
    channelCount += talk.length;
    const active = talk.filter((c) => c.last_message_id).sort((a, b) => snowflakeTime(b.last_message_id) - snowflakeTime(a.last_message_id)).slice(0, 5);
    const items: DashItem[] = [];
    for (const c of active) {
      const msgs = await dc.api<dc.Message[]>('GET', `/channels/${c.id}/messages?limit=1`).catch(() => [] as dc.Message[]);
      const m = msgs[0];
      const text = m ? (m.content || (m.attachments?.length ? `[${m.attachments.map((a) => a.filename).join(', ')}]` : m.embeds?.length ? '[embed]' : '')) : '';
      items.push({
        id: c.id,
        title: `#${c.name}`,
        sub: m ? `${m.author.global_name ?? m.author.username}: ${text.replace(/\s+/g, ' ').slice(0, 110)}` : 'No recent messages Ultron can read',
        time: m?.timestamp ?? new Date(snowflakeTime(c.last_message_id)).toISOString(),
        url: `https://discord.com/channels/${g.id}/${c.id}`,
        unread: Boolean(m && Date.now() - Date.parse(m.timestamp) < 6 * HOUR),
      });
    }
    groups.push({ label: `${g.name.toUpperCase()} · LATEST`, items });
  }
  const recent = groups.flatMap((g) => g.items).filter((i) => i.unread).length;
  return {
    id: 'discord',
    state: 'ok',
    count: channelCount,
    headline: `${guilds.length === 1 ? guilds[0].name : `${guilds.length} servers`} · ${channelCount} channels${recent ? ` · ${recent} active in 6 h` : ''}`,
    groups,
    updatedAt: Date.now(),
  };
}

async function driveSection(apps: Set<string>): Promise<DashSection> {
  if (!apps.has('googledrive')) return off('drive', 'Connect Google Drive in Apps to see your recent files here.');
  const fields = 'files(id,name,mimeType,modifiedTime,webViewLink,lastModifyingUser(displayName,me))';
  const [recent, starred] = await Promise.all([
    run('GOOGLEDRIVE_FIND_FILE', { q: "trashed = false and mimeType != 'application/vnd.google-apps.folder'", orderBy: 'modifiedTime desc', pageSize: 6, fields, corpora: 'user' }).then(driveItems),
    run('GOOGLEDRIVE_FIND_FILE', { q: 'trashed = false and starred = true', orderBy: 'modifiedTime desc', pageSize: 4, fields, corpora: 'user' }).then(driveItems).catch(() => [] as DashItem[]),
  ]);
  const today = recent.filter((f) => isSameLocalDay(f.time)).length;
  const groups: DashGroup[] = [];
  if (recent.length) groups.push({ label: 'RECENTLY EDITED', items: recent });
  if (starred.length) groups.push({ label: 'STARRED', items: starred });
  return {
    id: 'drive',
    state: 'ok',
    count: recent.length,
    headline: recent.length ? `${today ? `${today} edited today · ` : ''}last edit ${relative(recent[0].time)}` : 'No files yet',
    groups,
    updatedAt: Date.now(),
  };
}

function relative(iso: string | null | undefined): string {
  if (!iso) return '';
  const mins = Math.round((Date.now() - Date.parse(iso)) / 60_000);
  if (mins < 60) return `${Math.max(mins, 1)} min ago`;
  if (mins < 24 * 60) return `${Math.round(mins / 60)} h ago`;
  return `${Math.round(mins / 1440)} d ago`;
}

/* ------------------------------------------------------------- Spotify (local, live) */

let spotifyNow: SpotifyNow = { playing: false, open: false, recent: [] };

function spotifySection(): DashSection {
  const n = spotifyNow;
  if (!spotify.installed() && !n.open) return off('spotify', 'Spotify isn\'t installed on this PC.');
  const groups: DashGroup[] = [];
  if (n.recent.length) {
    groups.push({
      label: 'PLAYED ON THIS PC',
      items: n.recent.slice(0, 6).map((t, i) => ({ id: `${t.at}-${i}`, title: t.title, sub: t.artist, time: new Date(t.at).toISOString(), url: `spotify:search:${encodeURIComponent(`${t.title} ${t.artist ?? ''}`.trim())}` })),
    });
  }
  return {
    id: 'spotify',
    state: 'ok',
    headline: n.title ? `${n.playing ? 'Playing' : 'Paused'}: ${n.title}${n.artist ? ` - ${n.artist}` : ''}` : n.open ? 'Spotify is open - nothing loaded' : 'Spotify is closed',
    groups,
    updatedAt: Date.now(),
  };
}

/** Reads what Spotify is doing; a new song joins the "played on this PC" list. */
export async function pollSpotify(action: spotify.SpotifyAction = 'status'): Promise<SpotifyNow> {
  try {
    const st = action === 'status' ? await spotify.mediaState('status') : await spotify.control(action);
    const recent = [...spotifyNow.recent];
    if (st.title && (recent[0]?.title !== st.title || recent[0]?.artist !== st.artist)) recent.unshift({ title: st.title, artist: st.artist, at: Date.now() });
    spotifyNow = { playing: /playing/i.test(st.status ?? ''), open: st.session, title: st.title, artist: st.artist, album: st.album, recent: recent.slice(0, 12) };
  } catch {
    spotifyNow = { ...spotifyNow, playing: false };
  }
  if (snapshot) {
    snapshot = { ...snapshot, spotify: spotifyNow, sections: snapshot.sections.map((x) => (x.id === 'spotify' ? spotifySection() : x)) };
    save();
  }
  return spotifyNow;
}

/* ------------------------------------------------------------- refresh + storage */

let snapshot: DashSnapshot | null = null;
let timer: ReturnType<typeof setInterval> | null = null;
let running: Promise<DashSnapshot> | null = null;

const file = () => path.join(app.getPath('userData'), 'dashboard.json');

function load(): DashSnapshot | null {
  try {
    const raw = JSON.parse(fs.readFileSync(file(), 'utf8')) as DashSnapshot;
    if (!Array.isArray(raw.sections)) return null;
    spotifyNow = raw.spotify ?? spotifyNow;
    return { ...raw, refreshing: false };
  } catch {
    return null;
  }
}

function save(): void {
  try { if (snapshot) fs.writeFileSync(file(), JSON.stringify(snapshot)); } catch { /* disk full - the panel still has it in memory */ }
}

function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  return Promise.race([p, new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`${what} took too long - it will try again next hour.`)), ms))]);
}

export function getSnapshot(): DashSnapshot {
  snapshot ??= load() ?? { updatedAt: 0, nextAt: Date.now(), refreshing: false, sections: [], spotify: spotifyNow };
  return snapshot;
}

/** Fetches every section (each on its own - one failing app never blanks the others) and tells the HUD. */
export function refresh(): Promise<DashSnapshot> {
  if (running) return running;
  const prev = getSnapshot();
  snapshot = { ...prev, refreshing: true };
  emit('dashboard:update', snapshot);
  running = (async () => {
    const apps = await connected();
    await pollSpotify();
    const jobs: Record<SectionId, () => Promise<DashSection>> = {
      gmail: () => gmailSection(apps),
      d2l: () => d2lSection(),
      youtube: () => youtubeSection(apps),
      discord: () => discordSection(),
      spotify: async () => spotifySection(),
      drive: () => driveSection(apps),
    };
    const results = await Promise.all(ORDER.map((id) => withTimeout(jobs[id](), 90_000, id).catch((e: unknown) => {
      // A failed refresh keeps the last good items on screen, marked with the problem.
      const old = prev.sections.find((x) => x.id === id);
      return old && old.state === 'ok' ? { ...old, note: `Couldn't update: ${e instanceof Error ? e.message : String(e)}` } : failed(id, e);
    })));
    const now = Date.now();
    snapshot = { updatedAt: now, nextAt: now + HOUR, refreshing: false, sections: results, spotify: spotifyNow };
    save();
    emit('dashboard:update', snapshot);
    return snapshot;
  })().finally(() => { running = null; });
  return running;
}

/** Hourly refresh; the first one soon after start-up (or straight away if the saved one is over an hour old). */
export function startDashboard(): void {
  if (timer) return;
  const snap = getSnapshot();
  const due = Math.max(snap.updatedAt + HOUR - Date.now(), 0);
  setTimeout(() => { void refresh(); }, Math.max(due, 20_000));
  timer = setInterval(() => { void refresh(); }, HOUR);
}

/** Only real web and Spotify links leave the HUD. */
export async function open(url: string): Promise<boolean> {
  if (!/^(https:\/\/|spotify:)/i.test(url)) return false;
  await shell.openExternal(url);
  return true;
}
