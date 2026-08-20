/**
 * Renderer-side storage primitive for "detects spoken language on first use".
 *
 * This file only persists a language code - it does not detect one. As of
 * this writing, src/services/stt.ts's transcribe() resolves to a plain
 * string and never surfaces a detected-language code (the Whisper worker's
 * `result` message only carries `text`), so wiring the actual detection call
 * is left to whoever integrates this: either thread a language code out of
 * the Whisper worker if/when it starts returning one, or have the brain
 * infer the spoken language from the text of the first transcribed message
 * and call rememberDetectedLanguage() with that.
 *
 * Uses localStorage rather than the electron/store.ts settings file since
 * this is a single small renderer-side string with no need for an IPC
 * round-trip to the main process.
 */

const STORAGE_KEY = 'atlas.language';

/**
 * Records the detected language the first time it is called. Once a value
 * is stored, it is treated as sticky/final - later calls are no-ops, even
 * with a different language code, matching "detects spoken language on
 * first use" rather than re-detecting on every utterance.
 */
export function rememberDetectedLanguage(langCode: string): void {
  if (localStorage.getItem(STORAGE_KEY) !== null) return;
  localStorage.setItem(STORAGE_KEY, langCode);
}

/** Returns the stored language code, or null if none has been remembered yet. */
export function getRememberedLanguage(): string | null {
  return localStorage.getItem(STORAGE_KEY);
}
