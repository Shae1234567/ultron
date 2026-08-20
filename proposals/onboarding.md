# Boot sequence: more cinematic, still honest

Principle preserved: every visual beat maps to a real event. `BootSequence.tsx`
already drives everything off `bootChecks` state (memory, settings, brain,
voice) inside a real 1.5s–5s window — no fake progress bar gets added here.
These additions only give existing state more surface area to render on.

## 1. Additional real beats

- **Boot log.** Under `.boot__checks`, a monospace line typed out per check
  *as it resolves* (not before): `> MEMORY......... OK` / `> BRAIN (OLLAMA).. OK`.
  Type at ~18ms/char via `steps()` on `width`, dots pre-rendered to a fixed
  column (28ch) so lines don't reflow as they type. On `warn`, line ends
  `FAIL` in `--red` and holds 200ms longer before the next line starts —
  reads as a real console, not a fixed-duration light show.
- **Latency readout.** Each resolved check appends its actual elapsed ms,
  right-aligned, e.g. `OK  142ms`. Trivial to add since App.tsx already
  timestamps these checks; makes "OK" feel measured, not decorative.
- **Final handshake line.** Once all four settle, one extra line prints:
  `> ATLAS ONLINE` (ok) or `> ATLAS ONLINE — 1 SUBSYSTEM DEGRADED` (any warn)
  before `boot--exit` fires. This is a real aggregate of `bootChecks`, not a
  new beat invented for flavor.

## 2. First-launch variant

Detect via a persisted flag, e.g. `settings.hasCompletedFirstBoot` (mirrors
the existing `settings` store already probed by the `settings` check — no
new subsystem). When false: `MIN_MS` extends to 2600 (still real work, just
less rushed), and:

- Subtitle changes from `COMMAND CENTER — INITIALIZING` to
  `COMMAND CENTER — FIRST INITIALIZATION`.
- Each boot-log line gets one clause of *what* was found, still truthful:
  `> MEMORY......... OK  (0 entries — new profile)` vs. later boots'
  plain `> MEMORY......... OK`. This is real: memory check already knows
  entry count.
- After `ATLAS ONLINE`, one extra held line (900ms, no skip): `> OPERATOR
  REGISTERED`. Then set the flag so every subsequent boot uses the terse
  path. No extra graphics, no invented lore — just more of the same real
  data surfaced once, when it's actually new.

## 3. CSS

Reuse from `hologram.css` as-is: `.holo-flicker--text` on `.boot__subtitle`
(subtle instability, zero cost), `.holo-scan` on `.boot__checks` container
in place of a bespoke sweep if we want the log itself to scan.

New keyframes needed in `boot.css`:
- `boot-typewriter` — `width: 0% → 100%` via `steps(n)`, per-line, `n`
  bound to string length (computed inline per line, like `boot__check`
  already does with `animationDelay`).
- `boot-log-cursor` — blinking `opacity` on a trailing `█` caret, 2-step,
  530ms — same pattern as `pulse-soft` already in `boot.css`.

No new colors, no new easing philosophy — reuses `--cyan`/`--red`/
`--font-mono` tokens already governing `.boot__check-*`.
