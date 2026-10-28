import { describe, expect, it } from 'vitest';
import { hash01, layoutMind, SHELL_RADIUS } from './layout';
import type { MindShell } from '../../types';

const make = (spec: [string, MindShell, number][]) =>
  spec.flatMap(([group, shell, n]) => Array.from({ length: n }, (_, k) => ({ id: `${group}/${k}.md`, group, shell })));

describe('layoutMind', () => {
  const nodes = make([['Profile', 'core', 1], ['Brains', 'brain', 6], ['Memory/Health', 'vault', 30], ['Journal', 'vault', 20], ['School', 'vault', 10], ['HQ/school', 'hq', 8]]);
  const { pos, sectors } = layoutMind(nodes);
  const radius = (i: number) => Math.hypot(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]);

  it('puts each shell at its own distance from the centre', () => {
    nodes.forEach((n, i) => {
      if (n.shell === 'core') expect(radius(i)).toBe(0);
      else expect(Math.abs(radius(i) - SHELL_RADIUS[n.shell])).toBeLessThan(SHELL_RADIUS[n.shell] * 0.04);
    });
  });

  it('gives every group its own slice, biggest first, without overlap', () => {
    const vault = sectors.filter((s) => s.shell === 'vault');
    expect(vault.map((s) => s.group)).toEqual(['Memory/Health', 'Journal', 'School']);
    for (let k = 1; k < vault.length; k++) expect(vault[k].from).toBeGreaterThan(vault[k - 1].to);
    expect(vault[vault.length - 1].to).toBeLessThanOrEqual(Math.PI * 2);
    expect(vault[0].to - vault[0].from).toBeGreaterThan(vault[2].to - vault[2].from);
  });

  it('keeps each note inside its group slice', () => {
    nodes.forEach((n, i) => {
      if (n.shell === 'core') return;
      const s = sectors.find((x) => x.group === n.group)!;
      let a = Math.atan2(pos[i * 3 + 2], pos[i * 3]);
      if (a < 0) a += Math.PI * 2;
      expect(a).toBeGreaterThanOrEqual(s.from - 1e-6);
      expect(a).toBeLessThanOrEqual(s.to + 1e-6);
    });
  });

  it('is the same every time (notes do not jump around between openings)', () => {
    expect([...layoutMind(nodes).pos]).toEqual([...pos]);
  });

  it('copes with an empty mind', () => {
    expect(layoutMind([]).pos.length).toBe(0);
  });
});

describe('hash01', () => {
  it('is stable and in range', () => {
    expect(hash01('a')).toBe(hash01('a'));
    for (const s of ['', 'x', 'Memory/Health/Sleep.md']) { expect(hash01(s)).toBeGreaterThanOrEqual(0); expect(hash01(s)).toBeLessThan(1); }
  });
});
