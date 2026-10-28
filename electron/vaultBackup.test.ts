import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'ultron-backup-'));
const VAULT = path.join(TMP, 'vault');
const DATA = path.join(TMP, 'userData');
process.env.LOCALAPPDATA = path.join(TMP, 'local');
vi.mock('electron', () => ({ app: { getPath: () => DATA } }));
vi.mock('./store', () => ({ getSettings: () => ({ vault: { path: VAULT }, jobs: {} }), saveSettings: () => {} }));

const { backupVault } = await import('./vaultBackup');
afterAll(() => fs.rmSync(TMP, { recursive: true, force: true }));

const put = (root: string, rel: string) => {
  fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
  fs.writeFileSync(path.join(root, rel), rel);
};

describe('the daily backup', () => {
  it("holds the brains, the departments' notes and logs, Helios's intel and the course library", () => {
    for (const rel of ['Profile/Operator.md', 'Brains/Asclepius.md', 'Health/Week 41.md', 'Intel/2026-10-09.md', 'School/Science/Unit 2.md']) put(VAULT, rel);
    put(DATA, 'departments/health.json');
    put(DATA, 'departments/school.json');
    put(DATA, 'settings.json'); // settings are not data that can't be rebuilt - not copied
    const r = backupVault(true);
    expect(r).not.toBeNull();
    const has = (rel: string) => fs.existsSync(path.join(r!.path, rel));
    for (const rel of ['Brains/Asclepius.md', 'Health/Week 41.md', 'Intel/2026-10-09.md', 'School/Science/Unit 2.md']) expect(has(rel), rel).toBe(true);
    expect(has('_ultron/departments/health.json')).toBe(true);
    expect(has('_ultron/departments/school.json')).toBe(true);
    expect(has('_ultron/settings.json')).toBe(false);
  });
});
