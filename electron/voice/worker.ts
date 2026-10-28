import { env } from '@huggingface/transformers';
import { KokoroTTS } from 'kokoro-js';

/*
 * Ultron's voice engine, in its own process (Electron utilityProcess) so a slow or crashed model
 * can never freeze or take down the app. Kokoro (Apache-2.0, 82M parameters) turns text into
 * speech on this PC: the model is downloaded once from Hugging Face into Ultron's own folder,
 * then nothing leaves the computer. The effects that make it sound like Ultron are added
 * afterwards, in the window (src/services/ultronVoice.ts).
 *
 * The full-precision model is used on purpose: on his i7 it makes speech about three times
 * faster than the smaller "q8" one (1.6 s vs 4.8 s for a 6-second line, measured 11 Oct 2026).
 */

const MODEL = 'onnx-community/Kokoro-82M-v1.0-ONNX';

type In =
  | { type: 'load'; cacheDir: string; dtype: 'fp32' | 'q8' }
  | { type: 'speak'; id: number; text: string; voice: string; speed: number };

interface Progress { status?: string; file?: string; loaded?: number; total?: number }

const port = process.parentPort;
let tts: Promise<KokoroTTS> | null = null;

function load(cacheDir: string, dtype: 'fp32' | 'q8'): Promise<KokoroTTS> {
  if (tts) return tts;
  env.cacheDir = cacheDir;
  tts = KokoroTTS.from_pretrained(MODEL, {
    dtype,
    device: 'cpu',
    progress_callback: (p: Progress) => {
      if (p.status === 'progress' && p.file) port.postMessage({ type: 'progress', file: p.file, loaded: p.loaded ?? 0, total: p.total ?? 0 });
    },
  });
  tts.then(
    () => port.postMessage({ type: 'ready' }),
    (e: unknown) => {
      tts = null;
      port.postMessage({ type: 'failed', message: e instanceof Error ? e.message : String(e) });
    },
  );
  return tts;
}

port.on('message', async (e: { data: In }) => {
  const m = e.data;
  if (m.type === 'load') {
    void load(m.cacheDir, m.dtype).catch(() => undefined);
    return;
  }
  if (m.type === 'speak') {
    try {
      if (!tts) throw new Error('The voice model is not loaded.');
      const engine = await tts;
      const audio = await engine.generate(m.text, { voice: m.voice as 'am_michael', speed: m.speed });
      port.postMessage({ type: 'audio', id: m.id, samples: audio.audio, sampleRate: audio.sampling_rate });
    } catch (err) {
      port.postMessage({ type: 'error', id: m.id, message: err instanceof Error ? err.message : String(err) });
    }
  }
});
