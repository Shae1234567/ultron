import { describe, expect, it } from 'vitest';
import { driveCurve, fxParams, octaveDown, speechChunks } from './voiceFx';

const sine = (hz: number, secs: number, rate = 24000) => {
  const x = new Float32Array(Math.round(secs * rate));
  for (let i = 0; i < x.length; i++) x[i] = 0.5 * Math.sin((2 * Math.PI * hz * i) / rate);
  return x;
};
/** Frequency from upward zero crossings, ignoring the edges. */
const freqOf = (x: Float32Array, rate = 24000) => {
  const a = Math.floor(x.length * 0.2);
  const b = Math.floor(x.length * 0.8);
  let n = 0;
  for (let i = a + 1; i < b; i++) if (x[i - 1] < 0 && x[i] >= 0) n++;
  return n / ((b - a) / rate);
};

describe('octaveDown', () => {
  it('halves the pitch and keeps the length', () => {
    const x = sine(300, 1);
    const y = octaveDown(x);
    expect(y.length).toBe(x.length);
    const f = freqOf(y);
    expect(f).toBeGreaterThan(135);
    expect(f).toBeLessThan(165);
  });

  it('keeps the level about the same, with nothing blowing up', () => {
    const y = octaveDown(sine(200, 1));
    let peak = 0;
    let sum = 0;
    for (const v of y) { peak = Math.max(peak, Math.abs(v)); sum += v * v; }
    expect(peak).toBeLessThan(0.8);
    expect(Math.sqrt(sum / y.length)).toBeGreaterThan(0.15);
  });

  it('is silent for silence', () => {
    expect(octaveDown(new Float32Array(2400)).every((v) => v === 0)).toBe(true);
  });
});

describe('speechChunks', () => {
  it('splits a reply into sentences', () => {
    expect(speechChunks('Your homework is due tomorrow. You have not started it! Shall I make a plan?')).toEqual([
      'Your homework is due tomorrow.', 'You have not started it!', 'Shall I make a plan?',
    ]);
  });

  it('joins very short pieces onto the next one so they do not sound clipped', () => {
    expect(speechChunks('Yes. The math test is on Friday.')).toEqual(['Yes. The math test is on Friday.']);
  });

  it('cuts a very long sentence at a comma, never mid-word', () => {
    const long = `${'word '.repeat(30)}and then, ${'more '.repeat(30)}end.`;
    const chunks = speechChunks(long, 120);
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) expect(c.length).toBeLessThanOrEqual(120);
    expect(chunks.join(' ').replace(/\s+/g, ' ')).toBe(long.replace(/\s+/g, ' ').trim());
  });

  it('keeps a last sentence with no full stop, and ignores empty text', () => {
    expect(speechChunks('Done. Nothing else to report')).toEqual(['Done. Nothing else to report']);
    expect(speechChunks('   ')).toEqual([]);
  });
});

describe('fxParams', () => {
  it('is a clean voice at 0 and stays within limits at any setting', () => {
    expect(Object.values(fxParams(0)).every((v) => v === 0 || Object.is(v, -0))).toBe(true);
    const full = fxParams(5);
    expect(full).toEqual(fxParams(1));
    expect(full.pitchSemitones).toBe(-2);
    expect(fxParams(Number.NaN)).toEqual(fxParams(0));
  });
});

describe('driveCurve', () => {
  it('is a straight line at 0 and a bounded soft clip above it', () => {
    const flat = driveCurve(0, 5);
    expect([...flat]).toEqual([-1, -0.5, 0, 0.5, 1]);
    const c = driveCurve(1);
    expect(Math.max(...c)).toBeLessThanOrEqual(1);
    expect(Math.min(...c)).toBeGreaterThanOrEqual(-1);
  });
});
