import { ultron } from './bridge';
import { driveCurve, fxParams, octaveDown, speechChunks, type FxParams } from './voiceFx';
import type { VoiceStatus } from '../types';

/*
 * Ultron's own voice (11 Oct 2026). The words are spoken by Kokoro on this PC (electron/voice),
 * one sentence at a time; this file plays them through the effect that makes it Ultron:
 *
 *   voice, a little lower ─┬─ dry ─────────────────────────────┐
 *                          ├─ delayed, drifting copy (doubling) ┤
 *                          └─ ring-modulated copy (metal edge) ─┤
 *   the voice an octave down (sub, low-passed) ─────────────────┤
 *                                                               └─ bass ─ presence ─ air ─ drive ─ compressor ─┬─ out
 *                                                                                                             └─ short room echo ─ out
 *
 * The next sentence is made while the current one plays, so only the first one is waited for.
 * If the voice isn't downloaded yet, speech.ts falls back to the Windows voice.
 */

let status: VoiceStatus = { state: 'off', downloaded: false };
const listeners = new Set<(s: VoiceStatus) => void>();

/** Starts following the voice engine's state (download progress, ready...). Call once at startup. */
export function watchUltronVoice(): () => void {
  void ultron.voice.status().then((s) => { status = s; listeners.forEach((l) => l(s)); }).catch(() => undefined);
  return ultron.voice.onChanged((s) => { status = s; listeners.forEach((l) => l(s)); });
}

export function onUltronVoice(cb: (s: VoiceStatus) => void): () => void {
  listeners.add(cb);
  cb(status);
  return () => listeners.delete(cb);
}

export const ultronVoiceStatus = (): VoiceStatus => status;

/** Ready to speak now, or within a second (downloaded, just not loaded yet). */
export const ultronVoiceUsable = (): boolean => status.downloaded && status.state !== 'error';

/* ── The effect ─────────────────────────────────────────────────────────── */

interface Chain {
  main: GainNode;
  subIn: GainNode;
  dry: GainNode;
  sub: GainNode;
  dbl: GainNode;
  metal: GainNode;
  bass: BiquadFilterNode;
  shaper: WaveShaperNode;
  wet: GainNode;
}

function roomEcho(ctx: BaseAudioContext, seconds = 0.7): AudioBuffer {
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    let seed = 1234567 + ch * 7654321;
    for (let i = 0; i < len; i++) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      d[i] = ((seed / 0x7fffffff) * 2 - 1) * Math.pow(1 - i / len, 3);
    }
  }
  return buf;
}

/** Builds the effect on any audio context (the live one, or an offline one to render a sample). */
export function buildChain(ctx: BaseAudioContext): Chain {
  const g = (v = 1) => { const n = ctx.createGain(); n.gain.value = v; return n; };
  const filter = (type: BiquadFilterType, freq: number, gain = 0, q = 0.8) => {
    const f = ctx.createBiquadFilter();
    f.type = type; f.frequency.value = freq; f.gain.value = gain; f.Q.value = q;
    return f;
  };
  const main = g();
  const subIn = g();
  const mix = g();

  const dry = g();
  main.connect(dry).connect(mix);

  // Doubling: the same voice 18 ms late, drifting by a few ms - "more than one voice at once".
  const delay = ctx.createDelay(0.1);
  delay.delayTime.value = 0.018;
  const drift = ctx.createOscillator();
  drift.frequency.value = 0.23;
  const driftDepth = g(0.003);
  drift.connect(driftDepth).connect(delay.delayTime);
  drift.start();
  const dbl = g(0);
  main.connect(delay).connect(dbl).connect(mix);

  // Metal: ring modulation at 52 Hz, high-passed so it adds an edge rather than a buzz.
  const ring = g(0);
  const carrier = ctx.createOscillator();
  carrier.frequency.value = 52;
  carrier.connect(ring.gain);
  carrier.start();
  const metal = g(0);
  main.connect(ring).connect(filter('highpass', 300)).connect(metal).connect(mix);

  const sub = g(0);
  subIn.connect(filter('lowpass', 900)).connect(sub).connect(mix);

  const bass = filter('lowshelf', 170);
  const presence = filter('peaking', 2800, 2, 0.9);
  const air = filter('highshelf', 9000, -3);
  const shaper = ctx.createWaveShaper();
  shaper.oversample = '2x';
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -22; comp.ratio.value = 3; comp.attack.value = 0.005; comp.release.value = 0.2;
  const out = g(0.9);
  mix.connect(bass).connect(presence).connect(air).connect(shaper).connect(comp).connect(out);
  out.connect(ctx.destination);
  const verb = ctx.createConvolver();
  verb.buffer = roomEcho(ctx);
  const wet = g(0);
  comp.connect(verb).connect(wet).connect(ctx.destination);

  return { main, subIn, dry, sub, dbl, metal, bass, shaper, wet };
}

function applyFx(c: Chain, fx: FxParams): void {
  c.dry.gain.value = 1 - fx.double * 0.4;
  c.dbl.gain.value = fx.double;
  c.metal.gain.value = fx.metal;
  c.sub.gain.value = fx.sub;
  c.wet.gain.value = fx.reverb;
  c.bass.gain.value = fx.bassDb;
  c.shaper.curve = driveCurve(fx.drive) as Float32Array<ArrayBuffer>;
}

/** Plays one sentence through the effect; resolves when it has finished. */
function playInto(ctx: BaseAudioContext, c: Chain, a: { samples: Float32Array; sampleRate: number }, fx: FxParams, at: number, track?: AudioBufferSourceNode[]): { done: Promise<void>; length: number } {
  const rate = Math.pow(2, fx.pitchSemitones / 12);
  const buf = ctx.createBuffer(1, a.samples.length, a.sampleRate);
  buf.copyToChannel(a.samples as Float32Array<ArrayBuffer>, 0);
  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.playbackRate.value = rate;
  src.connect(c.main);
  const sources = [src];
  if (fx.sub > 0) {
    const sb = ctx.createBuffer(1, a.samples.length, a.sampleRate);
    sb.copyToChannel(octaveDown(a.samples, a.sampleRate) as Float32Array<ArrayBuffer>, 0);
    const s2 = ctx.createBufferSource();
    s2.buffer = sb;
    s2.playbackRate.value = rate;
    s2.connect(c.subIn);
    sources.push(s2);
  }
  for (const s of sources) s.start(at);
  track?.push(...sources);
  return { done: new Promise((r) => { src.onended = () => r(); }), length: a.samples.length / a.sampleRate / rate };
}

/* ── Speaking ────────────────────────────────────────────────────────────── */

let ctx: AudioContext | null = null;
let chain: Chain | null = null;
let generation = 0;
let active: AudioBufferSourceNode[] = [];
let speaking = false;
let endCurrent: (() => void) | null = null;

export const ultronSpeaking = (): boolean => speaking;

export interface UltronSpeakOptions {
  voice: string;
  rate: number;
  effect: number;
  onStart?: () => void;
  onEnd?: () => void;
  onError?: (message: string) => void;
}

/** Stops whatever Ultron is saying now. */
export function stopUltron(): void {
  generation++;
  for (const s of active) { try { s.stop(); } catch { /* already stopped */ } }
  active = [];
  const end = endCurrent;
  endCurrent = null;
  speaking = false;
  end?.();
}

export async function speakUltron(text: string, o: UltronSpeakOptions): Promise<void> {
  stopUltron();
  const gen = ++generation;
  const chunks = speechChunks(text);
  if (!chunks.length) { o.onEnd?.(); return; }
  const fx = fxParams(o.effect);
  // Made faster and played slower: the same pace, a lower voice.
  const speed = (o.rate || 1) / Math.pow(2, fx.pitchSemitones / 12);

  let finished = false;
  const finish = (err?: string) => {
    if (finished) return;
    finished = true;
    speaking = false;
    if (endCurrent === stopHook) endCurrent = null;
    if (err) o.onError?.(err);
    o.onEnd?.();
  };
  const stopHook = () => finish();
  endCurrent = stopHook;
  speaking = true;

  try {
    ctx ??= new AudioContext();
    if (ctx.state === 'suspended') await ctx.resume();
    chain ??= buildChain(ctx);
    applyFx(chain, fx);
    const synth = (t: string) => ultron.voice.synth(t, o.voice, speed);
    let next: Promise<{ samples: Float32Array; sampleRate: number }> | null = synth(chunks[0]);
    for (let i = 0; i < chunks.length; i++) {
      const audio: { samples: Float32Array; sampleRate: number } = await next!;
      if (gen !== generation) return;
      next = i + 1 < chunks.length ? synth(chunks[i + 1]) : null;
      next?.catch(() => undefined);
      if (i === 0) o.onStart?.();
      await playInto(ctx, chain, audio, fx, ctx.currentTime + 0.02, active).done;
      if (gen !== generation) return;
    }
    finish();
  } catch (e) {
    if (gen === generation) finish(e instanceof Error ? e.message : String(e));
  }
}

/**
 * Renders a line through the effect without playing it (for a saved sample, and for tests):
 * returns 16-bit WAV bytes.
 */
export async function renderUltronLine(text: string, o: { voice: string; rate: number; effect: number }): Promise<Uint8Array> {
  const fx = fxParams(o.effect);
  const rate = Math.pow(2, fx.pitchSemitones / 12);
  const parts = [];
  for (const t of speechChunks(text)) parts.push(await ultron.voice.synth(t, o.voice, (o.rate || 1) / rate));
  const sampleRate = 48000;
  const seconds = parts.reduce((n, p) => n + p.samples.length / p.sampleRate / rate + 0.25, 0) + 1;
  const off = new OfflineAudioContext(2, Math.ceil(seconds * sampleRate), sampleRate);
  const c = buildChain(off);
  applyFx(c, fx);
  let at = 0.05;
  for (const p of parts) at += playInto(off, c, p, fx, at).length + 0.25;
  const out = await off.startRendering();
  return wav(out);
}

function wav(b: AudioBuffer): Uint8Array {
  const ch = b.numberOfChannels;
  const n = b.length;
  const bytes = new Uint8Array(44 + n * ch * 2);
  const v = new DataView(bytes.buffer);
  const str = (o: number, s: string) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  str(0, 'RIFF'); v.setUint32(4, 36 + n * ch * 2, true); str(8, 'WAVE'); str(12, 'fmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, ch, true); v.setUint32(24, b.sampleRate, true);
  v.setUint32(28, b.sampleRate * ch * 2, true); v.setUint16(32, ch * 2, true); v.setUint16(34, 16, true);
  str(36, 'data'); v.setUint32(40, n * ch * 2, true);
  const data = Array.from({ length: ch }, (_, i) => b.getChannelData(i));
  let o = 44;
  for (let i = 0; i < n; i++) for (let c = 0; c < ch; c++) { v.setInt16(o, Math.max(-1, Math.min(1, data[c][i])) * 0x7fff, true); o += 2; }
  return bytes;
}
