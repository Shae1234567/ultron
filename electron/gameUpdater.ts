import { existsSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { shell } from 'electron';

/** Real, verifiable checks against locally-installed Steam/Epic - not fake
 *  progress. Detection uses plain filesystem checks against the common
 *  Windows install paths rather than reading the registry: it's sufficient
 *  for the default-install case and avoids pulling in a registry-reading
 *  dependency for what is otherwise a simple existence check. */

const STEAM_EXE = 'C:\\Program Files (x86)\\Steam\\Steam.exe';
const EPIC_EXE = 'C:\\Program Files (x86)\\Epic Games\\Launcher\\Portal\\Binaries\\Win32\\EpicGamesLauncher.exe';

export interface GameLibraryStatus { steamInstalled: boolean; epicInstalled: boolean }

export function detectGameLaunchers(): GameLibraryStatus {
  return {
    steamInstalled: existsSync(STEAM_EXE),
    epicInstalled: existsSync(EPIC_EXE),
  };
}

export function triggerSteamUpdateCheck(): { ok: boolean; error?: string } {
  try {
    const { steamInstalled } = detectGameLaunchers();
    if (!steamInstalled) return { ok: false, error: 'Steam is not installed.' };
    // Steam has a documented, reliable URI scheme for this - open it straight
    // to Downloads/Updates so any pending updates surface immediately.
    shell.openExternal('steam://open/downloads');
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export function triggerEpicUpdateCheck(): { ok: boolean; error?: string } {
  try {
    const { epicInstalled } = detectGameLaunchers();
    if (!epicInstalled) return { ok: false, error: 'Epic Games Launcher is not installed.' };
    // Epic doesn't expose a documented URI scheme as reliable as Steam's, so
    // launch the executable directly instead - opening the launcher itself
    // triggers its own update/library check on startup.
    execFile(EPIC_EXE, []);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
