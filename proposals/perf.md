# Renderer bundle: what to lazy-load

`src/App.tsx` statically imports every overlay component (lines 2-22), so all of
them ship in the single main chunk on first paint even though only one overlay
renders at a time (`overlay?.kind === '...'`, lines 150-179). The two worst
offenders:

## 1. `WorldMapHologram.tsx` (world map / "Global Theater" overlay)
Pulls in `d3-geo` (344KB pkg), `topojson-client` (193KB pkg), and
`world-atlas/countries-110m.json` — a ~105KB JSON file imported directly as a
JS module (`worldTopologyJson from 'world-atlas/countries-110m.json'`, line 4)
so it gets inlined into the JS chunk, not fetched as a static asset. This only
needs to exist when `overlay.kind === 'worldmap'`.

**Fix** — in `App.tsx`:
```tsx
const WorldMapHologram = React.lazy(() =>
  import('./components/hud/WorldMapHologram').then(m => ({ default: m.WorldMapHologram }))
);
```
Wrap the existing `{overlay?.kind === 'worldmap' && (...)}` block's contents in
`<Suspense fallback={<HexPanel loading />}>` (or a simple spinner div) around
`<WorldMapHologram />`. Remove the static import at line 22.

## 2. `Cm8Panel.tsx` + its subtree (`Cm8Coach`, `Cm8FoodLog`, `Cm8Planner`, `Cm8Sleep`, `Cm8Settings` — 1,206 lines total)
All five files import `framer-motion` (3.5MB unpacked pkg, one of the largest
deps in `node_modules`), but the whole tree only mounts when
`overlay.kind === 'cm8'`. It's currently pulled in through the static
`import { Cm8Panel } from './components/cm8/Cm8Panel'` at line 18.

**Fix** — same pattern:
```tsx
const Cm8Panel = React.lazy(() =>
  import('./components/cm8/Cm8Panel').then(m => ({ default: m.Cm8Panel }))
);
```
Wrap `{overlay?.kind === 'cm8' && <Cm8Panel onClose={...} />}` in its own
`<Suspense>`. Since `framer-motion` is only reachable from this subtree now,
Rollup will split it into a separate chunk automatically — no manual chunking
config needed.

## Quick win (under 50 lines, safe)
Apply the same `React.lazy`/`Suspense` swap to the other rarely-opened
overlay panels already gated behind `overlay?.kind` — `BrowserPanel`,
`GooglePanel`, `GitHubPanel`, `NotionPanel`, `DiscordPanel`, `ObsidianPanel`,
`AgentSetup`, `ConnectorSetup`, `MemoryPanel`, `OllamaSetup`, `SettingsPanel`
(lines 8-21 of `App.tsx`). Each is a one-line import change plus wrapping its
existing conditional render in `<Suspense fallback={null}>` — no new files,
no logic changes, and each one only loads on the click that actually opens it.
Do `WorldMapHologram` and `Cm8Panel` first since they carry the two heaviest
third-party deps; the rest is incremental cleanup once the pattern exists.

Note: `@xenova/transformers` (Whisper) is *not* an eager-bundle problem — it's
only imported in `src/services/whisper.worker.ts`, which is already loaded via
`new Worker(new URL('./whisper.worker.ts', import.meta.url), { type: 'module' })`
in `src/services/stt.ts` (line 30), so Vite already splits it into its own
worker chunk, off the main thread and off the main bundle.
