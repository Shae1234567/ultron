import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';

const HQ = fs.mkdtempSync(path.join(os.tmpdir(), 'ultron-hq-'));
const settings = { hq: { path: HQ, on: true } };
vi.mock('../store', () => ({ getSettings: () => settings }));

const { hqRoot, listHqNotes, readHqNote } = await import('./hq');
const { isPrivateRel } = await import('../brain/privacy');

const put = (rel: string, text = `# ${rel}\n`) => {
  fs.mkdirSync(path.dirname(path.join(HQ, rel)), { recursive: true });
  fs.writeFileSync(path.join(HQ, rel), text);
};
put('north-star.md', '# North star\nStart grade 9 strong.');
put('CLAUDE.md');
put('health-fitness/CLAUDE.md');
put('health-fitness/context/training-plan.md');
put('school/context/courses/science.md');
put('projects/CLAUDE.md');
// Never read: code, packages, hidden folders, other file types, project folders.
put('projects/ultron/README.md');
put('projects/ultron/node_modules/pkg/README.md');
put('school/context/.obsidian/workspace.md');
put('school/context/notes.txt');
put('random/notes.md');
afterAll(() => fs.rmSync(HQ, { recursive: true, force: true }));

describe("the operator's HQ in the shared brain", () => {
  it('reads north-star, each area\'s CLAUDE.md and its context files - nothing else', () => {
    expect(listHqNotes().map((n) => n.rel).sort()).toEqual([
      'HQ/CLAUDE.md',
      'HQ/health-fitness/CLAUDE.md',
      'HQ/health-fitness/context/training-plan.md',
      'HQ/north-star.md',
      'HQ/projects/CLAUDE.md',
      'HQ/school/context/courses/science.md',
    ]);
  });

  it('opens a listed note, and nothing outside the list or the folder', () => {
    expect(readHqNote('HQ/north-star.md')).toContain('Start grade 9 strong.');
    expect(readHqNote('HQ/projects/ultron/README.md')).toBeNull();
    expect(readHqNote('HQ/../outside.md')).toBeNull();
    expect(readHqNote('north-star.md')).toBeNull();
  });

  it('is never written to', () => {
    const before = fs.readdirSync(HQ, { recursive: true }).length;
    listHqNotes();
    readHqNote('HQ/north-star.md');
    expect(fs.readdirSync(HQ, { recursive: true }).length).toBe(before);
  });

  it('keeps health, school, money and personal notes in the private lane', () => {
    expect(isPrivateRel('HQ/health-fitness/context/training-plan.md')).toBe(true);
    expect(isPrivateRel('HQ/school/context/courses/science.md')).toBe(true);
    expect(isPrivateRel('HQ/finances/context/budget.md')).toBe(true);
    expect(isPrivateRel('HQ/north-star.md')).toBe(false);
    expect(isPrivateRel('HQ/history/context/mongols.md')).toBe(false);
  });

  it('can be switched off, and is not found where there is no north-star.md', () => {
    settings.hq.on = false;
    expect(hqRoot()).toBeNull();
    expect(listHqNotes()).toEqual([]);
    settings.hq = { path: path.join(HQ, 'school'), on: true };
    expect(hqRoot()).toBeNull();
    settings.hq = { path: HQ, on: true };
  });
});
