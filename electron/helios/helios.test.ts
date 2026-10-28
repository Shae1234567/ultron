import { beforeEach, describe, expect, it, vi } from 'vitest';

const docs = new Map<string, unknown>();
const notes = new Map<string, string>();
vi.mock('../store', () => ({
  readDoc: (n: string, f: unknown) => (docs.has(n) ? structuredClone(docs.get(n)) : f),
  writeDoc: (n: string, d: unknown) => { docs.set(n, structuredClone(d)); },
  getSettings: () => ({ profile: { interests: ['Mongol Empire', 'Minecraft'] }, helios: { on: true } }),
}));
vi.mock('../brain/events', () => ({ emit: () => {} }));
vi.mock('../memory/vault', () => ({ readNote: (r: string) => notes.get(r) ?? null, writeNote: (r: string, c: string) => { notes.set(r, c); return r; } }));
vi.mock('../departments/school/store', () => ({ load: () => ({ gradeHistory: [{ date: '2026-10-10', course: 'Math 9', grade: '87 %', pct: 87 }] }) }));

const { parseFeed } = await import('./feeds');
const { scoreItem } = await import('./triage');
const store = await import('./store');
const sweep = await import('./sweep');

beforeEach(() => { docs.clear(); notes.clear(); vi.unstubAllGlobals(); });

const RSS = `<?xml version="1.0"?><rss><channel><title>x</title>
<item><title><![CDATA[Cavalry FC win the CPL final]]></title><link>https://example.com/a</link><pubDate>Fri, 10 Oct 2026 10:00:00 GMT</pubDate><description>&lt;p&gt;Calgary side lift the trophy&lt;/p&gt;</description></item>
<item><title>Stock markets slide</title><link>https://example.com/b</link></item></channel></rss>`;
const ATOM = `<feed><entry><title>New Minecraft update adds copper golems</title><link href="https://example.com/c"/><updated>2026-10-10T08:00:00Z</updated><summary>Patch notes</summary></entry></feed>`;

describe('Helios reads feeds', () => {
  it('reads RSS and Atom: titles, links, dates, plain summaries', () => {
    const r = parseFeed(RSS, 'Test');
    expect(r[0]).toMatchObject({ title: 'Cavalry FC win the CPL final', link: 'https://example.com/a', summary: 'Calgary side lift the trophy', source: 'Test' });
    expect(r[0].at).toBe(Date.parse('2026-10-10T10:00:00Z'));
    expect(parseFeed(ATOM, 'A')[0]).toMatchObject({ title: 'New Minecraft update adds copper golems', link: 'https://example.com/c' });
  });
});

describe('triage without a model', () => {
  const now = Date.parse('2026-10-10T12:00:00Z');
  it('scores by the department, his interests and standing requests', () => {
    const soccer = scoreItem({ title: 'Cavalry FC win the CPL final', summary: 'Calgary side lift the trophy', at: now }, 'health', [], [], now);
    expect(soccer.score).toBeGreaterThanOrEqual(0.35);
    expect(soccer.matched).toEqual(expect.arrayContaining(['calgary', 'cavalry', 'cpl']));
    expect(scoreItem({ title: 'Stock markets slide', summary: '', at: now }, 'health', [], [], now).score).toBe(0);
    const asked = scoreItem({ title: 'Mongol Empire tomb found in Mongolia', summary: '', at: now }, 'history', ['Mongol Empire'], ['mongol tomb'], now);
    expect(asked.score).toBeGreaterThan(0.8);
  });
  it('leaves grim "on this day" entries out, and lets old news fade', () => {
    expect(scoreItem({ title: '1990: an empire official was murdered', summary: '', at: now }, 'history', [], [], now).score).toBe(0);
    const fresh = scoreItem({ title: 'Battle of Hastings re-enacted', summary: '', at: now }, 'history', [], [], now).score;
    const old = scoreItem({ title: 'Battle of Hastings re-enacted', summary: '', at: now - 5 * 86_400_000 }, 'history', [], [], now).score;
    expect(old).toBeLessThan(fresh);
  });
});

describe('the day', () => {
  it('knows which sweep is due and when the next one is', () => {
    const d = { sweeps: ['2026-10-10 morning'] };
    expect(sweep.dueSweep(d, new Date('2026-10-10T06:30:00'))).toBeNull();
    expect(sweep.dueSweep(d, new Date('2026-10-10T08:00:00'))).toBeNull();
    expect(sweep.dueSweep(d, new Date('2026-10-10T16:00:00'))).toBe('afternoon');
    expect(sweep.dueSweep({ sweeps: [] }, new Date('2026-10-10T21:00:00'))).toBe('evening');
    expect(new Date(sweep.nextSweepAt(d, new Date('2026-10-10T08:00:00'))).getHours()).toBe(15);
  });

  it('never spends past 40 AI calls a day', () => {
    const d = store.load();
    const day = new Date('2026-10-10T12:00:00');
    expect(store.spend(d, 39, day)).toBe(true);
    expect(store.spend(d, 2, day)).toBe(false);
    expect(store.spend(d, 1, day)).toBe(true);
    expect(store.budgetToday(d, new Date('2026-10-11T08:00:00'))).toBe(0);
  });

  it('takes standing requests, once each, at most 20', () => {
    expect(store.addRequest('health', 'Calgary Cavalry fixtures', 'Achilles')).toHaveProperty('id');
    expect(store.addRequest('health', 'calgary cavalry fixtures', 'Ultron')).toHaveProperty('error');
    expect(store.addRequest('health', 'x', 'Ultron')).toHaveProperty('error');
  });
});

describe('pulls and sweeps', () => {
  it('pulls each built department\'s feeds once, keeps the relevant items, logs a new grade', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => ({ ok: true, status: 200, text: async () => (/football|soccer/.test(url) ? RSS : '<rss></rss>'), json: async () => ({}) })));
    const r = await sweep.pull(new Date('2026-10-10T12:00:00Z'));
    expect(r.added).toBeGreaterThanOrEqual(1);
    const again = await sweep.pull(new Date('2026-10-10T13:00:00Z'));
    expect(again.added).toBe(0);
    const d = store.load();
    expect(d.items.some((i) => i.dept === 'health' && /Cavalry/.test(i.title))).toBe(true);
    expect(d.log.some((l) => /New grade on D2L: Math 9 87 %/.test(l.text))).toBe(true);
  });

  it('writes the day\'s intel per department - with AI when a cloud brain answers, headlines when not', async () => {
    const now = new Date('2026-10-10T15:31:00');
    const d = store.load();
    d.items.push({ id: 'x-health', dept: 'health', title: 'Cavalry FC win the CPL final', link: 'https://example.com/a', source: 'CBC', at: now.getTime(), score: 0.9, matched: ['cavalry'] });
    store.save(d);
    await sweep.sweep('afternoon', null, now);
    const plain = notes.get('Intel/2026-10-10.md')!;
    expect(plain).toMatch(/## Health\n\n### 15:31 afternoon sweep\n- Cavalry FC win the CPL final \(\[CBC\]\(https:\/\/example\.com\/a\)\)/);
    const write = vi.fn(async () => '- Cavalry won the CPL final - a Calgary side, worth watching their academy [CBC]\nfiller');
    await sweep.sweep('evening', write, new Date('2026-10-10T20:01:00'));
    const both = notes.get('Intel/2026-10-10.md')!;
    expect(both.indexOf('20:01 evening sweep')).toBeLessThan(both.indexOf('15:31 afternoon sweep'));
    expect(both).toMatch(/- Cavalry won the CPL final - a Calgary side/);
    expect(write).toHaveBeenCalledTimes(1);
    expect(store.budgetToday(store.load(), new Date('2026-10-10T20:01:00'))).toBe(1);
    expect(store.load().sweeps).toEqual(['2026-10-10 afternoon', '2026-10-10 evening']);
  });
});
