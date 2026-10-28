/*
 * What each service's keys look like - so a key pasted into the wrong box is caught before it is
 * saved, and a refused key can be described without ever showing it ("this looks like a Groq
 * key"). Only the shape is checked; whether a key works is still asked of the service itself.
 * Formats change, so a key that matches no pattern is still allowed - only one that clearly
 * belongs to a different service is turned back.
 */

const SHAPES: { id: string; label: string; re: RegExp; hint: string }[] = [
  { id: 'openrouter', label: 'OpenRouter', re: /^sk-or-v1-[0-9a-f]{40,}$/i, hint: 'OpenRouter keys start with sk-or-v1-' },
  { id: 'nvidia', label: 'NVIDIA', re: /^nvapi-[A-Za-z0-9_-]{30,}$/, hint: 'NVIDIA keys start with nvapi-' },
  { id: 'groq', label: 'Groq', re: /^gsk_[A-Za-z0-9]{30,}$/, hint: 'Groq keys start with gsk_' },
  { id: 'huggingface', label: 'Hugging Face', re: /^hf_[A-Za-z0-9]{20,}$/, hint: 'Hugging Face tokens start with hf_' },
  { id: 'gemini', label: 'Gemini', re: /^AIza[0-9A-Za-z_-]{30,}$/, hint: 'Gemini keys start with AIza' },
  { id: 'github', label: 'GitHub', re: /^(ghp_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,})$/, hint: 'GitHub tokens start with github_pat_ or ghp_' },
  { id: 'cerebras', label: 'Cerebras', re: /^csk-[A-Za-z0-9]{20,}$/, hint: 'Cerebras keys start with csk-' },
  { id: 'deepseek', label: 'DeepSeek', re: /^sk-[0-9a-f]{32}$/, hint: 'DeepSeek keys are sk- and 32 letters and numbers' },
  { id: 'openai', label: 'OpenAI', re: /^sk-(proj-|svcacct-|admin-)?[A-Za-z0-9_-]{20,}$/, hint: 'OpenAI keys start with sk-' },
];

const an = (label: string) => `${/^([AEIOU]|NVIDIA)/i.test(label) ? 'an' : 'a'} ${label}`;

/** Which service a key's shape belongs to, if any is clear. OpenRouter is checked before OpenAI (both start sk-). */
export function serviceOfKey(key: string): { id: string; label: string } | null {
  const k = key.trim();
  for (const s of SHAPES) if (s.re.test(k)) return { id: s.id, label: s.label };
  return null;
}

/**
 * A key about to be saved for `id`: null when it's fine (or its shape is unknown), or the reason
 * it looks like it belongs somewhere else.
 */
export function wrongBox(id: string, key: string): string | null {
  const own = SHAPES.find((s) => s.id === id);
  if (own?.re.test(key.trim())) return null;
  const other = serviceOfKey(key);
  // DeepSeek's and OpenAI's shapes overlap; never turn one away for looking like the other.
  if (!other || other.id === id || (['deepseek', 'openai'].includes(id) && ['deepseek', 'openai'].includes(other.id))) return null;
  const label = own?.label ?? id;
  return `That looks like ${an(other.label)} key, not ${an(label)} one - paste it into the ${other.label} row instead.${own ? ` (${own.hint}.)` : ''}`;
}

/** A refused key described by its shape alone - never its value. */
export function keyHint(id: string, key: string): string | undefined {
  if (!key) return undefined;
  const own = SHAPES.find((s) => s.id === id);
  if (!own) return undefined;
  if (own.re.test(key.trim())) return `The saved key is the right shape for ${own.label}, so it isn't a typo - ${own.label} has deleted it, or it was replaced by a newer one.`;
  const other = serviceOfKey(key);
  if (other && other.id !== id) return `The saved key looks like ${an(other.label)} key - it may be in the wrong box. ${own.hint}.`;
  return `The saved key doesn't look like ${an(own.label)} key (${own.hint}) - it may be cut short or have extra characters.`;
}

/**
 * The key on the clipboard, for "Paste & test": read a few times (another program - Grammarly, a
 * game overlay - can hold the clipboard for a moment), cleaned, and only if it is one single key.
 */
export async function keyFromClipboard(read: () => string, label: string, clean: (s: string) => string, wait = (ms: number) => new Promise((r) => setTimeout(r, ms))): Promise<{ key: string } | { error: string }> {
  let raw = '';
  for (let i = 0; i < 6 && !raw; i++) {
    try { raw = read() ?? ''; } catch { /* held open elsewhere */ }
    if (!raw) await wait(120);
  }
  const key = clean(raw);
  if (!key) return { error: `Copy the new ${label} key first (the copy button next to it on the key page), then press Paste & test again.` };
  if (key.length > 400 || /\s/.test(key)) return { error: 'What is on the clipboard is not a single key - copy just the key.' };
  return { key };
}
