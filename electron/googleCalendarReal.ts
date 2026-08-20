import { getAccessToken } from './googleAuth';

/** Required OAuth scope: calendar. */

const API_BASE = 'https://www.googleapis.com/calendar/v3/calendars/primary/events';

export interface CalendarEvent {
  id: string;
  title: string;
  start: string;
  end: string;
  location?: string;
}

export async function listUpcoming(limit = 10): Promise<{ ok: boolean; events?: CalendarEvent[]; error?: string }> {
  try {
    const auth = await getAccessToken();
    if (!auth.ok || !auth.token) {
      return { ok: false, error: auth.error || 'Not connected to Google.' };
    }

    const params = new URLSearchParams({
      timeMin: new Date().toISOString(),
      maxResults: String(limit),
      singleEvents: 'true',
      orderBy: 'startTime',
    });

    const res = await fetch(`${API_BASE}?${params.toString()}`, {
      headers: { Authorization: `Bearer ${auth.token}` },
    });
    const data = (await res.json().catch(() => null)) as {
      items?: Array<{
        id?: string;
        summary?: string;
        location?: string;
        start?: { dateTime?: string; date?: string };
        end?: { dateTime?: string; date?: string };
      }>;
      error?: { message?: string };
    } | null;

    if (!res.ok) {
      return { ok: false, error: data?.error?.message || `Calendar responded ${res.status}.` };
    }

    const events: CalendarEvent[] = (data?.items ?? []).map((item) => ({
      id: item.id ?? '',
      title: item.summary ?? '(no title)',
      start: item.start?.dateTime ?? item.start?.date ?? '',
      end: item.end?.dateTime ?? item.end?.date ?? '',
      location: item.location,
    }));

    return { ok: true, events };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function createEvent(
  title: string,
  startIso: string,
  endIso: string,
  description?: string,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const auth = await getAccessToken();
    if (!auth.ok || !auth.token) {
      return { ok: false, error: auth.error || 'Not connected to Google.' };
    }

    const res = await fetch(API_BASE, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${auth.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        summary: title,
        start: { dateTime: startIso },
        end: { dateTime: endIso },
        description,
      }),
    });
    const data = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;

    if (!res.ok) {
      return { ok: false, error: data?.error?.message || `Calendar responded ${res.status}.` };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
