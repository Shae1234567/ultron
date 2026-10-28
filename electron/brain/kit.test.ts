import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';

// The real tool list, loaded with a stand-in Electron pointed at a throwaway folder.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ultron-kit-'));
vi.mock('electron', () => ({
  app: { getPath: () => tmp, isPackaged: false, on: () => {} }, shell: {}, safeStorage: { isEncryptionAvailable: () => false },
  BrowserWindow: class {}, session: {}, ipcMain: { handle: () => {} }, powerMonitor: {}, Notification: class {}, nativeImage: {},
  screen: {}, desktopCapturer: {}, clipboard: {},
}));

const { ALL_TOOLS } = await import('./tools');
const { RESEARCH_KIT } = await import('./kit');
const { OUTBOUND_ARGS } = await import('./privacy');
const byName = new Map(ALL_TOOLS.map((t) => [t.name, t]));

describe('the research kit every department agent gets', () => {
  it('is made of tools that exist', () => {
    expect(RESEARCH_KIT.filter((n) => !byName.has(n))).toEqual([]);
  });

  it('only looks and works things out - it changes nothing', () => {
    // Typing on sites, files, apps, messages and tasks stay with the shared team members who own them.
    const changes = /^(browser_(type|press|mouse|select|agent)|write_file|delete_path|move_path|copy_path|create_folder|organize_folder|run_command|apps_run_action|discord_|telegram_send|task_|memory_(remember|forget)|vault_write_note|open_)/;
    expect(RESEARCH_KIT.filter((n) => changes.test(n))).toEqual([]);
  });
});

describe('the privacy wall', () => {
  // If a tool renamed its argument ("query" -> "q"), the wall would quietly stop checking it.
  it('checks arguments every outgoing tool really has', () => {
    const missing: string[] = [];
    for (const [tool, keys] of Object.entries(OUTBOUND_ARGS)) {
      const t = byName.get(tool);
      if (!t) { missing.push(`${tool} (no such tool)`); continue; }
      for (const k of keys) if (!t.parameters.properties?.[k]) missing.push(`${tool}.${k}`);
    }
    expect(missing).toEqual([]);
  });

  it('covers every tool that searches the web or opens an address', () => {
    const outbound = ALL_TOOLS.filter((t) => /search|lookup|research|read_webpage|browser_open|read_feed|youtube_transcript|browser_agent|wolfram/.test(t.name))
      .map((t) => t.name)
      // Searching the operator's own memory, skills library and files is local, and opening a link on
      // their own screen is them visiting it.
      .filter((n) => !/^(memory_search|skill_search|search_files)$/.test(n))
      // The course library is notes in his own vault - searching it never leaves the PC.
      .filter((n) => n !== 'school_library_search')
      // drive_search asks his own Google Drive about his own files - like search_files, nothing goes to the open web.
      .filter((n) => n !== 'drive_search')
      // food_lookup sends Open Food Facts a barcode number and nothing else; a name lookup stays on this PC.
      .filter((n) => n !== 'food_lookup');
    expect(outbound.filter((n) => !OUTBOUND_ARGS[n])).toEqual([]);
  });
});
