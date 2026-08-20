# Command Palette (Ctrl+K / Cmd+K)

## 1. Day-one command list

Overlay jumps (call `setOverlay({kind: ...})` from `src/state/store.ts`):

- "Open Settings" → `{kind:'settings'}`
- "Open Memory" → `{kind:'memory'}`
- "Open GitHub" → `{kind:'github'}`
- "Open Notion" → `{kind:'notion'}`
- "Open Discord" → `{kind:'discord'}`
- "Open Obsidian" → `{kind:'obsidian'}`
- "Open CM8" → `{kind:'cm8'}`
- "Open Browser" → `{kind:'browser'}`
- "Open Google" → `{kind:'google'}`
- "Open World Map" → `{kind:'worldmap'}`
- "Open Ollama Setup" → `{kind:'ollama'}`
- "Close overlay" → `setOverlay(null)`

(`connector` and `agent` kinds take an `id` and are opened contextually from their own lists elsewhere — not generic palette entries on day one.)

Real actions (existing functions, not invented):

- "Toggle Live Voice" → `startLiveVoiceSession`/`stopLiveVoiceSession` from `src/services/liveVoiceSession.ts` (gate on `isLiveVoiceSupported()` from `src/services/liveVoice.ts`, same as `VoiceInterface.tsx`'s `toggleLiveVoice`)
- "Toggle Wake Word" → `startWakeWordListening`/`stopWakeWordListening`/`isWakeWordActive` from `src/services/wakeWord.ts` (same pattern as `SettingsPanel.tsx`'s `toggleWakeWord`)
- "Abort" → `cancelCurrent` from `src/services/conversation.ts`
- "Load voice model" → `preloadSpeechModel` from `src/services/conversation.ts`
- "Switch to System / Files / Connectors / Agents tab" → `setRightTab('system'|'files'|'connectors'|'agents')`, four separate entries
- "Clear transcript" → `clearTranscript()` from the store

## 2. Fuzzy match

No new dependency. Score each command's label with a simple every-char-in-order subsequence test against the query (case-insensitive): walk the query, advance a pointer through the label, all query chars must appear in order but not necessarily contiguous. Rank matches by: exact substring hit first, then shortest match span, then label length. This is ~15 lines, no library needed.

## 3. Where the listener lives

New top-level component, not bolted onto `VoiceInterface.tsx`'s Space/Escape handler (different concern, and that file already juggles push-to-talk + live voice + wake word state). Mount `<CommandPalette />` once in `App.tsx` alongside `<BootSequence />`. It owns its own `window.addEventListener('keydown', ...)` effect matching the existing style in `VoiceInterface.tsx` (check `e.metaKey || e.ctrlKey` and `e.key === 'k'`, `e.preventDefault()`, ignore when `isTypingTarget(e.target)` — reuse or duplicate that helper), plus its own `visible` state (or a new `paletteOpen` field on the zustand store if other components need to trigger it too).

## 4. Component shape

`src/components/CommandPalette.tsx`:

```ts
interface Command {
  id: string;
  label: string;
  hint?: string;       // e.g. "Overlay" / "Voice" / "Tab"
  run: () => void;
}

export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }): JSX.Element | null
```

Commands are defined as a local const array inside the file (pulling `setOverlay`, `setRightTab`, etc. via `useStore`), not stored in zustand — they're wiring, not app state.
