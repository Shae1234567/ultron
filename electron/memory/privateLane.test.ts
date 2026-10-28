import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'ultron-lane-'));
vi.mock('../store', () => ({ getSettings: () => ({ vault: { path: ROOT } }) }));

const vault = await import('./vault');
const { isPrivateRel, inPrivateScope, markPrivate, withPrivacyScope } = await import('../brain/privacy');
afterAll(() => fs.rmSync(ROOT, { recursive: true, force: true }));

describe('data stays in its lane', () => {
  it('a private exchange is journaled apart, and "last time" never quotes it', () => {
    const yesterday = new Date(Date.now() - 86_400_000);
    vault.appendJournal({ at: yesterday, operatorName: 'Shae', user: 'what is the capital of peru', reply: 'Lima.' });
    vault.appendJournal({ at: yesterday, operatorName: 'Shae', user: 'my knee hurts after practice', reply: 'Tell a parent or your coach.', private: true });
    expect(vault.journalRel(yesterday, true)).toMatch(/^Journal\/Private\//);
    expect(fs.readFileSync(path.join(ROOT, vault.journalRel(yesterday, true)), 'utf8')).toContain('my knee hurts');
    expect(fs.readFileSync(path.join(ROOT, vault.journalRel(yesterday)), 'utf8')).not.toContain('knee');
    expect(vault.previousJournalTail()?.text).toContain('Lima');
    expect(vault.previousJournalTail()?.text).not.toContain('knee');
  });

  it('knows which notes are private', () => {
    for (const rel of ['Journal/Private/2026/2026-10-09.md', 'Team Runs/Private/x.md', 'Brains/Hypnos.md', 'Health/Sleep log.md', 'School/Science/Unit 2.md', 'Intel/2026-10-09.md', 'Memory/Health/Knee.md', 'Memory/School/Grades.md']) {
      expect(isPrivateRel(rel), rel).toBe(true);
    }
    for (const rel of ['Journal/2026/2026-10-09.md', 'Team Runs/x.md', 'Memory/History/Mongols.md', 'Research/Volcanoes.md', 'Profile/Operator.md']) {
      expect(isPrivateRel(rel), rel).toBe(false);
    }
  });

  it('a request marked private stays private to its end, and only that request', async () => {
    let inside = false;
    let afterAwait = false;
    await withPrivacyScope(async () => {
      expect(inPrivateScope()).toBe(false);
      markPrivate();
      inside = inPrivateScope();
      await new Promise((r) => setTimeout(r, 5));
      afterAwait = inPrivateScope();
    });
    expect(inside).toBe(true);
    expect(afterAwait).toBe(true);
    expect(inPrivateScope()).toBe(false);
    // Two requests at once don't share the mark.
    const [a, b] = await Promise.all([
      withPrivacyScope(async () => { markPrivate(); await new Promise((r) => setTimeout(r, 5)); return inPrivateScope(); }),
      withPrivacyScope(async () => { await new Promise((r) => setTimeout(r, 5)); return inPrivateScope(); }),
    ]);
    expect([a, b]).toEqual([true, false]);
  });
});
