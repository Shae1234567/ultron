# Command Palette (Ctrl+K) — Visual Design

## 1. Layout

Reuse `.overlay` as the backdrop wrapper as-is (fixed inset, `place-items: center`, `rgba(3,6,12,0.82)` + `blur(3px)`) — do not invent a new backdrop class. Difference from the settings/onboarding overlays: skip `HexPanel`; the palette card itself gets its own class, `.cmdk`, styled like a `.holo-panel`:

- Width: `min(560px, 100%)`, positioned near the top rather than dead-center — wrap it in a div with `align-items: flex-start` override (`margin-top: 12vh` on `.cmdk` inside the existing centered grid) so it reads as a HUD dropdown, not a modal dialog.
- Max height: `60vh`, contents scroll below the input.
- Apply `.holo-panel` + `.holo-border-anim` directly to `.cmdk` for the glass texture, scanline, corner brackets, and animated energy border — no new border/glow CSS needed.

## 2. Input Field

- Fixed header row inside `.cmdk`, height ~52px, `border-bottom: 1px solid var(--cyan-20)`.
- `<input>` fills the row: `font-family: var(--font-mono)`, `font-size: 15px`, `color: var(--cyan)`, `background: transparent`, no visible border on the input itself (the glow lives on `.cmdk`'s border-anim, not the input).
- Prefix with a static `>` or `❯` glyph in `var(--cyan)` with `text-shadow: var(--text-glow)`, like a terminal prompt.
- Placeholder text in `var(--dim)`.
- On focus, no extra outline — the `.holo-border-anim--active` modifier (already defined, spins faster at 1.6s) toggles onto `.cmdk` to signal "listening."

## 3. Result Rows & Keyboard Highlight

- Each result: `.cmdk-row`, `display:flex`, `padding: 8px 14px`, `gap: 10px`, `border-bottom: 1px solid rgba(0,217,255,0.07)` (matches `.folder-row` pattern).
- Row text: label in `var(--white)`, secondary/category text in `var(--dim)`, `font-family: var(--font-ui)`.
- Highlighted row (keyboard-selected via arrow keys, tracked by index state — not `:hover`): add `.cmdk-row--active` with `background: var(--cyan-12)`, `border-left: 2px solid var(--cyan)`, and text color shifting to `var(--cyan)` with `text-shadow: var(--text-glow)`. Mouse hover gets a much weaker `background: var(--cyan-12)` at half opacity only, so keyboard state is visually dominant and unambiguous.
- Selected row's icon/prefix glyph gets `.holo-flicker--text` for a subtle "active" pulse.

## 4. Reused Classes Summary

`.overlay` (backdrop), `.holo-panel` (glass/scanline/brackets on `.cmdk`), `.holo-border-anim` + `.holo-border-anim--active` (animated edge, active on focus), `.holo-flicker--text` (selected-row glyph pulse). No new keyframes or color values — only `.cmdk`, `.cmdk-row`, `.cmdk-row--active` are new, and they compose entirely from existing tokens (`--cyan*`, `--dim`, `--font-mono`, `--font-ui`).
