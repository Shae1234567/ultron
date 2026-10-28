/*
 * The maths behind Ultron's voice effect - pure functions, so they can be tested without audio.
 * ultronVoice.ts wires them into Web Audio.
 */

/** How strong each part of the effect is, from 0 (clean voice) to 1 (full robot). */
export interface FxParams {
  /** Semitones down. A little lower makes it bigger and colder. */
  pitchSemitones: number;
  /** The voice again an octave down, underneath. */
  sub: number;
  /** A ring-modulated copy: the faint metallic edge. */
  metal: number;
  /** A slightly delayed, drifting copy: the "more than one voice" doubling. */
  double: number;
  /** Short room echo. */
  reverb: number;
  /** Low-end boost, in dB. */
  bassDb: number;
  /** Gentle saturation. */
  drive: number;
}

export function fxParams(strength: number): FxParams {
  const s = Math.min(1, Math.max(0, Number.isFinite(strength) ? strength : 0));
  return {
    pitchSemitones: -2 * s,
    sub: 0.32 * s,
    metal: 0.16 * s,
    double: 0.3 * s,
    reverb: 0.16 * s,
    bassDb: 5 * s,
    drive: 0.35 * s,
  };
}

/**
 * Splits a reply into pieces small enough to start speaking quickly: whole sentences, never
 * more than about `max` characters (a long sentence is cut at a comma or space).
 */
export function speechChunks(text: string, max = 220): string[] {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (!clean) return [];
  const sentences = clean.match(/[^.!?]+(?:[.!?]+["')\]]*|$)/g) ?? [clean];
  const out: string[] = [];
  for (let s of sentences.map((x) => x.trim()).filter(Boolean)) {
    while (s.length > max) {
      const cut = Math.max(s.lastIndexOf(', ', max), s.lastIndexOf('; ', max));
      const at = cut > max * 0.4 ? cut + 1 : s.lastIndexOf(' ', max) > max * 0.4 ? s.lastIndexOf(' ', max) : max;
      out.push(s.slice(0, at).trim());
      s = s.slice(at).trim();
    }
    if (s) out.push(s);
  }
  // Very short pieces ("Yes.") sound clipped on their own - join them to the next one.
  const joined: string[] = [];
  for (const piece of out) {
    const last = joined[joined.length - 1];
    if (last !== undefined && last.length < 16 && last.length + piece.length + 1 <= max) joined[joined.length - 1] = `${last} ${piece}`;
    else joined.push(piece);
  }
  return joined;
}

/**
 * The same audio, an octave lower and the same length - the way an octave pedal does it: the
 * waveform's sign is flipped once every cycle of the voice's fundamental, which turns each two
 * cycles into one cycle twice as long. The flip happens exactly at a rising zero crossing (so it
 * never clicks), and a low-passed copy decides when a new cycle starts, so harmonics can't
 * trigger extra flips. Rough on its own, which doesn't matter: it's only a quiet layer underneath.
 */
export function octaveDown(x: Float32Array, rate = 24000): Float32Array {
  const out = new Float32Array(x.length);
  const k = 1 - Math.exp((-2 * Math.PI * 350) / rate);
  let lp1 = 0;
  let lp2 = 0;
  let env = 0;
  let sign = 1;
  let armed = false;
  for (let i = 0; i < x.length; i++) {
    lp1 += k * (x[i] - lp1);
    lp2 += k * (lp1 - lp2);
    env = Math.max(Math.abs(lp2), env * 0.9995);
    if (lp2 < -0.1 * env) armed = true;
    if (armed && i > 0 && x[i - 1] < 0 && x[i] >= 0) {
      sign = -sign;
      armed = false;
    }
    out[i] = x[i] * sign;
  }
  return out;
}

/** A soft-clip curve for the WaveShaper: `drive` 0 is a straight line. */
export function driveCurve(drive: number, n = 1024): Float32Array {
  const c = new Float32Array(n);
  const k = Math.max(0, drive) * 8;
  for (let i = 0; i < n; i++) {
    const x = (i * 2) / (n - 1) - 1;
    c[i] = k ? ((1 + k) * x) / (1 + k * Math.abs(x)) : x;
  }
  return c;
}
