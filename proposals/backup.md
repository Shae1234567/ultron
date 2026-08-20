# Proposal: Settings & Memory Backup / Restore

## Problem

`electron/store.ts` writes `settings.json` and `news-quota.json`/`news-cache.json`,
and `electron/memory.ts` writes `memory.md`, all to `app.getPath('userData')` with
no export path. A corrupted profile folder or a machine migration currently
loses Shae's settings, indexed folder list, and the entire hand-edited memory
file with zero recovery option.

## `electron/backup.ts`

```ts
export interface BackupBundle {
  version: 1;
  exportedAt: string;       // ISO timestamp
  settings: Settings;       // from store.ts, minus nothing sensitive (see below)
  memory: string;           // raw memory.md contents
  folders: IndexedFolder[]; // redundant with settings.folders but kept explicit
                             // for forward-compat if folders ever move out of Settings
}

export async function exportBackup(): Promise<{ ok: boolean; path?: string; error?: string }>;
export async function importBackup(): Promise<{ ok: boolean; error?: string }>;
```

`exportBackup()`: reads `getSettings()` + `getMemory()`, builds a `BackupBundle`,
opens `dialog.showSaveDialog` defaulting to `atlas-backup-YYYY-MM-DD.json`,
writes with `JSON.stringify(bundle, null, 2)`. Return `{ ok:false }` (not a
thrown error) if the user cancels the dialog — cancellation isn't a failure.

`importBackup()`: opens `dialog.showOpenDialog` (filters: `json`), parses and
validates `version === 1` and required keys, then calls `saveSettings(bundle.settings)`
and `saveMemory(bundle.memory)`. Reject with a clear error on schema mismatch
rather than partially applying a malformed file.

## What's included vs. excluded

**Include:** `settings.json` (profile, news prefs, ollama host/model, brain
choice, gemini model name, voice settings, folder list) and `memory.md` in full.

**Never include:** the `.env` file or any value read via `env()`/`setEnvKey()`
in `electron/env.ts` — `GNEWS_API_KEY`, `GEMINI_API_KEY`, or any future secret.
Reasons: (1) the backup JSON is a plain-text file the user will likely save to
cloud storage or a USB stick — bundling live API keys turns a settings backup
into a credentials leak; (2) keys are already scoped per-machine/per-.env by
design (`env.ts`'s own comment: "Keys are NEVER hardcoded — they only ever
come from this file"), so re-entering them on a new machine via the existing
"Write to .env" flow in Settings is the correct, already-built path. Also
exclude `news-cache.json` and `news-quota.json` — both are disposable,
regenerated state, not user data worth restoring.

## UI entry point

Add to `SettingsPanel.tsx`, in a new field block right after the "Background &
startup" section (~line 345, before the Ollama divider), matching the existing
button-pair pattern used for voice test/reset (lines 408–427):

```tsx
<div className="field">
  <span className="field__label">Backup &amp; restore</span>
  <div style={{ display: 'flex', gap: 6 }}>
    <button className="hud-btn" onClick={() => void ultron.backup.export()}>Export backup</button>
    <button className="hud-btn" onClick={() => void ultron.backup.import()}>Import backup</button>
  </div>
  <div className="field__hint">
    Saves settings, indexed folders, and memory.md to one JSON file. API keys
    are never included — re-enter those above after a restore.
  </div>
</div>
```

Requires adding `backup.export`/`backup.import` IPC handlers in `main.ts` and
bridge entries in `preload.ts`, following the same pattern as `settings.envPath`.
