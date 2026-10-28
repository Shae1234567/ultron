import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const chat = vi.fn(async (_req: unknown) => ({ text: 'Question 1: What is 7 x 8?\nWhat it shows: a times table.', provider: 'stub-vision' }));
vi.mock('electron', () => ({ app: { getPath: () => '' }, BrowserWindow: class {}, session: { fromPartition: () => ({}) }, shell: {} }));
vi.mock('./brain/llm', () => ({ chat }));
vi.mock('./store', () => ({ getSettings: () => ({ d2l: { baseUrl: 'https://d2l.cbe.ab.ca' } }) }));
vi.mock('./tasks', () => ({}));
vi.mock('./brain/events', () => ({ emit: () => {} }));
const connectedApps = vi.fn(async () => [{ slug: 'googledrive' }]);
const findActions = vi.fn(async (): Promise<{ actions: { slug: string; params: Record<string, string> }[] }> => ({ actions: [{ slug: 'GOOGLEDRIVE_DOWNLOAD_FILE', params: { file_id: 'string', mime_type: 'string' } }] }));
const runAction = vi.fn();
vi.mock('./composio', () => ({ connectedApps, findActions, runAction }));
vi.mock('./dashboard', () => ({
  findArray: (data: unknown, key: string): unknown[] => {
    const walk = (v: unknown): unknown[] => {
      if (!v || typeof v !== 'object') return [];
      if (Array.isArray((v as Record<string, unknown>)[key])) return (v as Record<string, unknown[]>)[key];
      for (const x of Object.values(v as Record<string, unknown>)) { const r = walk(x); if (r.length) return r; }
      return [];
    };
    return walk(data);
  },
}));
const youtube = vi.fn(async () => ({ title: 'Photosynthesis in 5 minutes', channel: 'Science Guy', duration: '5:01', url: 'https://youtu.be/abc', transcript: 'Plants turn light into sugar.' }));
vi.mock('./addons', () => ({ youtube }));

const { imageType, linkWhere, pageLinks, readBytes, readLink } = await import('./reader');
const { isSafeD2lUrl } = await import('./d2l');
const drive = await import('./drive');

const BASE = 'https://d2l.cbe.ab.ca';

describe('going through D2L safely (read-only)', () => {
  it('opens ordinary pages, content, news, discussions and files', () => {
    for (const p of ['/d2l/home/12345', '/d2l/le/content/12345/viewContent/678/View', '/d2l/le/news/12345/9/view', '/d2l/le/12345/discussions/topics/55/View',
      '/d2l/api/le/1.70/12345/content/toc', '/d2l/lms/quizzing/user/quizzes_list.d2l?ou=12345', '/d2l/lms/dropbox/user/folders_list.d2l?ou=12345',
      '/d2l/lms/dropbox/user/folder_user_view_feedback.d2l?db=1&ou=2', 'https://d2l.cbe.ab.ca/d2l/le/calendar/12345']) {
      expect(isSafeD2lUrl(p, BASE)).toBe(true);
    }
  });
  it('refuses anything that does something when opened - quiz attempts, submitting, signing out, deleting', () => {
    for (const p of ['/d2l/logout', '/d2l/lp/auth/login/logout.d2l', '/d2l/lms/quizzing/user/attempt/quiz_start_frame_auto.d2l?ou=1&qi=2',
      '/d2l/lms/quizzing/user/quiz_attempt.d2l?qi=4', '/d2l/lms/dropbox/user/folder_submit_files.d2l?db=1', '/d2l/le/12345/discussions/posts/9/delete',
      '/d2l/lms/survey/user/attempt/survey_start_frame.d2l', '/d2l/le/news/12345/9/markasread', '/d2l/le/12345/discussions/topics/5/subscribe']) {
      expect(isSafeD2lUrl(p, BASE)).toBe(false);
    }
  });
  it('only opens D2L itself', () => {
    expect(isSafeD2lUrl('https://evil.example.com/d2l/home/1', BASE)).toBe(false);
    expect(isSafeD2lUrl('not a url at all', BASE)).toBe(true); // a relative path on D2L
  });
});

describe('links on a page', () => {
  const html = `<a href="/d2l/le/content/1/viewContent/2/View">Unit 2 notes</a>
    <a href="https://docs.google.com/document/d/1AbCdEfGhIjKlMnOpQrStUvWx/edit">Lab <b>handout</b></a>
    <a href="https://www.youtube.com/watch?v=abc">Video</a><a href="worksheet.pdf">Worksheet</a>
    <a href="javascript:void(0)">menu</a><a href="#top">top</a><a href="mailto:t@cbe.ab.ca">email</a>
    <a href="/d2l/le/content/1/viewContent/2/View">Unit 2 notes again</a>
    <iframe src="https://docs.google.com/presentation/d/1ZyXwVuTsRqPoNmLkJiHgFeDc/embed"></iframe>`;
  const links = pageLinks(html, `${BASE}/d2l/home/1`, BASE);
  it('keeps real links, absolute and once each, and says where they go', () => {
    expect(links.map((l) => [l.text, l.where])).toEqual([
      ['embedded content', 'embedded'],
      ['Unit 2 notes', 'd2l'],
      ['Lab handout', 'drive'],
      ['Video', 'youtube'],
      // a file on D2L itself: read over his D2L sign-in, so it counts as D2L
      ['Worksheet', 'd2l'],
    ]);
    expect(links[1].url).toBe(`${BASE}/d2l/le/content/1/viewContent/2/View`);
    expect(links[4].url).toBe(`${BASE}/d2l/home/worksheet.pdf`);
  });
  it('knows the kinds of place', () => {
    expect(linkWhere('https://youtu.be/xyz')).toBe('youtube');
    expect(linkWhere('https://drive.google.com/file/d/1abcdefghijklmnopqrstu/view')).toBe('drive');
    expect(linkWhere('https://example.com/notes.pptx')).toBe('file');
    expect(linkWhere('https://example.com/page')).toBe('web');
  });
});

describe('reading bytes', () => {
  beforeEach(() => chat.mockClear());
  it('spots pictures by their first bytes, whatever they are called', () => {
    expect(imageType(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d]), 'x.dat')).toBe('image/png');
    expect(imageType(Buffer.from([0xff, 0xd8, 0xff]), 'scan')).toBe('image/jpeg');
    expect(imageType(Buffer.from('%PDF-1.4'), 'a.pdf')).toBeNull();
  });
  it('reads a picture by eye - the vision model gets the picture and transcribes it', async () => {
    const r = await readBytes(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]), 'worksheet.jpg');
    expect(r).toMatchObject({ kind: 'picture (read by eye)', seenBy: 'stub-vision' });
    expect('text' in r && r.text).toMatch(/7 x 8/);
    const call = chat.mock.calls[0][0] as unknown as { messages: { images: { mimeType: string; data: string }[] }[] };
    expect(call.messages[0].images[0].mimeType).toBe('image/jpeg');
  });
  it('reads documents directly, without the vision model', async () => {
    const r = await readBytes(Buffer.from('Chapter 1\nThe Mongols rode west.'), 'notes.txt');
    expect(r).toMatchObject({ kind: 'text' });
    expect(chat).not.toHaveBeenCalled();
  });
});

describe('reading links', () => {
  afterEach(() => vi.unstubAllGlobals());
  it('a YouTube link gives its transcript', async () => {
    const r = await readLink('https://www.youtube.com/watch?v=abc');
    expect(r).toMatchObject({ kind: 'YouTube video (transcript)', title: 'Photosynthesis in 5 minutes' });
    expect('text' in r && r.text).toMatch(/light into sugar/);
  });
  it('a web page gives its text and its links; a PDF on the web is read as a document', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => (url.endsWith('.txt')
      ? new Response('Rubric: 4 marks for sources.', { headers: { 'content-type': 'text/plain' } })
      : new Response('<html><title>Unit 3</title><body><h1>Cells</h1><p>Read pages 4-9.</p><a href="/more">More</a></body></html>', { headers: { 'content-type': 'text/html' } }))));
    const page = await readLink('https://teacher.example.com/unit3');
    expect(page).toMatchObject({ kind: 'web page', title: 'Unit 3' });
    expect('text' in page && page.text).toMatch(/Read pages 4-9/);
    expect('links' in page && page.links?.[0].text).toBe('More');
    const doc = await readLink('https://teacher.example.com/rubric.txt');
    expect('text' in doc && doc.text).toMatch(/4 marks/);
  });
  it('refuses things that are not web addresses', async () => {
    expect(await readLink('C:\\Users\\x.pdf')).toMatchObject({ error: expect.stringMatching(/not a web address/) });
  });
});

describe('Google Drive', () => {
  beforeEach(() => { runAction.mockReset(); drive.resetDriveActions(); });
  afterEach(() => vi.unstubAllGlobals());

  it('finds file ids in every kind of Google link', () => {
    expect(drive.driveIdFrom('https://docs.google.com/document/d/1AbCdEfGhIjKlMnOpQrStUvWx/edit?usp=sharing')).toBe('1AbCdEfGhIjKlMnOpQrStUvWx');
    expect(drive.driveIdFrom('https://drive.google.com/file/d/1abcdefghijklmnopqrstu/view')).toBe('1abcdefghijklmnopqrstu');
    expect(drive.driveIdFrom('https://drive.google.com/open?id=1abcdefghijklmnopqrstu')).toBe('1abcdefghijklmnopqrstu');
    expect(drive.driveIdFrom('History essay')).toBeNull();
    expect(drive.mimeFromUrl('https://docs.google.com/presentation/d/1x/edit')).toBe('application/vnd.google-apps.presentation');
  });
  it('escapes a search so a quote cannot break it', () => {
    expect(drive.searchQuery("Shae's essay")).toBe("trashed = false and (name contains 'Shae\\'s essay' or fullText contains 'Shae\\'s essay')");
  });
  it('finds the file wherever Composio put it (nested, or inside a JSON string)', () => {
    expect(drive.findFileRef({ data: { downloaded_file_content: { s3url: 'https://s3.example/f', mimetype: 'application/pdf', name: 'a.pdf' } } })).toEqual({ url: 'https://s3.example/f', mimeType: 'application/pdf', name: 'a.pdf' });
    expect(drive.findFileRef(JSON.stringify({ result: [{ file: { s3url: 'https://s3.example/g' } }] }))?.url).toBe('https://s3.example/g');
    expect(drive.findText({ data: { content: 'Plain export' } })).toBe('Plain export');
  });

  it('reads a Google Doc by its link: exported as Word, read with its table', async () => {
    const { deflateRawSync } = await import('node:zlib');
    // a minimal real .docx (same zip writer as docs.test)
    const make = (files: Record<string, string>) => {
      const locals: Buffer[] = []; const central: Buffer[] = []; let off = 0;
      for (const [name, content] of Object.entries(files)) {
        const data = Buffer.from(content); const comp = deflateRawSync(data); const n = Buffer.from(name);
        const lh = Buffer.alloc(30); lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(8, 8); lh.writeUInt32LE(comp.length, 18); lh.writeUInt32LE(data.length, 22); lh.writeUInt16LE(n.length, 26);
        locals.push(lh, n, comp);
        const ch = Buffer.alloc(46); ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(8, 10); ch.writeUInt32LE(comp.length, 20); ch.writeUInt32LE(data.length, 24); ch.writeUInt16LE(n.length, 28); ch.writeUInt32LE(off, 42);
        central.push(ch, n); off += 30 + n.length + comp.length;
      }
      const cd = Buffer.concat(central); const end = Buffer.alloc(22);
      end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(Object.keys(files).length, 8); end.writeUInt16LE(Object.keys(files).length, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(off, 16);
      return Buffer.concat([...locals, cd, end]);
    };
    const docx = make({ 'word/document.xml': '<w:document><w:body><w:p><w:r><w:t>Lab: osmosis</w:t></w:r></w:p></w:body></w:document>' });
    runAction.mockImplementation(async (slug: string, args: Record<string, unknown>) => {
      if (slug === 'GOOGLEDRIVE_DOWNLOAD_FILE') {
        expect(args).toEqual({ file_id: '1AbCdEfGhIjKlMnOpQrStUvWx', mime_type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
        return { ok: true, data: { downloaded_file_content: { s3url: 'https://s3.example/doc', mimetype: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', name: 'Lab handout' } } };
      }
      return { ok: false, error: 'not needed' };
    });
    vi.stubGlobal('fetch', vi.fn(async () => new Response(docx)));
    const r = await readLink('https://docs.google.com/document/d/1AbCdEfGhIjKlMnOpQrStUvWx/edit');
    expect(r).toMatchObject({ kind: 'Google Doc (word)', title: 'Lab handout.docx' });
    expect('text' in r && r.text).toBe('Lab: osmosis');
  });

  it('a folder lists its files instead', async () => {
    runAction.mockImplementation(async (slug: string) => (slug.endsWith('FIND_FILE')
      ? { ok: true, data: { files: [{ id: 'f1', name: 'Essay draft', mimeType: 'application/vnd.google-apps.document' }] } }
      : { ok: false, error: 'no' }));
    const r = await readLink('https://drive.google.com/drive/folders/1FolderIdAbcdefghijklm');
    expect(r).toMatchObject({ kind: 'Drive folder' });
    expect('text' in r && r.text).toMatch(/Essay draft \(Google Doc\) id f1/);
  });

  it('without a Google connection, a publicly shared Doc is still read; a private one says what to do', async () => {
    connectedApps.mockResolvedValueOnce([]);
    const { deflateRawSync } = await import('node:zlib');
    void deflateRawSync;
    vi.stubGlobal('fetch', vi.fn(async (url: string) => (url.includes('/export?format=docx')
      ? new Response('<html>sign in</html>', { status: 200, headers: { 'content-type': 'text/html' } })
      : new Response('', { status: 404 }))));
    const r = await readLink('https://docs.google.com/document/d/1AbCdEfGhIjKlMnOpQrStUvWx/edit');
    expect(r).toMatchObject({ error: expect.stringMatching(/isn't public.*connect "Google Drive", "Google Docs"/) });
  });

  it('says plainly when a file is not shared with him', async () => {
    runAction.mockResolvedValue({ ok: false, error: 'File not found: 1abc (404)' });
    const r = await readLink('https://drive.google.com/file/d/1abcdefghijklmnopqrstu/view');
    expect(r).toMatchObject({ error: expect.stringMatching(/won't open that file for your account/) });
  });
});

describe('Google Slides, every way they arrive (12 Oct 2026)', () => {
  it('reads a published deck from Google\'s viewer page - each slide\'s words from its accessibility labels', async () => {
    const { publishedSlidesText } = await import('./googleApps');
    // How Google's page escapes the slide pictures inside its script: \x3c for <, \/ for / and so on.
    const esc = (s: string) => s.replace(/\//g, '\\/').replace(/</g, '\\x3c').replace(/>/g, '\\x3e').replace(/=/g, '\\x3d').replace(/"/g, '\\x22');
    const slide = (labels: string[]) => esc(`<svg viewBox="0 0 960 540">${labels.map((l) => `<g role="img" aria-label="${l}"><path d="m0 0"/></g>`).join('')}</svg>`);
    const html = `<html><head><title>Cell Biology Unit 2 - Google Slides</title></head><script>var data = ['${slide(['Cells &amp; tissues', 'Unit 2&#xa;Grade 9'])}', '${slide(['Osmosis', 'Water moves across a membrane'])}'];</script></html>`;
    const r = publishedSlidesText(html);
    expect(r.title).toBe('Cell Biology Unit 2');
    expect(r.slides).toEqual(['Cells & tissues\nUnit 2\nGrade 9', 'Osmosis\nWater moves across a membrane']);
  });

  it('reads the Slides API: words in order, tables as rows, and the speaker notes', async () => {
    const { slidesJsonText } = await import('./googleApps');
    const t = (s: string) => ({ textElements: [{ textRun: { content: s } }] });
    const deck = {
      data: { response_data: JSON.stringify({
        title: 'Biodiversity 2A-2C',
        slides: [
          { pageElements: [{ shape: { text: t('2A Species diversity\n') } }, { table: { tableRows: [{ tableCells: [{ text: t('Biome') }, { text: t('Species') }] }, { tableCells: [{ text: t('Forest') }, { text: t('120') }] }] } }],
            slideProperties: { notesPage: { notesProperties: { speakerNotesObjectId: 'n1' }, pageElements: [{ objectId: 'x', shape: { text: t('slide number') } }, { objectId: 'n1', shape: { text: t('Ask them for examples') } }] } } },
          { pageElements: [{ elementGroup: { children: [{ shape: { text: t('2B Ecosystems') } }] } }] },
        ],
      }) },
    };
    const r = slidesJsonText(deck);
    expect(r.title).toBe('Biodiversity 2A-2C');
    expect(r.slides).toBe(2);
    expect(r.text).toBe('## Slide 1\n2A Species diversity\nBiome | Species\nForest | 120\nSpeaker notes: Ask them for examples\n\n## Slide 2\n2B Ecosystems');
  });

  it('reads the Docs API: paragraphs and tables in order', async () => {
    const { docsJsonText } = await import('./googleApps');
    const p = (s: string) => ({ paragraph: { elements: [{ textRun: { content: s } }] } });
    const doc = { title: 'Lab handout', body: { content: [p('Osmosis lab\n'), p('Steps:\n'), { table: { tableRows: [{ tableCells: [{ content: [p('Time')] }, { content: [p('Mass')] }] }] } }] } };
    expect(docsJsonText({ data: doc })).toEqual({ title: 'Lab handout', text: 'Osmosis lab\nSteps:\nTime | Mass' });
  });

  it('with the Google Slides app connected (and no Drive), a Slides link is read through it', async () => {
    const { resetGoogleApps } = await import('./googleApps');
    resetGoogleApps();
    drive.resetDriveActions();
    connectedApps.mockResolvedValue([{ slug: 'googleslides' }]);
    findActions.mockResolvedValueOnce({ actions: [{ slug: 'GOOGLESLIDES_PRESENTATIONS_GET', params: { presentationId: 'string' } }] });
    runAction.mockReset();
    runAction.mockImplementation(async (slug: string, args: Record<string, unknown>) => {
      expect(slug).toBe('GOOGLESLIDES_PRESENTATIONS_GET');
      expect(args).toEqual({ presentationId: '1SlidesIdAbcdefghijklmnop' });
      return { ok: true, data: { title: 'Unit 2', slides: [{ pageElements: [{ shape: { text: { textElements: [{ textRun: { content: 'Food webs' } }] } } }] }] } };
    });
    const r = await readLink('https://docs.google.com/presentation/d/1SlidesIdAbcdefghijklmnop/edit#slide=id.p');
    expect(r).toMatchObject({ kind: 'Google Slides', title: 'Unit 2' });
    expect('text' in r && r.text).toBe('## Slide 1\nFood webs');
    connectedApps.mockResolvedValue([{ slug: 'googledrive' }]);
  });
});
