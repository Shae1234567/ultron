import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'ultron-brains-'));
vi.mock('../hindsight', () => ({ retain: async () => {}, recall: async () => [] }));
vi.mock('../store', () => ({ getSettings: () => ({ vault: { path: ROOT } }) }));
vi.mock('../memory/semantic', () => ({ syncIndex: async () => {}, searchMemory: async () => [] }));

const { brainContext, brainRel, brainStats, intelFor, readBrain, rememberInBrain } = await import('./brains');
const { isoDate } = await import('../memory/vault');

afterAll(() => fs.rmSync(ROOT, { recursive: true, force: true }));
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

describe("an agent's own brain", () => {
  it('starts as a readable Obsidian note and takes confirmed facts', () => {
    const added = rememberInBrain('athena', ['Shae learns fractions faster from real examples.', 'Shae prefers a decision, not a list of options.'], 'conversation [[Journal/2026/2026-10-09]]');
    expect(added).toBe(2);
    expect(brainRel('athena')).toBe('Brains/Athena.md');
    const note = read('Brains/Athena.md');
    expect(note).toMatch(/^---\ntype: brain\nagent: athena\n/);
    expect(note).toContain('# Athena\'s brain');
    expect(note).toContain(`- ${isoDate()}: Shae learns fractions faster from real examples. (source: conversation [[Journal/2026/2026-10-09]])`);
  });

  it('skips a fact it already holds, even in other words', () => {
    expect(rememberInBrain('athena', ['Shae learns fractions faster from real examples']) ).toBe(0);
  });

  it('never keeps a secret', () => {
    rememberInBrain('athena', ['Shae pasted the key sk-or-v1-0123456789abcdef0123456789abcdef0123456789abcdef into a chat.']);
    expect(read('Brains/Athena.md')).not.toContain('0123456789abcdef0123456789abcdef');
  });

  it('is read newest-last, and the newest facts win when space is short', () => {
    rememberInBrain('argus', ['First fact about the operator.', 'Second fact about something else.', 'Third and newest fact here.']);
    expect(readBrain('argus')).toMatch(/First[\s\S]*Third/);
    const short = readBrain('argus', 50); // room for one dated fact
    expect(short).toContain('Third and newest fact here.');
    expect(short).not.toContain('First fact');
  });

  it('says how much it knows and what it learned last (for the council panel)', () => {
    expect(brainStats('argus')).toMatchObject({ facts: 3, last: { date: isoDate(), text: 'Third and newest fact here.' } });
    expect(brainStats('hermes')).toEqual({ facts: 0 });
  });
});

describe("Helios's intel for a department", () => {
  it("reads only that department's section of today's brief", () => {
    fs.mkdirSync(path.join(ROOT, 'Intel'), { recursive: true });
    fs.writeFileSync(path.join(ROOT, 'Intel', `${isoDate()}.md`), '# Intel\n\n## Health\n- Frost Thursday: practice may move indoors.\n\n## School\n- New Science unit on D2L.\n');
    expect(intelFor('health')).toBe('- Frost Thursday: practice may move indoors.');
    expect(intelFor('school')).toBe('- New Science unit on D2L.');
    expect(intelFor('media')).toBe('');
  });
});

describe('the context an agent starts work with', () => {
  const hits = [
    { rel: 'Brains/Athena.md', title: 'Athena', text: 'Athena: her own brain again', score: 0.9 },
    { rel: 'Memory/Health/Sleep.md', title: 'Sleep', text: 'Sleep: slept 6 hours on school nights', score: 0.8 },
    { rel: 'HQ/north-star.md', title: 'north-star', text: 'north-star: start grade 9 strong', score: 0.7 },
  ];
  const search = async () => hits;

  it('has its own brain, then the shared brain - without repeating its own brain', async () => {
    const ctx = await brainContext({ agent: 'athena', task: 'plan the week', search });
    expect(ctx).toMatch(/^YOUR OWN BRAIN/);
    expect(ctx).toContain('real examples');
    expect(ctx).toContain('FROM THE SHARED BRAIN');
    expect(ctx).toContain('[HQ/north-star] north-star: start grade 9 strong');
    expect(ctx).not.toContain('her own brain again');
  });

  it("keeps private notes away from a web-facing agent unless the task needs them", async () => {
    const argus = await brainContext({ agent: 'argus', task: 'x', search });
    expect(argus).not.toContain('slept 6 hours');
    expect(argus).toContain('grade 9 strong');
    expect(await brainContext({ agent: 'argus', task: 'x', search, allowPrivate: true })).toContain('slept 6 hours');
    expect(await brainContext({ agent: 'athena', task: 'x', search })).toContain('slept 6 hours');
  });

  it('stays inside its size budget', async () => {
    const big = Array.from({ length: 30 }, (_, i) => ({ rel: `Memory/Other/N${i}.md`, title: `N${i}`, text: 'x'.repeat(400), score: 0.6 }));
    const ctx = await brainContext({ agent: 'athena', task: 'x', budget: 1500, search: async () => big });
    expect(ctx.length).toBeLessThanOrEqual(1500);
  });
});
