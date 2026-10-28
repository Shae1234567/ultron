import WebSocket from 'ws';
import { randomInt } from 'node:crypto';
import { api, hasToken, splitMessage } from './discord';
import { getSecret } from './secrets';
import { getSettings, readDoc, saveSettings, writeDoc } from './store';

/*
 * Log from your phone: the operator DMs his own Ultron bot ("slept 11:30 to 7, practice was
 * brutal") and Ultron picks it up through the bot's live connection - instant while Ultron
 * runs, and messages sent while it was off are caught up at start (Discord keeps them).
 *
 * Only DMs from HIS account count. The bot may have been made on a parent's account (Discord's
 * developer terms need one under 18), so his account is linked once by a code: Ultron shows
 * "link 4821", he DMs that to the bot, and that sender becomes the one account it listens to.
 * Everyone else is ignored without a reply. Asks only for direct messages - no server
 * messages, no presence (that comes with Media) - so no extra switches in the Developer Portal.
 */

const GATEWAY = 'wss://gateway.discord.gg/?v=10&encoding=json';
const INTENTS = 1 << 12; // DIRECT_MESSAGES. DM text arrives without the Message Content intent.
const STATE = 'departments/phone.json';
const MAX_AGE_MS = 24 * 3600_000;

export interface PhoneMessage { id: string; channelId: string; text: string; images: { url: string; contentType: string; size: number }[]; at: number }
/** What to do with a message from his phone; returns the reply. */
export type PhoneHandler = (m: PhoneMessage) => Promise<string>;

interface DiscordMessage { id: string; channel_id: string; guild_id?: string; author: { id: string; bot?: boolean }; content: string; timestamp: string; attachments?: { url: string; content_type?: string; size: number }[] }

let ws: WebSocket | null = null;
let heartbeat: ReturnType<typeof setInterval> | null = null;
let seq: number | null = null;
let sessionId = '';
let resumeUrl = '';
let acked = true;
let stopped = true;
let retry = 0;
let handler: PhoneHandler | null = null;
let status: { connected: boolean; error?: string } = { connected: false };
let pairing: { code: string; until: number } | null = null;

export function linkedUser(): string {
  return getSettings().phone?.discordUserId ?? '';
}

/** A one-time code he DMs to the bot to link his account (good for 15 minutes). */
export function startPairing(): { code: string; expires: number } {
  pairing = { code: String(randomInt(1000, 10000)), until: Date.now() + 15 * 60_000 };
  return { code: pairing.code, expires: pairing.until };
}

export function phoneStatus(): { linked: boolean; connected: boolean; botReady: boolean; error?: string; pairing?: string } {
  return { linked: Boolean(linkedUser()), connected: status.connected, botReady: hasToken(), error: status.error, pairing: pairing && pairing.until > Date.now() ? pairing.code : undefined };
}

const lastSeen = () => readDoc<{ lastId?: string }>(STATE, {}).lastId ?? '';
const markSeen = (id: string) => {
  if (BigInt(id) > BigInt(lastSeen() || '0')) writeDoc(STATE, { lastId: id });
};

function toPhone(m: DiscordMessage): PhoneMessage {
  return {
    id: m.id, channelId: m.channel_id, text: m.content.trim(), at: Date.parse(m.timestamp),
    images: (m.attachments ?? []).filter((a) => /^image\//.test(a.content_type ?? '')).map((a) => ({ url: a.url, contentType: a.content_type!, size: a.size })),
  };
}

/** Who a DM is from decides everything: the linked account, a linking code, or nobody we answer. Pure. */
export function classify(m: Pick<DiscordMessage, 'guild_id' | 'author' | 'content'>, linked: string, code: string | null): 'owner' | 'link' | 'ignore' {
  if (m.guild_id || m.author.bot) return 'ignore';
  if (linked && m.author.id === linked) return 'owner';
  if (code && m.content.trim().toLowerCase() === `link ${code}`) return 'link';
  return 'ignore';
}

async function reply(channelId: string, text: string): Promise<void> {
  for (const part of splitMessage(text || 'Done.', 1900).slice(0, 3)) {
    await api('POST', `/channels/${channelId}/messages`, { content: part });
  }
}

const queue: DiscordMessage[] = [];
let draining = false;

async function drain(): Promise<void> {
  if (draining) return;
  draining = true;
  try {
    while (queue.length) {
      const m = queue.shift()!;
      const code = pairing && pairing.until > Date.now() ? pairing.code : null;
      const kind = classify(m, linkedUser(), code);
      if (kind === 'link') {
        saveSettings({ phone: { discordUserId: m.author.id } });
        pairing = null;
        markSeen(m.id);
        await reply(m.channel_id, 'Linked - this is the account I listen to now. Tell me how you slept, what you trained or ate, or send a photo of a nutrition label or barcode, any time.').catch(() => {});
        continue;
      }
      if (kind !== 'owner') continue;
      markSeen(m.id);
      if (Date.now() - Date.parse(m.timestamp) > MAX_AGE_MS) continue;
      try {
        const text = handler ? await handler(toPhone(m)) : 'Ultron is starting up - send that again in a minute.';
        await reply(m.channel_id, text);
      } catch (e) {
        await reply(m.channel_id, `That didn't go through: ${e instanceof Error ? e.message : String(e)}`).catch(() => {});
      }
    }
  } finally {
    draining = false;
  }
}

/** Messages he sent while Ultron was off: Discord keeps them, so read the DM since the last one handled. */
async function catchUp(): Promise<void> {
  const owner = linkedUser();
  if (!owner) return;
  try {
    const dm = await api<{ id: string }>('POST', '/users/@me/channels', { recipient_id: owner });
    const after = lastSeen();
    const msgs = await api<DiscordMessage[]>('GET', `/channels/${dm.id}/messages?limit=20${after ? `&after=${after}` : ''}`);
    const fresh = msgs.filter((m) => !m.author.bot).sort((a, b) => (BigInt(a.id) < BigInt(b.id) ? -1 : 1));
    if (!after) {
      // First start after linking: nothing older is replayed - just remember where now is.
      if (fresh.length) markSeen(fresh[fresh.length - 1].id);
      return;
    }
    queue.push(...fresh);
    void drain();
  } catch { /* the live connection still works; catching up is best-effort */ }
}

function send(op: number, d: unknown): void {
  if (ws?.readyState !== WebSocket.OPEN) return;
  // A failed send (12 Oct 2026: a bundling slip in `ws` threw on every frame over 48 bytes) drops this
  // connection for a retry - it never takes Ultron down with it.
  try { ws.send(JSON.stringify({ op, d })); } catch (e) {
    status = { ...status, error: e instanceof Error ? e.message : String(e) };
    ws.terminate();
  }
}

function stopHeartbeat(): void {
  if (heartbeat) clearInterval(heartbeat);
  heartbeat = null;
}

function connect(): void {
  if (stopped || !hasToken()) return;
  const url = resumeUrl && sessionId ? `${resumeUrl}/?v=10&encoding=json` : GATEWAY;
  const sock = new WebSocket(url);
  ws = sock;
  sock.on('message', (raw) => {
    let p: { op: number; d: any; s: number | null; t: string | null };
    try { p = JSON.parse(String(raw)); } catch { return; }
    if (p.s !== null && p.s !== undefined) seq = p.s;
    if (p.op === 10) {
      stopHeartbeat();
      acked = true;
      heartbeat = setInterval(() => {
        if (!acked) { sock.terminate(); return; } // a zombie connection - reconnect
        acked = false;
        send(1, seq);
      }, p.d.heartbeat_interval);
      if (sessionId && resumeUrl) send(6, { token: getSecret('DISCORD_BOT_TOKEN'), session_id: sessionId, seq });
      else send(2, { token: getSecret('DISCORD_BOT_TOKEN'), intents: INTENTS, properties: { os: 'windows', browser: 'ultron', device: 'ultron' } });
    } else if (p.op === 11) {
      acked = true;
    } else if (p.op === 1) {
      send(1, seq);
    } else if (p.op === 7) {
      sock.close(4000);
    } else if (p.op === 9) {
      // Invalid session: start a fresh one.
      sessionId = ''; resumeUrl = ''; seq = null;
      setTimeout(() => sock.close(4000), 1000 + Math.random() * 4000);
    } else if (p.op === 0) {
      if (p.t === 'READY') {
        sessionId = p.d.session_id;
        resumeUrl = p.d.resume_gateway_url;
        status = { connected: true };
        retry = 0;
        void catchUp();
      } else if (p.t === 'RESUMED') {
        status = { connected: true };
        retry = 0;
      } else if (p.t === 'MESSAGE_CREATE') {
        queue.push(p.d as DiscordMessage);
        void drain();
      }
    }
  });
  sock.on('close', (code) => {
    stopHeartbeat();
    status = { ...status, connected: false };
    if (ws === sock) ws = null;
    // Discord refusing the token or the intents is final until something changes.
    if (code === 4004) { status.error = 'Discord refused the bot token.'; return; }
    if (code === 4014) { status.error = 'Discord refused the requested access (intents).'; return; }
    if (code === 4007 || code === 4009) { sessionId = ''; resumeUrl = ''; seq = null; }
    if (stopped) return;
    const wait = Math.min(60_000, 2000 * 2 ** retry++) + Math.random() * 1000;
    setTimeout(connect, wait);
  });
  sock.on('error', (e) => { status = { ...status, error: e.message }; });
}

/** Starts the live connection (once the bot is set up) and routes his DMs to `onMessage`. */
let watchdog: ReturnType<typeof setInterval> | null = null;

export function startPhone(onMessage: PhoneHandler): void {
  handler = onMessage;
  if (!stopped) return;
  stopped = false;
  connect();
  // The bot can be set up (or a refusal fixed) while Ultron runs - connect then, without a restart.
  watchdog = setInterval(() => { if (!stopped && !ws && hasToken() && !/refused/.test(status.error ?? '')) connect(); }, 5 * 60_000);
}

export function stopPhone(): void {
  stopped = true;
  if (watchdog) clearInterval(watchdog);
  watchdog = null;
  stopHeartbeat();
  ws?.close(1000);
  ws = null;
}
