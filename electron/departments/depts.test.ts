import { beforeEach, describe, expect, it, vi } from 'vitest';

const docs = new Map<string, unknown>();
const notes = new Map<string, string>();
vi.mock('../store', () => ({
  readDoc: (n: string, f: unknown) => (docs.has(n) ? structuredClone(docs.get(n)) : f),
  writeDoc: (n: string, d: unknown) => { docs.set(n, structuredClone(d)); },
  getSettings: () => ({ trackers: { games: true } }),
}));
vi.mock('../brain/events', () => ({ emit: () => {} }));
vi.mock('../memory/vault', () => ({
  readNote: (r: string) => notes.get(r) ?? null,
  writeNote: (r: string, c: string) => { notes.set(r, c); return r; },
  safeName: (s: string) => s.replace(/[<>:"/\\|?*]/g, ' ').trim(),
}));
vi.mock('electron', () => ({ shell: { openExternal: async () => {} } }));

const history = await import('./history/store');
const projects = await import('./projects/store');
const lib = await import('../media/library');
const tracker = await import('../media/tracker');
const { departmentFor, clearlyFor } = await import('./route');

beforeEach(() => { docs.clear(); notes.clear(); });

describe('History', () => {
  it('builds a deep-dive section by section, replaces a section in place, and counts it when finished', () => {
    history.startDive('The Siege of Baghdad (1258)', 'Mongol Empire', Date.parse('2026-10-02'));
    history.writeSection('The Siege of Baghdad (1258)', 'Story', 'Hulagu arrives. [Source: Wikipedia]');
    history.writeSection('The Siege of Baghdad (1258)', 'Sources', '- Wikipedia');
    history.writeSection('The Siege of Baghdad (1258)', 'Story', 'Hulagu Khan arrives with the army. [Source: Britannica]');
    const note = notes.get('History/The Siege of Baghdad (1258).md')!;
    expect(note.match(/## Story/g)).toHaveLength(1);
    expect(note).toMatch(/## Story\n\nHulagu Khan arrives with the army\. \[Source: Britannica\]\n\n## Sources/);
    expect(history.historyNumber(history.load(), Date.parse('2026-10-10')).open).toHaveLength(1);
    history.finishDive('the siege of baghdad (1258)', Date.parse('2026-10-09'));
    expect(history.historyNumber(history.load(), Date.parse('2026-10-10'))).toMatchObject({ month: 1, total: 1, open: [] });
    expect(notes.get('History/The Siege of Baghdad (1258).md')).toMatch(/status: finished 2026-10-09/);
    expect(history.writeSection('Nope', 'Story', 'x')).toHaveProperty('error');
  });
});

describe('Projects', () => {
  it('tracks milestones shipped, and calls a project stalled after two weeks untouched', () => {
    const now = Date.parse('2026-10-10T12:00:00');
    projects.addProject('History channel', 'Post the first 5-minute Mongol video', undefined, now - 30 * 86_400_000);
    projects.addMilestone('History channel', 'Write the script', undefined, now - 30 * 86_400_000);
    projects.addProject('Ultron', 'My own assistant', undefined, now);
    projects.addMilestone('ultron', 'Health app', undefined, now);
    projects.completeMilestone('ultron', 'health', now);
    const n = projects.projectsNumber(projects.load(), now);
    expect(n).toEqual({ shipped: 1, stalled: 1, active: 2 });
    expect(projects.projectsSnapshotText(projects.load(), now)).toMatch(/History channel \[STALLED - untouched 2\+ weeks\]/);
    projects.updateProject('history channel', { status: 'paused', note: 'Back after exams' }, now);
    expect(projects.projectsNumber(projects.load(), now).stalled).toBe(0);
    expect(projects.addProject('ultron', 'again')).toHaveProperty('error');
  });
});

describe('Media', () => {
  it('reads Steam\'s KeyValues files', () => {
    const v = lib.parseVdf('"AppState"\n{\n\t"appid"\t\t"359550"\n\t"name"\t\t"Tom Clancy\'s Rainbow Six Siege"\n\t"UserConfig"\n\t{\n\t\t"language"\t\t"english"\n\t}\n}');
    expect(v).toEqual({ AppState: { appid: '359550', name: "Tom Clancy's Rainbow Six Siege", UserConfig: { language: 'english' } } });
  });

  it('reads Epic\'s free games: free now, and next week', () => {
    const now = Date.parse('2026-10-10T12:00:00Z');
    const body = { data: { Catalog: { searchStore: { elements: [
      { title: 'Hades', offerMappings: [{ pageSlug: 'hades' }], promotions: { promotionalOffers: [{ promotionalOffers: [{ startDate: '2026-10-09T15:00:00Z', endDate: '2026-10-16T15:00:00Z', discountSetting: { discountPercentage: 0 } }] }], upcomingPromotionalOffers: [] } },
      { title: 'Paid thing', promotions: { promotionalOffers: [{ promotionalOffers: [{ startDate: '2026-10-09T15:00:00Z', endDate: '2026-10-16T15:00:00Z', discountSetting: { discountPercentage: 50 } }] }] } },
      { title: 'Next week', productSlug: 'next-week', promotions: { promotionalOffers: [], upcomingPromotionalOffers: [{ promotionalOffers: [{ startDate: '2026-10-16T15:00:00Z', endDate: '2026-10-23T15:00:00Z', discountSetting: { discountPercentage: 0 } }] }] } },
    ] } } } };
    expect(lib.parseEpicFree(body, now)).toEqual([
      { title: 'Hades', until: '2026-10-16T15:00:00Z', url: 'https://store.epicgames.com/en-US/p/hades', now: true },
      { title: 'Next week', from: '2026-10-16T15:00:00Z', until: '2026-10-23T15:00:00Z', url: 'https://store.epicgames.com/en-US/p/next-week', now: false },
    ]);
  });

  it('turns the running-program list into play sessions', () => {
    const map = new Map([['rainbowsix.exe', 'Rainbow Six Siege']]);
    const procs = tracker.parseTasklist('"RainbowSix.exe","123","Console","1","900,000 K","Running","PC\\\\shae","0:10:00","Rainbow Six"\r\n"javaw.exe","55","Console","1","1 K","Running","x","0:01:00","Lunar Client 1.21 (Minecraft)"\r\n"chrome.exe","9","Console","1","1 K","Running","x","0:00:01","Google"');
    expect(tracker.gamesRunning(procs, map).sort()).toEqual(['Minecraft', 'Rainbow Six Siege']);
    const t0 = Date.parse('2026-10-10T18:00:00');
    let doc = { sessions: [], open: {} } as ReturnType<typeof tracker.load>;
    doc = tracker.update(doc, ['Minecraft'], t0);
    doc = tracker.update(doc, ['Minecraft'], t0 + 40 * 60_000);
    doc = tracker.update(doc, [], t0 + 42 * 60_000);
    expect(doc.sessions).toEqual([]);
    doc = tracker.update(doc, [], t0 + 50 * 60_000);
    expect(doc.sessions).toEqual([{ game: 'Minecraft', start: t0, end: t0 + 40 * 60_000 }]);
    expect(tracker.playtime(doc, t0 + 60 * 60_000)).toEqual([{ game: 'Minecraft', minutes: 40, sessions: 1 }]);
  });
});

describe('routing to the new departments', () => {
  it('sends each its own asks, and leaves look-alikes alone', () => {
    expect(clearlyFor('what should I play tonight')).toBe('media');
    // His gym program goes straight to Health; the film itself does not.
    expect(clearlyFor("what's my workout today")).toBe('health');
    expect(clearlyFor('how is my fight club build going')).toBe('health');
    expect(clearlyFor('should I watch fight club tonight')).not.toBe('health');
    expect(clearlyFor('Clio, story of the day')).toBe('history');
    expect(departmentFor('tell me about the Mongol Empire')).toBe('history');
    expect(clearlyFor('how are my side projects going')).toBe('projects');
    expect(departmentFor('are nike shoes good for soccer')).not.toBe('projects');
    expect(departmentFor('open atlas')).toBeNull();
    expect(clearlyFor("what's due this week")).toBe('school');
  });
});

describe('follow-ups stay in their department (12 Oct 2026)', () => {
  it('a message pointing back at the last one goes where it went', async () => {
    const { routeWithContext } = await import('./route');
    // His real run: the second message went to the general team and took 12 minutes.
    expect(routeWithContext('go through the main biodiversity pdf and find 2a-2c there', 'go on my D2l and find biodiversity notes, make quiz questions'))
      .toEqual({ dept: 'school', clearly: true });
    expect(routeWithContext('make 5 more of those', 'quiz me on my science notes')).toEqual({ dept: 'school', clearly: true });
    expect(routeWithContext('and what about that knee now', 'my knee is sore after practice')).toEqual({ dept: 'health', clearly: true });
  });
  it('a new subject does not inherit the last department', async () => {
    const { routeWithContext } = await import('./route');
    expect(routeWithContext('what is the capital of France', 'go on my D2l and find biodiversity notes').dept).toBeNull();
    expect(routeWithContext('play some lo-fi on Spotify', 'quiz me on my science notes').dept).toBeNull();
    expect(routeWithContext('find that again', undefined).dept).toBeNull();
  });
  it('a message that is clearly its own department keeps it', async () => {
    const { routeWithContext } = await import('./route');
    expect(routeWithContext('I slept from 11 to 7', 'what is due this week').dept).toBe('health');
  });
});
