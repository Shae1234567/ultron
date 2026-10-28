import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({ shell: { openPath: vi.fn(), openExternal: vi.fn() } }));

import { findApp, steamGamesIn, WEB_APPS, type InstalledApp } from './appLauncher';

const start = (name: string, id = name): InstalledApp => ({ name, id, kind: 'start' });

// Names as Get-StartApps reports them on a real Windows 11 PC.
const APPS: InstalledApp[] = [
  start('Google Chrome', 'Chrome'),
  start('Opera GX Browser', 'OperaSoftware.OperaGXWebBrowser.1'),
  start('Discord', 'com.squirrel.Discord.Discord'),
  start('Steam', '{7C5A40EF-A0FB-4BFC-874A-C0F2E0B9FA8E}\\Steam\\steam.exe'),
  start('Steam Support Center', 'http://support.steampowered.com/'),
  start('Spotify'),
  start('ChatGPT', 'OpenAI.Codex_2p2nqsd0c76g0!App'),
  start('Minecraft for Windows'),
  start('Minecraft Launcher'),
  start('Visual Studio Code'),
  start('Uninstall Visual Studio Code'),
  start('File Explorer', 'Microsoft.Windows.Explorer'),
  start('Word', 'Microsoft.Office.WINWORD.EXE.15'),
  { name: 'Rocket League', id: '252950', kind: 'steam' },
];

describe('findApp', () => {
  it('finds apps by the names people use', () => {
    expect(findApp(APPS, 'chrome')?.name).toBe('Google Chrome');
    expect(findApp(APPS, 'Discord')?.name).toBe('Discord');
    expect(findApp(APPS, 'steam')?.name).toBe('Steam');
    expect(findApp(APPS, 'spotify app')?.name).toBe('Spotify');
    expect(findApp(APPS, 'ChatGPT')?.name).toBe('ChatGPT');
    expect(findApp(APPS, 'opera')?.name).toBe('Opera GX Browser');
    expect(findApp(APPS, 'vs code')?.name).toBe('Visual Studio Code');
    expect(findApp(APPS, 'file explorer')?.name).toBe('File Explorer');
    expect(findApp(APPS, 'the word app')?.name).toBe('Word');
  });

  it('prefers the shortest name that starts with what was said', () => {
    expect(findApp(APPS, 'minecraft')?.name).toBe('Minecraft Launcher');
  });

  it('finds Steam games', () => {
    expect(findApp(APPS, 'rocket league')).toEqual({ name: 'Rocket League', id: '252950', kind: 'steam' });
  });

  it('never picks an uninstaller, and returns null for unknown apps', () => {
    expect(findApp(APPS, 'studio code')?.name).toBe('Visual Studio Code');
    expect(findApp(APPS, 'photoshop')).toBeNull();
    expect(findApp(APPS, '')).toBeNull();
  });

  it('has web fallbacks for apps that live in the browser', () => {
    expect(WEB_APPS.chatgpt).toBe('https://chatgpt.com');
    expect(WEB_APPS.youtube).toMatch(/^https:\/\//);
  });
});

describe('steamGamesIn', () => {
  it('reads games from every Steam library and skips Steam\'s own runtimes', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'steam-'));
    const second = fs.mkdtempSync(path.join(os.tmpdir(), 'steamlib-'));
    fs.mkdirSync(path.join(root, 'steamapps'));
    fs.mkdirSync(path.join(second, 'steamapps'));
    fs.writeFileSync(path.join(root, 'steamapps', 'libraryfolders.vdf'), `"libraryfolders"\n{\n\t"0"\n\t{\n\t\t"path"\t\t"${root.replace(/\\/g, '\\\\')}"\n\t}\n\t"1"\n\t{\n\t\t"path"\t\t"${second.replace(/\\/g, '\\\\')}"\n\t}\n}\n`);
    fs.writeFileSync(path.join(root, 'steamapps', 'appmanifest_252950.acf'), '"AppState"\n{\n\t"appid"\t\t"252950"\n\t"name"\t\t"Rocket League"\n}\n');
    fs.writeFileSync(path.join(second, 'steamapps', 'appmanifest_730.acf'), '"AppState"\n{\n\t"appid"\t\t"730"\n\t"name"\t\t"Counter-Strike 2"\n}\n');
    fs.writeFileSync(path.join(second, 'steamapps', 'appmanifest_228980.acf'), '"AppState"\n{\n\t"appid"\t\t"228980"\n\t"name"\t\t"Steamworks Common Redistributables"\n}\n');
    const games = steamGamesIn(root).map((g) => g.name).sort();
    expect(games).toEqual(['Counter-Strike 2', 'Rocket League']);
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(second, { recursive: true, force: true });
  });

  it('returns nothing when Steam is not there', () => {
    expect(steamGamesIn(path.join(os.tmpdir(), 'no-steam-here-123'))).toEqual([]);
  });
});
