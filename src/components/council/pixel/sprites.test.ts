import { describe, expect, it } from 'vitest';
import { COL, ORDER, TEAM } from './palette';
import { BUST_LOOK, FIG, LETTER, SPEC, SPRITE_ERRORS } from './sprites';

describe('the hand-placed sprites', () => {
  it('every run-length row is exactly as wide as its sprite', () => {
    expect(SPRITE_ERRORS).toEqual([]);
  });

  it('only uses the twelve colours of the palette', () => {
    const all = [...Object.values(FIG).flat(), ...Object.values(SPEC).flatMap((f) => [...(f.over ?? []), ...(f.under ?? [])]), ...Object.values(BUST_LOOK).flat()];
    expect(all.filter(([, , ch]) => !(ch in COL))).toEqual([]);
  });

  it('has a figure and a pediment letter for every seat, a face for every specialist, a bust for every team member', () => {
    for (const id of ORDER) { expect(FIG[id].length).toBeGreaterThan(300); expect(LETTER[id]).toHaveLength(5); }
    for (const name of ['Achilles', 'Heracles', 'Demeter', 'Hypnos', 'Chiron', 'Sphinx', 'Kratos', 'Theseus', 'Morpheus', 'Orpheus', 'Ares', 'Calliope', 'Atlas', 'Talos', 'Nike']) expect(SPEC[name], name).toBeDefined();
    for (const [name] of TEAM) expect(BUST_LOOK[name], name).toBeDefined();
  });
});
