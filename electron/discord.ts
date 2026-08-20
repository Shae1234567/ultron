import { env } from './env';

/**
 * Real Discord connector. Two independent auth modes:
 *
 *  - Webhook (DISCORD_WEBHOOK_URL): posts into exactly one channel, cannot
 *    read anything. The original, simplest option - kept as-is below.
 *
 *  - Bot (DISCORD_BOT_TOKEN): a real bot application invited into the server
 *    with a deliberately narrow, named permission set - View Channels, Send
 *    Messages, Embed Links, Read Message History, Manage Channels, Manage
 *    Roles. This unlocks reading/summarizing channels, posting to any
 *    channel, and reversible channel/role management (create/rename a
 *    channel, assign/remove a role on a member).
 *
 * Deliberately NOT implemented, on purpose, regardless of what the token
 * could technically do: kicking, banning, deleting a channel, deleting a
 * role, editing server settings, or requesting Administrator. Channel/role
 * deletion is permanent with no undo on Discord's side - the same reason
 * file deletion in this app goes to the Recycle Bin instead of unlinking.
 * Every write function here is only ever called from an explicit button
 * click in DiscordPanel - never from the LLM's own output.
 */

const TIMEOUT_MS = 10000;
const UA = 'Ultron-Personal-Assistant/0.1 (local desktop app; no distribution)';

export interface DiscordWebhookInfo {
  name: string;
  channelId: string;
  guildId: string | null;
}

function webhookUrl(): string {
  return env('DISCORD_WEBHOOK_URL');
}

export function hasWebhook(): boolean {
  return /^https:\/\/(discord|discordapp)\.com\/api\/webhooks\//.test(webhookUrl());
}

/** GET on the webhook URL returns its own metadata - a safe way to confirm it's real without posting anything. */
export async function verify(): Promise<{ ok: boolean; info?: DiscordWebhookInfo; error?: string }> {
  const url = webhookUrl();
  if (!url) return { ok: false, error: 'No DISCORD_WEBHOOK_URL set.' };
  if (!hasWebhook()) return { ok: false, error: 'That does not look like a Discord webhook URL.' };
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      const d = data as { message?: string } | null;
      if (res.status === 401 || res.status === 404) return { ok: false, error: 'Webhook was rejected - it may have been deleted or the URL is wrong.' };
      return { ok: false, error: d?.message ? `Discord ${res.status}: ${d.message}` : `Discord responded ${res.status}.` };
    }
    const w = data as { name?: string; channel_id?: string; guild_id?: string | null };
    return { ok: true, info: { name: w.name ?? 'Webhook', channelId: w.channel_id ?? '', guildId: w.guild_id ?? null } };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  } finally {
    clearTimeout(timer);
  }
}

/** Posts a message. Always a direct result of an explicit button click in the UI - never called from the LLM's own output. */
export async function postMessage(content: string): Promise<{ ok: boolean; error?: string }> {
  const url = webhookUrl();
  if (!url || !hasWebhook()) return { ok: false, error: 'No webhook connected.' };
  const trimmed = content.trim().slice(0, 2000);
  if (!trimmed) return { ok: false, error: 'Message is empty.' };
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: 'POST',
      signal: ctrl.signal,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: trimmed }),
    });
    if (res.status === 204 || res.ok) return { ok: true };
    const data = await res.json().catch(() => null);
    const d = data as { message?: string } | null;
    return { ok: false, error: d?.message ? `Discord ${res.status}: ${d.message}` : `Discord responded ${res.status}.` };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  } finally {
    clearTimeout(timer);
  }
}

/* ── Bot mode: read, richer post, reversible channel/role management ──── */

export interface DiscordBotIdentity { username: string; id: string; avatarUrl: string | null }
export interface DiscordGuild { id: string; name: string; iconUrl: string | null }
export interface DiscordChannel { id: string; name: string; type: number }
export interface DiscordMessage { id: string; author: string; content: string; timestamp: string }
export interface DiscordRole { id: string; name: string; color: number }
export interface DiscordMember { userId: string; username: string; nick: string | null; roleIds: string[] }

function botToken(): string {
  return env('DISCORD_BOT_TOKEN');
}

export function hasBotToken(): boolean {
  return Boolean(botToken());
}

async function botFetch(path: string, init?: { method?: string; body?: unknown }): Promise<{ ok: boolean; status: number; data: unknown }> {
  const t = botToken();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`https://discord.com/api/v10${path}`, {
      method: init?.method ?? 'GET',
      signal: ctrl.signal,
      headers: {
        Authorization: `Bot ${t}`,
        'User-Agent': UA,
        'Content-Type': 'application/json',
      },
      body: init?.body ? JSON.stringify(init.body) : undefined,
    });
    const data = await res.json().catch(() => null);
    return { ok: res.ok, status: res.status, data };
  } finally {
    clearTimeout(timer);
  }
}

function botErr(status: number, data: unknown, fallback: string): string {
  const d = data as { message?: string } | null;
  if (status === 401) return 'Bot token was rejected (401) - it may be invalid or revoked.';
  if (status === 403) return 'Discord refused (403) - the bot is missing a permission for this action in that server.';
  return d?.message ? `Discord ${status}: ${d.message}` : fallback;
}

export async function verifyBot(): Promise<{ ok: boolean; bot?: DiscordBotIdentity; error?: string }> {
  if (!botToken()) return { ok: false, error: 'No DISCORD_BOT_TOKEN set.' };
  try {
    const { ok, status, data } = await botFetch('/users/@me');
    if (!ok) return { ok: false, error: botErr(status, data, `Discord responded ${status}.`) };
    const u = data as { username: string; id: string; avatar: string | null };
    return {
      ok: true,
      bot: {
        username: u.username,
        id: u.id,
        avatarUrl: u.avatar ? `https://cdn.discordapp.com/avatars/${u.id}/${u.avatar}.png` : null,
      },
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Servers this bot has actually been invited into - never a guessed list. */
export async function listGuilds(): Promise<DiscordGuild[]> {
  if (!botToken()) return [];
  try {
    const { ok, data } = await botFetch('/users/@me/guilds');
    if (!ok || !Array.isArray(data)) return [];
    return (data as Array<{ id: string; name: string; icon: string | null }>).map((g) => ({
      id: g.id,
      name: g.name,
      iconUrl: g.icon ? `https://cdn.discordapp.com/icons/${g.id}/${g.icon}.png` : null,
    }));
  } catch {
    return [];
  }
}

/** Text-capable channels in a guild (types 0=text, 5=announcement, 4=category). */
export async function listChannels(guildId: string): Promise<DiscordChannel[]> {
  if (!botToken() || !guildId) return [];
  try {
    const { ok, data } = await botFetch(`/guilds/${guildId}/channels`);
    if (!ok || !Array.isArray(data)) return [];
    return (data as Array<{ id: string; name: string; type: number }>)
      .filter((c) => [0, 4, 5].includes(c.type))
      .map((c) => ({ id: c.id, name: c.name, type: c.type }));
  } catch {
    return [];
  }
}

/** Most recent messages in a channel, oldest last as Discord returns them. Requires the Message Content privileged intent to see real content. */
export async function getRecentMessages(channelId: string, limit = 20): Promise<DiscordMessage[]> {
  if (!botToken() || !channelId) return [];
  try {
    const { ok, data } = await botFetch(`/channels/${channelId}/messages?limit=${Math.min(limit, 100)}`);
    if (!ok || !Array.isArray(data)) return [];
    return (data as Array<{ id: string; content: string; timestamp: string; author: { username: string } }>).map((m) => ({
      id: m.id,
      author: m.author.username,
      content: m.content,
      timestamp: m.timestamp,
    }));
  } catch {
    return [];
  }
}

/** Posts as the bot into any channel it can see. Always a direct result of a button click. */
export async function postMessageAsBot(channelId: string, content: string): Promise<{ ok: boolean; error?: string }> {
  if (!botToken()) return { ok: false, error: 'No bot connected.' };
  const trimmed = content.trim().slice(0, 2000);
  if (!trimmed) return { ok: false, error: 'Message is empty.' };
  const { ok, status, data } = await botFetch(`/channels/${channelId}/messages`, { method: 'POST', body: { content: trimmed } });
  if (!ok) return { ok: false, error: botErr(status, data, `Discord responded ${status}.`) };
  return { ok: true };
}

export async function listRoles(guildId: string): Promise<DiscordRole[]> {
  if (!botToken() || !guildId) return [];
  try {
    const { ok, data } = await botFetch(`/guilds/${guildId}/roles`);
    if (!ok || !Array.isArray(data)) return [];
    return (data as Array<{ id: string; name: string; color: number }>).map((r) => ({ id: r.id, name: r.name, color: r.color }));
  } catch {
    return [];
  }
}

/** First page of members - enough to pick one from a dropdown, not a full roster dump. Requires the Server Members privileged intent. */
export async function listMembers(guildId: string, limit = 100): Promise<DiscordMember[]> {
  if (!botToken() || !guildId) return [];
  try {
    const { ok, data } = await botFetch(`/guilds/${guildId}/members?limit=${Math.min(limit, 100)}`);
    if (!ok || !Array.isArray(data)) return [];
    return (data as Array<{ user: { id: string; username: string }; nick: string | null; roles: string[] }>).map((m) => ({
      userId: m.user.id,
      username: m.user.username,
      nick: m.nick,
      roleIds: m.roles,
    }));
  } catch {
    return [];
  }
}

/** Grants a role to a member. Reversible with removeRole - never role deletion. */
export async function assignRole(guildId: string, userId: string, roleId: string): Promise<{ ok: boolean; error?: string }> {
  if (!botToken()) return { ok: false, error: 'No bot connected.' };
  const { ok, status, data } = await botFetch(`/guilds/${guildId}/members/${userId}/roles/${roleId}`, { method: 'PUT' });
  if (!ok) return { ok: false, error: botErr(status, data, `Discord responded ${status}.`) };
  return { ok: true };
}

/** Removes a role from a member. Reversible with assignRole. */
export async function removeRole(guildId: string, userId: string, roleId: string): Promise<{ ok: boolean; error?: string }> {
  if (!botToken()) return { ok: false, error: 'No bot connected.' };
  const { ok, status, data } = await botFetch(`/guilds/${guildId}/members/${userId}/roles/${roleId}`, { method: 'DELETE' });
  if (!ok) return { ok: false, error: botErr(status, data, `Discord responded ${status}.`) };
  return { ok: true };
}

/** Creates a new text channel. Reversible in the sense that it can be renamed or archived by hand - creation itself never destroys anything. */
export async function createChannel(guildId: string, name: string): Promise<{ ok: boolean; channel?: DiscordChannel; error?: string }> {
  if (!botToken()) return { ok: false, error: 'No bot connected.' };
  const clean = name.trim().toLowerCase().replace(/\s+/g, '-').slice(0, 100);
  if (!clean) return { ok: false, error: 'Channel name is empty.' };
  const { ok, status, data } = await botFetch(`/guilds/${guildId}/channels`, { method: 'POST', body: { name: clean, type: 0 } });
  if (!ok) return { ok: false, error: botErr(status, data, `Discord responded ${status}.`) };
  const c = data as { id: string; name: string; type: number };
  return { ok: true, channel: { id: c.id, name: c.name, type: c.type } };
}

/** Renames an existing channel. No delete counterpart is exposed - that action is permanent on Discord's side with no undo. */
export async function renameChannel(channelId: string, name: string): Promise<{ ok: boolean; error?: string }> {
  if (!botToken()) return { ok: false, error: 'No bot connected.' };
  const clean = name.trim().toLowerCase().replace(/\s+/g, '-').slice(0, 100);
  if (!clean) return { ok: false, error: 'Channel name is empty.' };
  const { ok, status, data } = await botFetch(`/channels/${channelId}`, { method: 'PATCH', body: { name: clean } });
  if (!ok) return { ok: false, error: botErr(status, data, `Discord responded ${status}.`) };
  return { ok: true };
}
