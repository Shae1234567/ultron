# Testing Proposal

Atlas has zero automated tests. This proposes the smallest setup that catches
real regressions in the parts of the codebase that are pure logic (no
Electron, no network, no DOM) and therefore cheap to test.

## 1. Test runner: Vitest

Vite-native, near-zero config, fast watch mode, Jest-compatible API. Since the
project already builds on Vite (`vite.config.ts`), Vitest reuses the same
resolve/alias config for free.

**`package.json` additions:**

```jsonc
"scripts": {
  "test": "vitest run",
  "test:watch": "vitest"
}
```

```jsonc
"devDependencies": {
  "vitest": "^2.1.8"
}
```

No other packages needed — no jsdom/testing-library required since the first
targets are pure Node/TS logic, not React components.

## 2. Three highest-value targets

1. **`src/services/tools.ts` — `toolsForGroups`**
   Given `['files']`, returns exactly the files-group tools (by name) and
   excludes every browser/google/system/research tool — catches accidental
   `group` mislabeling when new tools are added.

2. **`src/services/tools.ts` — `executeTool`**
   For an unknown tool name, resolves to `{ ok: false, error: 'Unknown tool: <name>' }`
   without throwing; for a known tool, mock `ultron` (from `./bridge`) and
   assert the right bridge method is called with args mapped correctly (e.g.
   `write_file` → `ultron.files.write(path, content)`) and a thrown bridge
   error is caught and returned as `{ ok: false, error: message }` rather than
   propagating.

3. **`electron/googleAuth.ts` — PKCE verifier/challenge generation**
   The `generatePkce`-shaped logic isn't exported, so extract/export
   `base64url` and the verifier/challenge pair as a small testable unit (or
   export `generatePkce` itself): assert the verifier is 43-128 chars of
   unreserved base64url characters only (no `+`, `/`, `=`), and that the
   challenge equals `base64url(sha256(verifier))` — this is the one part of
   the OAuth flow with no network/Electron dependency and a precise spec to
   check against.

## 3. `vitest.config.ts` skeleton

Kept separate from `vite.config.ts` so the Electron main/preload build
(`vite-plugin-electron`) is never invoked during `npm test` — that plugin
writes to `dist-electron` and expects a running Vite dev/build context Vitest
doesn't provide.

```ts
import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  resolve: {
    alias: { '@': path.resolve(__dirname, 'src') },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'electron/**/*.test.ts'],
  },
});
```

`environment: 'node'` is enough for both targets (no DOM APIs used); switch
to `jsdom` later only if React component tests are added.
