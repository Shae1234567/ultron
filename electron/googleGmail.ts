import { getAccessToken } from './googleAuth';

/** Required OAuth scopes: gmail.readonly (listUnread), gmail.send (sendMessage). */

const API_BASE = 'https://gmail.googleapis.com/gmail/v1/users/me';

export interface GmailMessage {
  id: string;
  from: string;
  subject: string;
  snippet: string;
  date: string;
  unread: boolean;
}

function headerValue(headers: Array<{ name?: string; value?: string }> | undefined, name: string): string {
  const h = headers?.find((x) => (x.name ?? '').toLowerCase() === name.toLowerCase());
  return h?.value ?? '';
}

export async function listUnread(limit = 10): Promise<{ ok: boolean; messages?: GmailMessage[]; error?: string }> {
  try {
    const auth = await getAccessToken();
    if (!auth.ok || !auth.token) {
      return { ok: false, error: auth.error || 'Not connected to Google.' };
    }
    const headers = { Authorization: `Bearer ${auth.token}` };

    const listRes = await fetch(
      `${API_BASE}/messages?q=is:unread&maxResults=${encodeURIComponent(String(limit))}`,
      { headers },
    );
    const listData = (await listRes.json().catch(() => null)) as {
      messages?: Array<{ id: string }>;
      error?: { message?: string };
    } | null;

    if (!listRes.ok) {
      return { ok: false, error: listData?.error?.message || `Gmail responded ${listRes.status}.` };
    }

    const ids = (listData?.messages ?? []).map((m) => m.id).filter(Boolean);
    const messages: GmailMessage[] = [];

    for (const id of ids) {
      try {
        const detailRes = await fetch(
          `${API_BASE}/messages/${encodeURIComponent(id)}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`,
          { headers },
        );
        const detail = (await detailRes.json().catch(() => null)) as {
          id?: string;
          snippet?: string;
          labelIds?: string[];
          payload?: { headers?: Array<{ name?: string; value?: string }> };
        } | null;
        if (!detailRes.ok || !detail) continue;

        messages.push({
          id: detail.id ?? id,
          from: headerValue(detail.payload?.headers, 'From'),
          subject: headerValue(detail.payload?.headers, 'Subject'),
          snippet: detail.snippet ?? '',
          date: headerValue(detail.payload?.headers, 'Date'),
          unread: Boolean(detail.labelIds?.includes('UNREAD')),
        });
      } catch {
        // Skip messages we can't fetch details for rather than failing the whole list.
      }
    }

    return { ok: true, messages };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function sendMessage(to: string, subject: string, body: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const auth = await getAccessToken();
    if (!auth.ok || !auth.token) {
      return { ok: false, error: auth.error || 'Not connected to Google.' };
    }

    const raw = [
      `To: ${to}`,
      `Subject: ${subject}`,
      'Content-Type: text/plain; charset=utf-8',
      '',
      body,
    ].join('\r\n');

    const encoded = Buffer.from(raw, 'utf8')
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/g, '');

    const res = await fetch(`${API_BASE}/messages/send`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${auth.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ raw: encoded }),
    });
    const data = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;

    if (!res.ok) {
      return { ok: false, error: data?.error?.message || `Gmail responded ${res.status}.` };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
