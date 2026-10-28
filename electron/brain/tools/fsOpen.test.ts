import fs from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

// A pretend user folder, so the search never walks the real one.
vi.mock('node:os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:os')>();
  const home = `${actual.tmpdir()}${actual.platform() === 'win32' ? '\\' : '/'}ufind-home-${process.pid}`;
  return { ...actual, homedir: () => home, default: { ...actual, homedir: () => home } };
});
vi.mock('electron', async () => {
  const os = await import('node:os');
  return { app: { getPath: (n: string) => `${os.homedir()}${process.platform === 'win32' ? '\\' : '/'}${n[0].toUpperCase()}${n.slice(1)}` }, shell: {} };
});
vi.mock('../../store', () => ({ getSettings: () => ({ folders: [] }) }));
vi.mock('../../memory/vault', async () => {
  const os = await import('node:os');
  return { vaultRoot: () => `${os.homedir()}${process.platform === 'win32' ? '\\' : '/'}Ultron Vault` };
});

import os from 'node:os';
import { findByName, knownFolder, nameScore, nameWords } from './fs';

const home = () => os.homedir();
const put = (rel: string, ageDays = 1) => {
  const full = path.join(home(), rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, 'x');
  const t = new Date(Date.now() - ageDays * 86_400_000);
  fs.utimesSync(full, t, t);
};

beforeAll(() => {
  put('Documents/School/Volcano Poster.pptx', 2);
  put('Documents/School/Old volcano poster draft v2.pptx', 200);
  put('Downloads/Science lab report.pdf', 1);
  put('Downloads/Science lab report.docx', 30);
  put('Desktop/project/node_modules/volcano poster/index.js', 1);
  put('Desktop/.git/volcano poster', 1);
  fs.mkdirSync(path.join(home(), 'Pictures', 'Soccer Photos'), { recursive: true });
});
afterAll(() => fs.rmSync(home(), { recursive: true, force: true }));

describe('matching a name', () => {
  it('splits names into words', () => {
    expect(nameWords('Volcano_Poster-final.pptx')).toEqual(['volcano', 'poster', 'final']);
  });

  it('needs every word, and prefers exact, recent names', () => {
    const now = Date.now();
    expect(nameScore('volcano poster', 'Volcanoes.txt', now)).toBe(0);
    expect(nameScore('my volcano poster', 'Volcano Poster.pptx', now)).toBeGreaterThan(nameScore('volcano poster', 'Old volcano poster draft v2.pptx', now));
    expect(nameScore('science lab report.pdf', 'Science lab report.pdf', now)).toBeGreaterThan(nameScore('science lab report.pdf', 'Science lab report.docx', now));
    expect(nameScore('the file', 'anything.txt', now)).toBe(0);
  });
});

describe('finding it on the PC', () => {
  it('finds the right file in a nested folder and skips code and git folders', () => {
    const hits = findByName('my volcano poster');
    expect(path.basename(hits[0].path)).toBe('Volcano Poster.pptx');
    expect(hits.some((h) => /node_modules|\.git/.test(h.path))).toBe(false);
  });

  it('uses the extension when one is said', () => {
    expect(path.basename(findByName('science lab report.pdf')[0].path)).toBe('Science lab report.pdf');
  });

  it('finds folders too', () => {
    const [hit] = findByName('soccer photos');
    expect(hit.dir).toBe(true);
  });

  it('knows the usual folders by name', () => {
    expect(knownFolder('my downloads')).toBe(path.join(home(), 'Downloads'));
    expect(knownFolder('the documents folder')).toBe(path.join(home(), 'Documents'));
    expect(knownFolder('chrome')).toBeNull();
  });
});
