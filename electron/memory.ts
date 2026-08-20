import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';

/**
 * Ultron's persistent memory of its operator - a single markdown file the
 * operator edits directly, injected into every system prompt. This is
 * separate from Settings: Settings is small structured config (location,
 * news categories, voice), memory is free-form knowledge Ultron should just
 * *know* without being told again in every conversation.
 *
 * Seeded once with what is known on first run. After that, Ultron never
 * rewrites it on its own - only the operator edits it, from the Memory panel.
 */

const FILE_NAME = 'memory.md';

const DEFAULT_MEMORY = `# About the operator

This file is Ultron's memory. Everything here is sent to the model with every
conversation, so Ultron always has this context without being told again.
Edit this directly - add, correct, or remove anything. Keep it factual and
information-dense rather than padded; every line here costs context budget.

## Identity

- Name: Shae.
- Location: Calgary, Alberta, Canada (Aspen Woods).
- Grade 9, Vincent Massey School. Plans to attend Ernest Manning High School
  next, likely taking 1-2 AP classes there.
- Favorite subjects: English and math.
- Lives with parents and an older sibling.
- Gets around by e-scooter and bike.
- Spends time on Discord, Snapchat, Instagram Reels, TikTok, YouTube, Roblox,
  and PlayStation.

## Soccer - the most time-sensitive priority

- Plays for Calgary Rangers, currently Tier 4, for about two years.
- Tier 3 tryouts are September 10, 2026 - the single most time-sensitive goal
  right now. Everything else can bend around training for this.
- Long-term goal: reach Tier 2 the season after making Tier 3.

## Badminton

- Plays badminton too. School tryouts are in February, so training ramps up
  in the months before that.

## History - the genuine passion, not an assignment

- Deeply into history: empires, warfare, the larger-than-life figures, the
  strategy and drama. Wants the entertaining version, not the textbook one.
- Ranked favorite empires: 1. Mongol, 2. Roman, 3. Napoleonic, 4. Mughal,
  5. Ottoman.

## How Shae works and struggles

- Struggles with focus when studying at home, and procrastinates on
  assignments sometimes. He knows this about himself - the useful response is
  structure and momentum, not lectures about willpower.
- Wants the same seriousness and rigor applied to every part of life, not
  just "important" things - a school assignment gets the same quality of help
  as a business idea.

## What matters right now (roughly in priority order)

1. Make Tier 3 soccer on September 10, 2026.
2. Start grade 9 strong - don't coast early and pay for it later.
3. Build good financial habits, start thinking about earning money.
4. Lay groundwork for small projects and ventures, even tiny ones.
5. Keep going deep on history, because it is what he actually loves.

## How to talk to Shae

- Be direct. Give real reasoning, not hedged answers. Push back on weak ideas
  instead of agreeing to be agreeable.
- Don't lecture or moralize about focus/procrastination - help build
  structure instead.
- Treat every topic - school, soccer, a side project, a history question -
  with the same level of care.
`;

function filePath(): string {
  return path.join(app.getPath('userData'), FILE_NAME);
}

export function getMemory(): string {
  const p = filePath();
  try {
    if (!fs.existsSync(p)) {
      fs.mkdirSync(path.dirname(p), { recursive: true });
      fs.writeFileSync(p, DEFAULT_MEMORY, 'utf8');
      return DEFAULT_MEMORY;
    }
    return fs.readFileSync(p, 'utf8');
  } catch {
    return DEFAULT_MEMORY;
  }
}

export function saveMemory(content: string): { ok: boolean; file: string; error?: string } {
  const p = filePath();
  try {
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, content, 'utf8');
    return { ok: true, file: p };
  } catch (e) {
    return { ok: false, file: p, error: e instanceof Error ? e.message : String(e) };
  }
}

export function memoryPath(): string {
  return filePath();
}
