import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({ app: { getPath: () => '.' }, shell: { openExternal: vi.fn() } }));
vi.mock('./composio', () => ({}));
vi.mock('./d2l', () => ({}));
vi.mock('./discord', () => ({}));
vi.mock('./spotifyLocal', () => ({}));
vi.mock('./brain/events', () => ({ emit: vi.fn() }));

import { driveItems, findArray, gmailItems, isSameLocalDay, senderName, snowflakeTime, toIso, youtubeItems } from './dashboard';

const now = new Date(2026, 9, 4, 15, 0); // 4 Oct 2026, 3 pm local

describe('finding the list in a Composio result', () => {
  it('looks through the SDK and Connect wrappers, and JSON strings', () => {
    expect(findArray({ data: { messages: [1, 2] } }, 'messages')).toEqual([1, 2]);
    expect(findArray({ results: [{ response: { data: { files: ['a'] } } }] }, 'files')).toEqual(['a']);
    expect(findArray(JSON.stringify({ data: { items: [3] } }), 'items')).toEqual([3]);
    expect(findArray({ data: {} }, 'messages')).toEqual([]);
    expect(findArray(null, 'messages')).toEqual([]);
  });
});

describe('Gmail', () => {
  const msg = (id: string, at: Date, extra: Record<string, unknown> = {}) => ({
    messageId: id, threadId: `t${id}`, subject: `Subject ${id}`, sender: 'Coach Sam <sam@club.example>', messageTimestamp: at.toISOString(), labelIds: ['INBOX'], ...extra,
  });

  it('keeps only today\'s mail, newest first, with unread and links', () => {
    const items = gmailItems({ data: { messages: [
      msg('1', new Date(2026, 9, 4, 9, 30)),
      msg('2', new Date(2026, 9, 3, 23, 50)),
      msg('3', new Date(2026, 9, 4, 14, 5), { labelIds: ['INBOX', 'UNREAD', 'IMPORTANT'] }),
    ] } }, now);
    expect(items.map((i) => i.id)).toEqual(['3', '1']);
    expect(items[0]).toMatchObject({ title: 'Subject 3', sub: 'Coach Sam', unread: true, urgent: true, url: 'https://mail.google.com/mail/u/0/#inbox/t3' });
    expect(items[1].unread).toBe(false);
  });

  it('copes with missing subjects and epoch timestamps', () => {
    const at = new Date(2026, 9, 4, 8, 0).getTime();
    const [item] = gmailItems({ messages: [{ messageId: 'x', sender: 'noreply@school.example', messageTimestamp: String(at), labelIds: [] }] }, now);
    expect(item.title).toBe('(no subject)');
    expect(item.sub).toBe('noreply');
  });

  it('reads sender names', () => {
    expect(senderName('"Riverside FC" <info@riverside.example>')).toBe('Riverside FC');
    expect(senderName('alex@example.com')).toBe('alex');
  });
});

describe('YouTube', () => {
  it('turns playlist items into watch links and drops deleted videos', () => {
    const items = youtubeItems({ data: { items: [
      { snippet: { title: 'How volcanoes work', videoOwnerChannelTitle: 'Science Now', thumbnails: { medium: { url: 'https://i.ytimg.com/vi/abcdefghijk/mq.jpg' } } }, contentDetails: { videoId: 'abcdefghijk', videoPublishedAt: '2026-10-03T12:00:00Z' } },
      { snippet: { title: 'Deleted video' }, contentDetails: { videoId: 'zzzzzzzzzzz' } },
    ] } });
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ id: 'abcdefghijk', title: 'How volcanoes work', sub: 'Science Now', url: 'https://www.youtube.com/watch?v=abcdefghijk', thumb: 'https://i.ytimg.com/vi/abcdefghijk/mq.jpg' });
  });
});

describe('Drive', () => {
  it('names the file type and who edited it', () => {
    const items = driveItems({ data: { files: [
      { id: '1', name: 'Science lab', mimeType: 'application/vnd.google-apps.document', modifiedTime: '2026-10-04T10:00:00Z', webViewLink: 'https://docs.google.com/document/d/1', lastModifyingUser: { me: true } },
      { id: '2', name: 'Team stats', mimeType: 'application/vnd.google-apps.spreadsheet', modifiedTime: '2026-10-02T10:00:00Z', lastModifyingUser: { displayName: 'Sam', me: false } },
    ] } });
    expect(items.map((i) => i.sub)).toEqual(['Doc', 'Sheet · edited by Sam']);
    expect(items[0].url).toBe('https://docs.google.com/document/d/1');
  });
});

describe('times', () => {
  it('normalizes timestamps', () => {
    expect(toIso('1791150919')).toBe(new Date(1791150919 * 1000).toISOString());
    expect(toIso('2026-10-04T10:00:00Z')).toBe('2026-10-04T10:00:00.000Z');
    expect(toIso('soon')).toBeNull();
    expect(isSameLocalDay(new Date(2026, 9, 4, 0, 1).toISOString(), now)).toBe(true);
    expect(isSameLocalDay(new Date(2026, 9, 3, 23, 59).toISOString(), now)).toBe(false);
  });

  it('reads the time inside a Discord id', () => {
    // Discord's own documented example: 175928847299117063 was created 2016-04-30 11:18:25.796 UTC.
    expect(new Date(snowflakeTime('175928847299117063')).toISOString()).toBe('2016-04-30T11:18:25.796Z');
    expect(snowflakeTime(undefined)).toBe(0);
  });
});
