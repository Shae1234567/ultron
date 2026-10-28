import { describe, expect, it, vi } from 'vitest';

const docs = new Map<string, unknown>();
vi.mock('./store', () => ({
  getSettings: () => ({ vault: { path: '.' }, phone: { discordUserId: '' }, privacy: { trusted: [] } }),
  saveSettings: () => {},
  readDoc: (n: string, f: unknown) => (docs.has(n) ? docs.get(n) : f),
  writeDoc: (n: string, d: unknown) => { docs.set(n, d); },
}));
vi.mock('./brain/brains', () => ({ brainStats: (id: string) => (id === 'hypnos' ? { facts: 2, last: { date: '2026-10-09', text: 'Bedtime is 22:30 on school nights.' } } : { facts: 0 }) }));
vi.mock('./brain/llm', () => ({ privateBrainAvailable: async () => false }));
vi.mock('./brain/team', () => ({ once: async () => { throw new Error('no model in this test'); } }));
vi.mock('./focus', () => ({ focusState: () => ({ active: null, left: 0, streak: 0, todayMinutes: 0, recent: [] }) }));
vi.mock('./discordGateway', () => ({ phoneStatus: () => ({ linked: false, connected: false, botReady: true }), startPairing: () => ({ code: '1234', expires: 0 }) }));

const council = await import('./council');

describe('what the council chamber shows', () => {
  it('real seats: all five departments built, their agents live, each with its own number', () => {
    const s = council.councilState();
    const health = s.seats.find((x) => x.id === 'health')!;
    expect(health).toMatchObject({ built: true, head: { name: 'Asclepius', live: true } });
    expect(health.specialists.every((m) => m.live)).toBe(true);
    const school = s.seats.find((x) => x.id === 'school')!;
    expect(school).toMatchObject({ built: true, head: { name: 'Prometheus', live: true }, metric: { value: '-', unit: 'not read from D2L yet', empty: true } });
    expect(school.specialists.every((m) => m.live)).toBe(true);
    expect(s.seats.every((x) => x.built && x.head.live && x.specialists.every((m) => m.live))).toBe(true);
    expect(s.seats.find((x) => x.id === 'history')!.metric).toMatchObject({ value: '0', unit: 'deep-dives finished this month', empty: true });
    expect(s.seats.find((x) => x.id === 'projects')!.metric).toMatchObject({ value: '0/0', extra: 'no projects tracked yet', empty: true });
    expect(s.helios).toMatchObject({ built: true, budget: { cap: 40 } });
  });

  it("Health's number from real logs - and an honest empty state", () => {
    const h = council.councilState().seats.find((x) => x.id === 'health')!;
    expect(h.metric).toMatchObject({ value: '-', unit: 'no nights logged yet', empty: true });
    expect(h.brain).toMatchObject({ facts: 2, last: { who: 'Hypnos' } });
  });

  it('with no brain trusted with private data, the head still speaks - plainly, never sample text', async () => {
    expect(await council.seatLine('health')).toBe('No sleep logged yet. Tell me when you went to bed.');
    expect(await council.seatLine('school')).toBe("I can't see D2L yet. Sign in from the Apps panel and I'll tell you what's due.");
    expect(await council.seatLine('projects')).toBe('What are you building? Give it a name and one line for what done looks like.');
    expect(await council.seatLine('history')).toBe('Pick an empire and we go deep. The Mongols are waiting.');
  });

  it('convene: every seat reports, in seat order, and Ultron says how many are filled', async () => {
    const b = await council.convene();
    expect(b.lines.map((l) => l.id)).toEqual(['history', 'health', 'school', 'media', 'projects']);
    expect(b.summary).toMatch(/^Everyone has reported\./);
    expect(b.lines.every((l) => l.built)).toBe(true);
  });
});
