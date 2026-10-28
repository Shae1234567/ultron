import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';

// Not under the system temp folder: that lives in AppData, which Ultron rightly refuses to touch.
const tmp = fs.mkdtempSync(path.join(os.homedir(), 'ultron-fsprotect-'));

vi.mock('electron', () => ({ app: { getPath: (n: string) => path.join(os.homedir(), n) }, shell: { trashItem: vi.fn(), openPath: vi.fn() } }));
// The operator added a whole drive in the Files tab - the case these protections are for.
vi.mock('../../store', () => ({ getSettings: () => ({ folders: [{ path: 'C:\\', addedAt: 0, fileCount: 0 }, { path: tmp, addedAt: 0, fileCount: 0 }] }) }));
vi.mock('../../memory/vault', () => ({ vaultRoot: () => path.join(tmp, 'vault') }));

import { fsTools, resolveSafe, resolveWritable } from './fs';
import type { ToolContext } from './types';

afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

describe.skipIf(process.platform !== 'win32')('file protections', () => {
  it('can read inside Windows when a whole drive was added, but never change it', () => {
    expect(resolveSafe('C:\\Windows\\win.ini')).toBe('C:\\Windows\\win.ini');
    expect(() => resolveWritable('C:\\Windows\\win.ini')).toThrow(/read-only/);
    expect(() => resolveWritable('C:\\Program Files\\Some App\\config.txt')).toThrow(/read-only/);
    expect(() => resolveWritable('C:\\ProgramData\\x.txt')).toThrow(/read-only/);
    expect(() => resolveWritable('C:\\')).toThrow(/whole drive/);
  });

  it('still allows changes in normal folders', () => {
    expect(resolveWritable(path.join(tmp, 'notes.txt'))).toBe(path.join(tmp, 'notes.txt'));
  });

  it('keeps a copy of a file before overwriting it (after the operator approves)', async () => {
    const prev = process.env.LOCALAPPDATA;
    process.env.LOCALAPPDATA = path.join(tmp, 'local');
    try {
      const file = path.join(tmp, 'essay.txt');
      fs.writeFileSync(file, 'first draft');
      const write = fsTools.find((t) => t.name === 'write_file')!;
      const approve = vi.fn(async () => true);
      const ctx = { approve, signal: new AbortController().signal } as unknown as ToolContext;
      const res = await write.run({ path: file, content: 'second draft', mode: 'overwrite' }, ctx) as { ok: boolean; backup_of_old_version?: string };
      expect(approve).toHaveBeenCalledOnce();
      expect(res.ok).toBe(true);
      expect(fs.readFileSync(file, 'utf8')).toBe('second draft');
      expect(res.backup_of_old_version).toContain(path.join(tmp, 'local', 'Ultron Backups'));
      expect(fs.readFileSync(res.backup_of_old_version!, 'utf8')).toBe('first draft');
    } finally {
      if (prev === undefined) delete process.env.LOCALAPPDATA;
      else process.env.LOCALAPPDATA = prev;
    }
  });

  it('asks first and changes nothing when the operator declines', async () => {
    const file = path.join(tmp, 'keep.txt');
    fs.writeFileSync(file, 'original');
    const write = fsTools.find((t) => t.name === 'write_file')!;
    const ctx = { approve: async () => false, signal: new AbortController().signal } as unknown as ToolContext;
    const res = await write.run({ path: file, content: 'changed', mode: 'overwrite' }, ctx) as { error?: string };
    expect(res.error).toMatch(/declined/);
    expect(fs.readFileSync(file, 'utf8')).toBe('original');
  });
});
