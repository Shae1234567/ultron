import { getAccessToken } from './googleAuth';

/** Required OAuth scope: drive.readonly. */

const API_BASE = 'https://www.googleapis.com/drive/v3/files';
const FIELDS = 'files(id,name,mimeType,modifiedTime,webViewLink)';

export interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  modifiedTime: string;
  webViewLink?: string;
}

interface DriveFilesResponse {
  files?: Array<{
    id?: string;
    name?: string;
    mimeType?: string;
    modifiedTime?: string;
    webViewLink?: string;
  }>;
  error?: { message?: string };
}

function mapFiles(data: DriveFilesResponse | null): DriveFile[] {
  return (data?.files ?? []).map((f) => ({
    id: f.id ?? '',
    name: f.name ?? '(untitled)',
    mimeType: f.mimeType ?? '',
    modifiedTime: f.modifiedTime ?? '',
    webViewLink: f.webViewLink,
  }));
}

export async function listRecent(limit = 15): Promise<{ ok: boolean; files?: DriveFile[]; error?: string }> {
  try {
    const auth = await getAccessToken();
    if (!auth.ok || !auth.token) {
      return { ok: false, error: auth.error || 'Not connected to Google.' };
    }

    const params = new URLSearchParams({
      orderBy: 'modifiedTime desc',
      pageSize: String(limit),
      fields: FIELDS,
    });

    const res = await fetch(`${API_BASE}?${params.toString()}`, {
      headers: { Authorization: `Bearer ${auth.token}` },
    });
    const data = (await res.json().catch(() => null)) as DriveFilesResponse | null;

    if (!res.ok) {
      return { ok: false, error: data?.error?.message || `Drive responded ${res.status}.` };
    }

    return { ok: true, files: mapFiles(data) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function searchFiles(query: string, limit = 15): Promise<{ ok: boolean; files?: DriveFile[]; error?: string }> {
  try {
    const auth = await getAccessToken();
    if (!auth.ok || !auth.token) {
      return { ok: false, error: auth.error || 'Not connected to Google.' };
    }

    const escaped = query.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    const params = new URLSearchParams({
      q: `name contains '${escaped}'`,
      pageSize: String(limit),
      fields: FIELDS,
    });

    const res = await fetch(`${API_BASE}?${params.toString()}`, {
      headers: { Authorization: `Bearer ${auth.token}` },
    });
    const data = (await res.json().catch(() => null)) as DriveFilesResponse | null;

    if (!res.ok) {
      return { ok: false, error: data?.error?.message || `Drive responded ${res.status}.` };
    }

    return { ok: true, files: mapFiles(data) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
