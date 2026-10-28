import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'ultron-librarian-'));
vi.mock('../hindsight', () => ({ retain: async () => {}, recall: async () => [] }));
vi.mock('../store', () => ({ getSettings: () => ({ vault: { path: ROOT }, jobs: {} }), saveSettings: () => {} }));
vi.mock('./semantic', () => ({ syncIndex: async () => {}, searchMemory: async () => [] }));
const answer = vi.fn();
vi.mock('../brain/llm', () => ({ chatJson: (...a: unknown[]) => answer(...a) }));

const { due, mergeDuplicates, retireStale, shareAcross } = await import('./librarian');
const { readBrain, rememberInBrain } = await import('../brain/brains');

afterAll(() => fs.rmSync(ROOT, { recursive: true, force: true }));
beforeEach(() => answer.mockReset());

const note = (rel: string, body: string) => {
  fs.mkdirSync(path.dirname(path.join(ROOT, rel)), { recursive: true });
  fs.writeFileSync(path.join(ROOT, rel), `---\ntype: memory\nupdated: 2026-10-01\n---\n# Soccer\n\n${body}\n`);
};
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

describe('merging', () => {
  it('keeps one copy of a repeated fact - the newer wording', () => {
    const r = mergeDuplicates('# X\n- 2026-09-01: Shae plays left wing for Calgary Rangers.\n- 2026-09-02: Practice is on Tuesdays.\n- 2026-10-01: Shae plays left wing for the Calgary Rangers.\n');
    expect(r.merged).toBe(1);
    expect(r.content).not.toContain('2026-09-01');
    expect(r.content).toContain('2026-10-01: Shae plays left wing for the Calgary Rangers.');
    expect(r.content).toContain('Practice is on Tuesdays.');
  });

  it('never touches the corrections log', () => {
    const text = '# X\n## Corrections\n- 2026-10-01: removed 1 fact\n- 2026-10-02: removed 1 fact\n';
    expect(mergeDuplicates(text).merged).toBe(0);
  });
});

describe('retiring facts a newer fact overtook', () => {
  it('drops the old fact, keeps the new one, and logs it without the old wording', async () => {
    note('Memory/Sports/Soccer.md', '- 2026-09-01: Shae plays Tier 4 for Calgary Rangers.\n- 2026-10-05: Shae made Tier 3 at Calgary Rangers.');
    answer.mockResolvedValue({ stale: [{ old: 'Shae plays Tier 4 for Calgary Rangers.', newer: 'Shae made Tier 3 at Calgary Rangers.' }] });
    expect(await retireStale('Memory/Sports/Soccer.md')).toBe(1);
    const after = read('Memory/Sports/Soccer.md');
    expect(after).not.toContain('Tier 4');
    expect(after).toContain('- 2026-10-05: Shae made Tier 3 at Calgary Rangers.');
    expect(after).toMatch(/## Corrections\n- \d{4}-\d{2}-\d{2}: the librarian retired 1 fact/);
  });

  it("won't retire a fact for an older one, or for one that isn't in the note", async () => {
    note('Memory/Sports/Badminton.md', '- 2026-10-01: Tryouts are in February.\n- 2026-10-03: Shae practises on Thursdays.');
    answer.mockResolvedValue({ stale: [
      { old: 'Shae practises on Thursdays.', newer: 'Tryouts are in February.' },
      { old: 'Tryouts are in February.', newer: 'Tryouts moved to March.' },
    ] });
    expect(await retireStale('Memory/Sports/Badminton.md')).toBe(0);
  });

  it('asks only a trusted brain about a private note', async () => {
    note('Memory/Health/Sleep.md', '- 2026-10-01: Bedtime is 11.\n- 2026-10-04: Bedtime is 10:30.');
    answer.mockResolvedValue({ stale: [] });
    await retireStale('Memory/Health/Sleep.md');
    expect(answer.mock.calls[0][0]).toMatchObject({ private: true });
    note('Memory/Sports/Soccer.md', '- 2026-10-01: a\n- 2026-10-02: b c d e');
    await retireStale('Memory/Sports/Soccer.md');
    expect(answer.mock.calls[1][0]).toMatchObject({ private: false });
  });
});

describe('sharing between brains', () => {
  it('passes on only facts that are really in the brain, to the agents named', async () => {
    rememberInBrain('chronos', ['Soccer games are on Saturday mornings.', 'Shae likes reminders the night before.']);
    answer.mockResolvedValue({ share: [{ fact: 'Soccer games are on Saturday mornings.', to: ['athena'] }, { fact: 'An invented fact.', to: ['athena'] }] });
    expect(await shareAcross('chronos', ['athena', 'argus'])).toBe(1);
    expect(readBrain('athena')).toContain('Soccer games are on Saturday mornings.');
    expect(readBrain('athena')).not.toContain('invented');
    expect(readBrain('argus')).toBe('');
  });
});

describe('when she tidies', () => {
  const at = (h: number) => new Date(2026, 9, 9, h, 0);
  const hoursAgo = (d: Date, h: number) => d.getTime() - h * 3600_000;
  it('at night, once a day', () => {
    expect(due(at(23), hoursAgo(at(23), 24))).toBe(true);
    expect(due(at(23), hoursAgo(at(23), 5))).toBe(false);
    expect(due(at(15), hoursAgo(at(15), 24))).toBe(false);
  });
  it('in the day too, when the PC has been off every night for two days', () => {
    expect(due(at(15), hoursAgo(at(15), 50))).toBe(true);
  });
});
