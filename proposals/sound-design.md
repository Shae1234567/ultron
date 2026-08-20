# Sound Design Proposal — Atlas

No audio assets exist and none can be fetched in this environment. All SFX are synthesized at runtime via `AudioContext` oscillators/gain nodes — zero file weight, zero pipeline.

## Module: `src/services/sfx.ts`

Single shared `AudioContext` (lazy-init on first call, since browsers block autoplay before user gesture). Each function builds an `OscillatorNode` → `GainNode` → `destination` graph, schedules a gain envelope with `linearRampToValueAtTime`/`exponentialRampToValueAtTime`, and disconnects on `onended`.

```ts
export function playBootChime(): void
export function playClick(): void
export function playConfirm(): void
export function playAlert(): void
export function playWakeDetected(): void
```

### 1. `playBootChime()`
Two-stage: a 220Hz→440Hz triangle sweep over 400ms (log-linear rise, gain 0→0.15 over 40ms attack then hold), immediately layered with a 1760Hz sine "shimmer" at 300ms in, 120ms long, gain 0.1 with fast exponential decay to 0.001. Total ~550ms. Reads as a system waking up, not a jingle.

### 2. `playClick()`
Single square oscillator, 1200Hz, 15ms duration, gain envelope: instant attack to 0.06, exponential decay to 0.001 by 15ms. Filtered through a lowpass BiquadFilter at 4000Hz to remove square-wave harshness. Sub-audible-feeling, tactile — not a mouse-click "tock."

### 3. `playConfirm()`
Sine oscillator sweeping 880Hz→1760Hz over 120ms (exponential frequency ramp), gain 0.12 with fast exponential decay starting at 60ms, floor by 140ms. Rising pitch reads as "affirmative/accepted."

### 4. `playAlert()`
Two square-wave pulses, 660Hz, 80ms each with a 60ms gap between (silence, not decay, in the gap), gain 0.1 per pulse with linear decay. Slight detune (+5 cents) on the second pulse to avoid sounding like a phone ringtone. Total ~220ms — urgent but short.

### 5. `playWakeDetected()`
Sine oscillator, fixed 523Hz (C5), 90ms, gain envelope 0→0.1 over 10ms attack, hold to 60ms, exponential decay to 0.001 by 90ms — a single clean "ping" confirming the wake word landed, distinct from `playConfirm()`'s sweep so the two are never confused by ear.

## Wiring (exact call sites)

| File | Location | Call |
|---|---|---|
| `src/components/BootSequence.tsx` | Top of the mount `useEffect` (line ~31), fired once when `booting` first becomes true | `playBootChime()` |
| `src/components/VoiceInterface.tsx` | In the `down` keydown handler (line ~57), right before `void beginPushToTalk()` | `playClick()` |
| `src/components/VoiceInterface.tsx` | In `toggleLiveVoice()` (line ~41), after `res.ok` confirms Live Voice session started | `playConfirm()` |
| `src/services/wakeWord.ts` | In `runLoop()` (line ~74), immediately before `onWake()` fires | `playWakeDetected()` |
| `src/services/conversation.ts` | Wherever an error/failure path surfaces to the user (mic denied, model load failure, live session error) — pairs with `setLiveError`/`sttReason` in `VoiceInterface.tsx` | `playAlert()` |
