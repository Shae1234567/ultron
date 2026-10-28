import { beforeEach, describe, expect, it, vi } from 'vitest';

let disk: Record<string, unknown> = {};
vi.mock('./store', () => ({
  readDoc: (name: string, fallback: unknown) => (name in disk ? disk[name] : fallback),
  writeDoc: (name: string, data: unknown) => { disk[name] = JSON.parse(JSON.stringify(data)); },
}));

import { CREDITS_RETRY_MS, health, prune, resetHealth, saveHealth } from './cloudHealth';

beforeEach(() => {
  disk = {};
  resetHealth();
});

describe('remembering what works, across restarts', () => {
  it('starts empty and survives a save and reload', () => {
    expect(health().good).toEqual({});
    health().good.nvidia = 'meta/llama-3.2-90b-vision-instruct';
    health().dead.push('nvidia:nvidia/nemotron-4-340b-instruct');
    saveHealth();

    // A restart: the in-memory copy is gone, the file is not.
    resetHealth();
    disk['cloud-health.json'] && (void 0);
    const reloaded = JSON.parse(JSON.stringify(disk['cloud-health.json']));
    expect(reloaded.good.nvidia).toBe('meta/llama-3.2-90b-vision-instruct');
    expect(reloaded.dead).toContain('nvidia:nvidia/nemotron-4-340b-instruct');
  });

  it('survives a file that is missing, empty or the wrong shape', () => {
    for (const junk of [undefined, {}, { good: 'not an object', dead: 'not a list' }, { dead: null }]) {
      disk = junk === undefined ? {} : { 'cloud-health.json': junk };
      resetHealth();
      const h = health();
      expect(Array.isArray(h.dead)).toBe(true);
      expect(typeof h.good).toBe('object');
      expect(typeof h.rest).toBe('object');
      expect(typeof h.credits).toBe('object');
    }
  });

  it('never hands out the stored object itself, or one save would edit the next read', () => {
    disk['cloud-health.json'] = { good: { groq: 'a' }, dead: ['x'], rest: {}, credits: {}, verdict: {} };
    resetHealth();
    health().dead.push('y');
    const onDisk = disk['cloud-health.json'] as { dead: string[] };
    expect(onDisk.dead).toEqual(['x']);
  });
});

describe('forgetting on time', () => {
  it('drops a rest and a credit window once it has passed, so nothing stays stuck', () => {
    const h = { good: {}, dead: [], rest: { 'groq:a': Date.now() - 1 }, credits: { huggingface: Date.now() - 1 }, verdict: {} };
    prune(h);
    expect(h.rest).toEqual({});
    expect(h.credits).toEqual({});
  });

  it('keeps one that is still running', () => {
    const until = Date.now() + 60_000;
    const h = { good: {}, dead: [], rest: { 'groq:a': until }, credits: { huggingface: until }, verdict: {} };
    prune(h);
    expect(h.rest['groq:a']).toBe(until);
    expect(h.credits.huggingface).toBe(until);
  });

  it('caps the dead list, so a service with a long catalogue cannot grow the file forever', () => {
    const h = { good: {}, dead: Array.from({ length: 500 }, (_, i) => `nvidia:m${i}`), rest: {}, credits: {}, verdict: {} };
    prune(h);
    expect(h.dead).toHaveLength(200);
    // The newest are the ones worth keeping.
    expect(h.dead.at(-1)).toBe('nvidia:m499');
  });

  it('re-tries a credit-less service often enough to heal itself, not so often it is rude', () => {
    expect(CREDITS_RETRY_MS).toBeGreaterThanOrEqual(3600_000);
    expect(CREDITS_RETRY_MS).toBeLessThanOrEqual(12 * 3600_000);
  });

  it('a save that throws is swallowed - losing this must never fail a real answer', () => {
    resetHealth();
    health().good.groq = 'a';
    const spy = vi.spyOn(JSON, 'stringify').mockImplementation(() => { throw new Error('disk full'); });
    expect(() => saveHealth()).not.toThrow();
    spy.mockRestore();
  });
});
