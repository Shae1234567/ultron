# ATLAS

A personal AI command center that runs as a real desktop app — animated sci-fi HUD,
local voice output, a local *or* hosted LLM brain, real autonomous web browsing, real
file organization, a multi-agent team that can carry out a whole task on its own, and a
geopolitical news feed that explains why each story actually matters to you.

Atlas is the merge of two earlier builds: **Ultron**'s HUD, local-first architecture,
connectors, and specialist system, plus **Jarvis (Mark L)**'s Gemini brain and
autonomous-agent instincts. The base is entirely free (Ollama, local Whisper, local
TTS) — Gemini and the browsing agent are optional, opt-in upgrades on top of that.

---

## What's in it

| Area | Status |
|---|---|
| Animated HUD shell (core orb, radial instruments, live charts, particles) | Working |
| Local LLM brain via Ollama, streaming into the transcript | Working |
| **Second brain: Google Gemini**, switchable in Settings | Working (needs a free key) |
| Text-to-speech (Atlas talks back) | Working |
| **Live Voice** — real-time spoken conversation via the Gemini Live API | Backend built; needs UI wiring + your own key/mic to try |
| Speech-to-text (push-to-talk) via local Whisper | Working |
| **Real autonomous web browsing** via a headless Chromium (Playwright) | Working |
| **Agentic specialists** — Scout, The Archivist, Unison — call real tools in a loop | Working (needs a tool-capable Ollama model, e.g. `llama3.2`) |
| **File organization** — read, write, rename, move, delete, create, all agent-callable | Working (strictly inside folders you add) |
| GNews feed with regions + AI relevance blurbs | Working (needs a free key) |
| File panel — index folders you explicitly add, list + search | Working |
| Memory — a file Atlas always knows about you, editable in-app | Working |
| 10 specialist agents (7 personas + 3 agentic), several with real live capability | Working |
| Connectors panel — 8 services scaffolded | Scaffolding only, by design |

---

## Setup

### 1. Install dependencies

```bash
npm install
```

### 2. Install Ollama (the brain)

Free, runs entirely on your machine, no account and no API key.

Download: <https://ollama.com/download>

Then pull a model:

```bash
ollama pull llama3.2
```

`llama3.2` (~2 GB) is a good default. `phi3` is smaller and faster; `llama3.1` is
stronger but heavier. Whatever you pull, set the same name in Settings.

The daemon usually starts automatically after install. If not:

```bash
ollama serve
```

Atlas talks to it over its local REST API at `http://localhost:11434`. Nothing
leaves your machine.

### 3. Get a free GNews key (optional — only for the news panel)

1. Sign up at <https://gnews.io/register> — free tier is 100 requests/day, no card.
2. Copy your API key.
3. Either paste it into **Settings → GNews API key** (it writes to `.env` for you),
   or copy `.env.example` to `.env` and fill it in:

```bash
cp .env.example .env
```

The key is only ever read from `.env`. It is never hardcoded and `.env` is gitignored.

### 4. Run it

```bash
npm run dev
```

Or just double-click **`start-ultron.cmd`** — it starts Ollama if it isn't running,
then launches the HUD.

> **PowerShell users:** if `npm run dev` fails with *"npm.ps1 cannot be loaded because
> running scripts is disabled on this system"*, that's Windows' script execution policy,
> not the app. Either use `npm.cmd run dev` instead, use `start-ultron.cmd`, or allow
> local scripts once with:
>
> ```powershell
> Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
> ```

### 5. Run it as a real desktop app (recommended for everyday use)

A **Desktop shortcut named "Atlas"** is already set up, with the real icon, pointing at
the production build (`dist/` + `dist-electron/`) rather than the dev server - no
`npm run dev`, no terminal window, no blank Electron placeholder screen. Pin it to your
taskbar and it launches straight into the boot sequence.

That shortcut launches `electron.exe .` from this folder using the production build. If
you change the code, run `npm run build` to refresh `dist/`/`dist-electron/` and the
shortcut picks up the new build automatically - it's pointed at the same folder, not a
snapshot.

> **About a "real" installer:** `npm run package` (electron-builder → a proper
> `Atlas Setup.exe` with Start Menu entry) is wired up and configured, but
> electron-builder's Windows build needs to extract a code-signing helper package that
> contains symlinks, and Windows blocks unprivileged symlink creation unless
> **Developer Mode** is on (Settings → Privacy & security → For developers) or the
> command runs as Administrator. That's a real system setting, not something to flip
> silently - turn on Developer Mode yourself if you want the full installer, then run
> `npm run package` again. The Desktop shortcut above works today without any of that.

---

## Icon and boot sequence

The app icon is a hex-plated core orb matching the in-app HUD, rendered from
`build-assets/icon-source.html` (pure SVG, no external art tools) at 9 sizes via
Electron's own Chromium, then packed into `build-assets/icon.ico`. Regenerate it with:

```bash
electron build-assets/render-icons.js
node -e "require('png-to-ico').default(['build-assets/png/icon-16.png', ...]).then(b => require('fs').writeFileSync('build-assets/icon.ico', b))"
```

Every launch plays a boot sequence (`src/components/BootSequence.tsx`) before the HUD
appears - the hex logo draws in, then four checks report in real time: **memory**,
**settings**, **brain (Ollama)**, **voice (TTS)**. These are the exact same startup
calls `App.tsx` already makes; the boot screen just gives them a UI. Nothing on it is a
decorative fake progress bar - a check shows `WARN` if the real thing it's checking
actually failed. It never blocks longer than 5 seconds even if something hangs, and
never flashes by in under 1.5 seconds even when everything resolves instantly.

---

## Voice

**Text-to-speech works out of the box.** Atlas speaks its replies through your Windows
system voices via the Web Speech API. It auto-picks a British male voice when one exists
(*Microsoft George* on this machine) at a lowered pitch - the closest the stock OS voices
get to the JARVIS register. Voice, pitch and rate are all adjustable in Settings, with a
Test button.

Note that Chromium exposes far more voices than the classic SAPI list does - 10 English
voices here versus 3 - so check the Settings dropdown before assuming a voice is missing.

**Speech-to-text runs locally through Whisper**, not the Web Speech API. That choice is
deliberate: `webkitSpeechRecognition` exists in Electron's Chromium, but the recognition
itself is a Google-hosted service with an API key baked into Chrome. Electron builds
don't get that key, so it fails with a `network` error every single time. Rather than
ship a button that never works, Atlas records your clip, resamples it to 16 kHz mono,
and transcribes it with Whisper running in a Web Worker via `transformers.js`.

- **Free and offline.** Model weights download once from Hugging Face (~80 MB for
  `whisper-base.en`), get cached, and every transcription after that is local compute.
  No account, no key, no per-request cost.
- **First use downloads the model.** The voice panel shows a progress bar, or you can
  press **Load voice model** to warm it up ahead of time.
- **Off the main thread**, so inference never freezes the HUD animations.
- Typing into the composer drives the exact same pipeline, and always works.

Swap the engine or model in `src/services/stt.ts` — `transcribe()` is the single
speech-to-text entry point, mirroring how `getAIResponse()` works for the LLM.

## Two brains

Every AI call in the app goes through **one function**:

```ts
// src/services/ai.ts
export function getAIResponse(messages: ChatMessage[], opts?: AIOptions): Promise<string>
```

It now supports two brains, picked in **Settings → Brain**:

- **Ollama** (default) — free, local, offline, no key. Same as before.
- **Gemini** — hosted, needs a free key from
  [aistudio.google.com/apikey](https://aistudio.google.com/apikey), pasted into
  **Settings → Gemini API key** (writes to `.env`, never hardcoded). Handled by
  `electron/gemini.ts`, mirroring `ollama.ts`'s exact streaming contract so the rest of
  the app doesn't know or care which one answered.

**Agentic specialists always use Ollama** regardless of this setting — their tool-calling
loop (`services/agentLoop.ts`) drives Ollama's native function-calling directly, which
needs a tool-capable model (`llama3.2`, `qwen2.5`, etc. all work; check a model's Ollama
page for a "tools" badge before relying on it for Scout/Archivist/Unison).

### Live Voice (Gemini, real-time speech)

`src/services/liveVoice.ts` wraps the Gemini Live API for full-duplex spoken
conversation — the same real-time audio streaming Jarvis (Mark L) used, ported to
TypeScript. The module is complete and typechecks clean, but **wiring it into the HUD
(mic streaming in, audio playback out) is not done in this pass** — there's no way to
test live audio I/O against the real API in the environment that built this. Next step:
capture mic audio as 16kHz PCM16 chunks (extend `services/recorder.ts`), feed them to
`startLiveVoice(...).sendAudioChunk(...)`, and play `onModelAudioChunk` output back
through Web Audio at 24kHz — then verify with your own Gemini key and a real microphone.

---

## Real web browsing (Scout)

`electron/browser.ts` gives Atlas a genuine headless Chromium instance via
[Playwright](https://playwright.dev), lazily launched on first use and reused across
calls: `web_search` (DuckDuckGo HTML results, no key needed), `open_url` (real page
text), `click_element` / `type_text` (basic multi-step navigation), `screenshot`. Every
call returns `{ ok, ..., error }` and never throws, matching the rest of the IPC surface.

Activate the **Scout** specialist to let Atlas actually search and read the live web
mid-conversation, instead of answering from training data. First run installs the
browser binaries automatically (`postinstall: playwright install chromium`); if you ever
see *"Playwright browsers are not installed"*, run `npx playwright install chromium`.

## Agentic specialists (real tool use, not a pre-fetch)

The original 7 specialists (Coach, Tutor, Historian, Analyst, Chief of Staff, Builder,
Researcher) work exactly as before — each pre-fetches one fixed block of live context,
then answers once. Three new specialists in `src/agents/` are a different kind of thing:
they run `services/agentLoop.ts`, a real multi-step loop (capped at 6 steps) where the
model can call a tool, see the result, and decide to call another before answering.

| Specialist | Tools | What it's for |
|---|---|---|
| **Scout** | web browsing | Search and read the live web, cite real URLs, never invent one |
| **The Archivist** | files | List, search, read, create, edit, rename, move, delete — strictly inside folders added in the Files tab |
| **Unison** | browsing + files + research | The orchestrator — plans a multi-step task out loud, then actually executes each step with real tools, reporting as it goes |

Every tool call and result is real and visible — nothing here is simulated, and a
failed tool call is reported plainly rather than papered over. See `services/tools.ts`
for the full tool registry (JSON-schema parameters Ollama's function-calling reads
directly) and `services/agentLoop.ts` for the loop itself.

---

## Memory

Click **MEMORY** in the top bar to see and edit a single markdown file - everything
Atlas always knows about you, sent with every message so nothing has to be
re-explained conversation to conversation.

- Seeded once on first run with what's already known from context. After that, **Atlas
  never edits this file on its own** - the same principle as the connectors: it doesn't
  invent or silently update what it knows about you, only you do.
- Stored as plain markdown at `app.getPath('userData')/memory.md` - readable, editable,
  yours.
- The panel shows a rough token count sent with every message, so you can see the cost
  of what's in there and trim it if it gets heavy.
- This is deliberately a flat file, not a vector database - at the scale of one person's
  profile, a database buys nothing and just adds a failure mode.

## Specialists

Seven personas live in `src/agents/` - Coach, Tutor, Historian, Analyst, Chief of Staff,
Builder, and the Researcher - each just a different system prompt layered onto the same
local model via `buildSystemPrompt()`. Activate one from the **Agents** tab in the right
panel; it changes how every reply is written until you switch back to Plain Atlas.

Honesty rule: every specialist's card says exactly what it is. Six are personas only - a
different voice and priorities, nothing more. **The Researcher is the one exception** and
is marked `LIVE` on its card: before answering, it genuinely fetches a live Wikipedia
summary (free, no key, via `electron/research.ts`) and hands it to the model as verified
context, rather than letting a small local model guess at facts. If the lookup finds
nothing, it says so instead of inventing an answer.

The Tutor and every other specialist inherit two hard boundaries baked into
`buildSystemPrompt()` itself, not opt-in: no companion/emotional-support persona, and no
producing finished, submittable schoolwork on request. Both are non-negotiable regardless
of which specialist is active.

Add another specialist by dropping a new file in `src/agents/` that exports a
`specialist` object - same auto-registration pattern as connectors. See "Agentic
specialists" above for the three that call real tools instead of a single pre-fetch.

---

## News + relevance

- Fetches GNews `top-headlines`, one request per configured category.
- Region tags (`EUROPE`, `MIDDLE EAST`, …) are assigned by deterministic keyword
  matching. Anything that doesn't match lands in `GLOBAL` rather than being forced
  into a bucket.
- **"Why this matters to you"** is genuinely generated by your local Ollama model,
  fed your location, interest tags, and profile notes from Settings. It is not a
  template. If the model is offline, the blurb says so instead of inventing one.
- The top 5 stories get a blurb automatically; click any other headline to generate its own.

### Staying inside the free tier

The panel shows a live request counter against the 100/day cap.

- Default: 2 categories × auto-refresh every 60 min ≈ **48 requests/day**.
- Auto-refresh **stops at 80%** of the cap so manual refreshes always have headroom.
- Hard refusal at 100%. The counter resets at local midnight.
- Settings projects your usage before you commit to a refresh interval.

---

## File panel

Atlas indexes **only folders you add by hand** through the OS folder picker. There is
no "scan my whole computer" path anywhere in the code. Limits: 5,000 files per folder,
6 levels deep, skipping `node_modules`, `.git`, dotfiles and similar.

> Known limitation: the folder walk is synchronous in the main process, so adding a very
> large folder briefly blocks the UI.

---

## Connectors

Eight services are scaffolded: Gmail, Google Calendar, Notion, GitHub, Spotify,
Discord, Open-Meteo, Obsidian.

**None of them are connected, and none of them claim to be.** This build has no
credential storage and no OAuth flow, so every card reads `NOT CONNECTED`. Clicking one
opens the real, followable setup steps for that service — including its actual free-tier
terms and the exact `.env` keys it would need.

It's a real plugin architecture: every `*.ts` file in `src/connectors/` that exports a
`connector` object is registered automatically via `import.meta.glob`. Add a file, get a
card — no registry to edit.

`open-meteo` (no API key at all) and `obsidian` (a local folder) are the cheapest ones to
actually implement first.

---

## Project layout

```
electron/          main process — the only place with network + filesystem access
  main.ts            window, IPC handlers, navigation guard, screenshot utility
  ollama.ts          streaming chat client + status probe + tool-calling
  gemini.ts          second brain — Gemini streaming chat client + status probe
  browser.ts         Playwright — real headless-Chromium web browsing
  news.ts            GNews fetch, region tagging, quota reservation (race-safe)
  files.ts           explicit-folder indexer + real read/write/rename/move/delete
  memory.ts          the operator memory file (userData/memory.md)
  research.ts        the Researcher specialist's live Wikipedia lookup
  store.ts           settings + quota persistence (userData, atomic writes)
  env.ts             .env reader/writer
  preload.ts         contextBridge — the entire renderer API surface

src/
  services/
    ai.ts            getAIResponse() — THE swap point for the LLM, routes Ollama/Gemini
    liveVoice.ts     Gemini Live API real-time voice session (backend, not yet wired to UI)
    tools.ts         tool registry for the agentic loop (browser/files/research)
    agentLoop.ts     runAgentLoop() — the multi-step tool-calling loop
    stt.ts           transcribe() — THE swap point for speech to text
    whisper.worker.ts  Whisper inference, off the main thread
    recorder.ts      push-to-talk capture -> 16 kHz mono Float32
    conversation.ts  orchestration: record -> transcribe -> stream/agent-loop -> speak
    speech.ts        text-to-speech (OS voices)
    audio.ts         mic analyser feeding the waveform and orb
    newsFeed.ts      fetch + relevance queue
    research.ts      renderer-side wrapper for the live Wikipedia lookup
    bridge.ts        preload access (falls back to null impl outside Electron)
  components/
    CoreOrb.tsx      the centre; hud/OrbRings, hud/ParticleField
    hud/             HexPanel, ArcMeter, BarSpectrum, Waveform
    MemoryPanel.tsx  view/edit what Atlas knows about you
    AgentGrid.tsx, AgentSetup.tsx  the 10 specialists
  agents/            one file per specialist persona, auto-registered
                     (scout.ts, archivist.ts, unison.ts are the agentic three)
  connectors/        one file per service, auto-registered
  styles/            tokens -> hud -> core -> app
```

Security: `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`. The
renderer has no direct Node access — everything goes through the enumerated preload
bridge. A `will-navigate` guard blocks the window from ever being navigated to a remote
origin (which would otherwise inherit the full preload API). `settings:save` refuses to
accept a `folders` field from the renderer — folders can only be added through the real
OS picker, never by patching settings. The dev screenshot utility (`ULTRON_CAPTURE`) is
hard-gated behind `!app.isPackaged` and never runs in a built install.

---

## Keyboard

| Key | Action |
|---|---|
| Hold `Space` | Push to talk (outside text fields) |
| `Enter` | Send typed message |
| `Esc` | Interrupt generation or speech |

---

## Dev utility

The app can screenshot itself, which is how the shots in this README were produced:

```bash
ULTRON_CAPTURE=shot.png ULTRON_CAPTURE_DELAY=5000 npx electron .
```

`ULTRON_CAPTURE_JS` runs a snippet first against these dev hooks:

```js
window.__ultron.setState('thinking')   // force a core orb state
window.__ultron.setTab('connectors')   // switch the right panel
window.__ultron.closeOverlay()         // dismiss a modal
window.__ultron.loadStt()              // load Whisper, returns 'stt:ok'
window.__ultron.transcribeUrl(url)     // transcribe an audio file, returns the text
```

To regenerate a speech sample for `transcribeUrl` on Windows:

```powershell
Add-Type -AssemblyName System.Speech
$s = New-Object System.Speech.Synthesis.SpeechSynthesizer
$s.SetOutputToWaveFile("public/stt-test.wav")
$s.Speak("Atlas, what is the capital of France?")
$s.Dispose()
```

---

## CM8 — the coach programme

The whole of the CM8 coach app lives inside Atlas, opened from **CM8** in the top bar.
Twelve sections: in-season and off-season programmes, the home workout library, CM lab,
tryouts, fuel, food log, day planner, sleep optimiser, coach, pathway and settings.

### Where it comes from

Nothing in `src/cm8/` was retyped by hand. Two generators read the CM8 app directly:

```bash
node tools/extract-cm8.mjs         # content  -> src/cm8/content.ts
node tools/extract-cm8-engine.mjs  # food data -> src/cm8/foods.ts
```

`extract-cm8.mjs` pulls the day-cards, drills, library exercises, pillars, tryout
guidance, fuel plates, tier pathway and the coach knowledge base out of the HTML.
`extract-cm8-engine.mjs` runs CM8's own nutrition engine in a sandbox and serialises
the finished food tables, because they are built at runtime rather than written as a
literal. Re-run both after any CM8 change and the port stays in step.

Point them at a different copy with `CM8_SRC=/path/to/index_8.html`.

### Proving the port is faithful

A port is only trustworthy if it is checked against the thing it was ported from:

```bash
node tools/parity-cm8.mjs    # nutrition engine: CM8 vs the port, same inputs
node tools/coach-parity.mjs  # coach topic ranking and confidence floor
node tools/planner-check.mjs # the day planner's regression scenarios
```

The parity harnesses run CM8's original JavaScript and the TypeScript port over the
same inputs and diff the results. The planner scenarios include the day that produced
the original bug report — meals blocked out by hand, which used to list lunch twice
and silently drop training.

### The coach

`src/cm8/coach.ts` is CM8's offline matcher, exactly: same scoring weights, same 3.5
confidence floor, same deep dives. In Atlas it is the floor rather than the ceiling —
when Ollama is running, the question goes to the local model grounded in the matched
CM8 material plus the real food log, and the offline answer is the fallback. With no
brain and no network it still answers, the way CM8 always did.

### Storage

Uses CM8's own schema and key (`cm8_state_v2`), so a sync endpoint can be shared with
the browser app. Electron is a separate origin, so the two do not share automatically —
set the same address and key in **CM8 → Settings** on both.
