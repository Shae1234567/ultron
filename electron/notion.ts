import { env } from './env';

/**
 * Real Notion connector. Free tier: an internal integration token, no OAuth
 * flow needed. The integration can only see pages/databases the operator has
 * explicitly shared with it from within Notion - that's Notion's own model,
 * not a limitation we impose. Every function returns an honest empty/failed
 * result on any error, never a fabricated page list.
 */

const UA = 'Ultron-Personal-Assistant/0.1 (local desktop app; no distribution)';
const TIMEOUT_MS = 10000;
const NOTION_VERSION = '2022-06-28';

export interface NotionUser {
  botName: string | null;
  workspaceName: string | null;
}

export interface NotionItem {
  id: string;
  title: string;
  url: string;
  type: 'page' | 'database';
  lastEditedTime: string;
}

function token(): string {
  return env('NOTION_TOKEN');
}

export function hasToken(): boolean {
  return Boolean(token());
}

async function notionFetch(path: string, init?: { method?: string; body?: unknown }): Promise<{ ok: boolean; status: number; data: unknown }> {
  const t = token();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`https://api.notion.com/v1${path}`, {
      method: init?.method ?? 'GET',
      signal: ctrl.signal,
      headers: {
        Authorization: `Bearer ${t}`,
        'Notion-Version': NOTION_VERSION,
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

/** Verifies the token actually works and returns which integration it is. */
export async function verify(): Promise<{ ok: boolean; user?: NotionUser; error?: string }> {
  if (!token()) return { ok: false, error: 'No NOTION_TOKEN set.' };
  try {
    const { ok, status, data } = await notionFetch('/users/me');
    if (!ok) {
      const d = data as { message?: string } | null;
      if (status === 401) return { ok: false, error: 'Token was rejected (401) - it may be invalid, expired, or revoked.' };
      return { ok: false, error: d?.message ? `Notion ${status}: ${d.message}` : `Notion responded ${status}.` };
    }
    const u = data as { name?: string; bot?: { workspace_name?: string } };
    return { ok: true, user: { botName: u.name ?? null, workspaceName: u.bot?.workspace_name ?? null } };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

function extractTitle(result: Record<string, unknown>): string {
  if (result.object === 'database') {
    const title = result.title as Array<{ plain_text?: string }> | undefined;
    const joined = (title ?? []).map((t) => t.plain_text ?? '').join('').trim();
    return joined || '(untitled database)';
  }
  const properties = (result.properties ?? {}) as Record<string, { type?: string; title?: Array<{ plain_text?: string }> }>;
  for (const prop of Object.values(properties)) {
    if (prop.type === 'title' && Array.isArray(prop.title)) {
      const joined = prop.title.map((t) => t.plain_text ?? '').join('').trim();
      if (joined) return joined;
    }
  }
  return '(untitled page)';
}

/** Pages and databases actually shared with this integration, most recently edited first. */
export async function search(limit = 10): Promise<NotionItem[]> {
  if (!token()) return [];
  try {
    const { ok, data } = await notionFetch('/search', {
      method: 'POST',
      body: { page_size: Math.min(limit, 100), sort: { direction: 'descending', timestamp: 'last_edited_time' } },
    });
    const results = (data as { results?: unknown[] } | null)?.results;
    if (!ok || !Array.isArray(results)) return [];
    return (results as Array<Record<string, unknown>>).slice(0, limit).map((r) => ({
      id: r.id as string,
      title: extractTitle(r),
      url: (r.url as string) ?? '',
      type: (r.object as 'page' | 'database') ?? 'page',
      lastEditedTime: (r.last_edited_time as string) ?? '',
    }));
  } catch {
    return [];
  }
}
