# Idle Dashboard — ambient tiles around the core orb

## Problem
`App.tsx`'s `.area-center` only renders `CoreOrb` + `VoiceInterface`. When `coreState === 'idle'` and no one is talking, most of the center column is dead space.

## Tiles (real store data only, no fabrication)

1. **Clock/Date tile** — `new Date()`, updated on a 1s interval (same pattern as `SystemPanel`'s `APP_STARTED`/`uptime` timer). Not store-backed, but not fabricated — it's real system time.
2. **Brain tile** — `useStore((s) => s.ollama)`. Shows `activeModel` + running/model-installed state, same fields `SystemPanel`'s `Row label="Brain"` already reads (`ollama.running`, `ollama.modelInstalled`, `ollama.activeModel`, `ollama.host`).
3. **Folders tile** — `useStore((s) => s.folders)`. Label: `"${folders.length} FOLDERS INDEXED"`. Same source `SystemPanel`'s FOLDERS `ArcMeter` uses (`IndexedFolder[]`).
4. **Headlines tile** — `useStore((s) => s.articles)`. Label: `"${articles.length} HEADLINES TRACKED"`. Same array `NewsPanel` renders from.

No weather tile: `src/services/research.ts` only exposes `researchMulti`/`formatResearchContext` (Wikipedia/Wikidata/DuckDuckGo lookups by query string) — there is no `ultron.research.weather` call and no weather field anywhere in the store. Skip it entirely rather than inventing a call that doesn't exist.

## Layout
A loose ring of 4 tiles around the orb, positioned absolutely within `.core-stage` (which is already `position: relative` for `CoreOrb`/`core-caption` layering):

- Clock — top-left, ~110px above and 160px left of orb center
- Brain — top-right, mirrored position
- Folders — bottom-left, ~110px below and 160px left
- Headlines — bottom-right, mirrored position

Each tile ~120×64px, `hud-panel`-style border (reuse existing `.hud-panel` / `HexPanel` visual language — thin cyan border, faint corner brackets, `label-xs` heading + `mono` value), semi-transparent background so the orb's glow reads through. On viewports where `.area-center` is narrow, collapse the ring to a single row of 4 tiles beneath `VoiceInterface` instead of absolute-positioned corners (reuse the same tile component, just stacked in flex-row).

## Fade trigger
New component `IdleDashboard`, mounted in `.area-center` alongside the existing children. Visibility driven directly off `coreState` from the store:

```
const coreState = useStore((s) => s.coreState);
const visible = coreState === 'idle';
```

Render unconditionally but toggle `opacity: visible ? 1 : 0` + `pointer-events: visible ? 'auto' : 'none'` with a ~300ms CSS transition, so it fades out immediately the instant `coreState` flips to `listening` (operator holds SPACE) and fades back in only when it returns to `idle` — never `thinking`/`speaking`/`offline`.
