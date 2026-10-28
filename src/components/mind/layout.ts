import type { MindShell } from '../../types';

/*
 * Where every note sits in the mind sphere. Pure, so it can be tested.
 *
 * Shells, inside out: the profile at the core (always in Ultron's mind), the agents' own brains
 * on an inner shell, the vault on the main sphere, and the operator's HQ files as an outer
 * shell of context Ultron reads but never writes. On each shell every group (folder) gets its
 * own slice of longitude, like continents, sized by how many notes it has; inside a slice the
 * notes are spread evenly with a golden-ratio spiral.
 */

export const SHELL_RADIUS: Record<MindShell, number> = { core: 0, brain: 0.48, vault: 1, hq: 1.34 };

export interface Sector { group: string; shell: MindShell; from: number; to: number }

const GOLDEN = 0.6180339887;
const TAU = Math.PI * 2;

/** A small, stable number in [0, 1) from a string - the same note always gets the same nudge. */
export function hash01(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return ((h >>> 0) % 100000) / 100000;
}

export function layoutMind(nodes: { id: string; group: string; shell: MindShell }[]): { pos: Float32Array; lon: Float32Array; sectors: Sector[] } {
  const pos = new Float32Array(nodes.length * 3);
  const lon = new Float32Array(nodes.length);
  const sectors: Sector[] = [];

  for (const shell of ['core', 'brain', 'vault', 'hq'] as MindShell[]) {
    const idx = nodes.map((n, i) => (n.shell === shell ? i : -1)).filter((i) => i >= 0);
    if (!idx.length) continue;
    const r = SHELL_RADIUS[shell];

    if (shell === 'core') {
      // One profile sits dead centre; any others huddle round it.
      idx.forEach((i, k) => {
        const a = k * 2.4;
        const d = k === 0 ? 0 : 0.07;
        pos.set([Math.cos(a) * d, 0, Math.sin(a) * d], i * 3);
      });
      continue;
    }

    // Groups in this shell, biggest first, each a slice of longitude (small ones still get room).
    const groups = new Map<string, number[]>();
    for (const i of idx) { const g = nodes[i].group; groups.set(g, [...(groups.get(g) ?? []), i]); }
    const ordered = [...groups.entries()].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]));
    const gap = ordered.length > 1 ? 0.08 : 0;
    const weights = ordered.map(([, m]) => Math.max(m.length, idx.length * 0.03));
    const total = weights.reduce((a, b) => a + b, 0);
    let start = 0;
    ordered.forEach(([group, members], gi) => {
      const span = (TAU - gap * ordered.length) * (weights[gi] / total);
      const from = start;
      const to = start + span;
      sectors.push({ group, shell, from, to });
      const n = members.length;
      members.forEach((i, k) => {
        const v = (k + 0.5) / n;
        const y = (1 - 2 * v) * 0.9;
        const ring = Math.sqrt(1 - y * y);
        const a = from + ((k * GOLDEN + hash01(nodes[i].id) * 0.15) % 1) * span;
        const rr = r * (1 + (hash01(`${nodes[i].id}#r`) - 0.5) * 0.06);
        pos.set([Math.cos(a) * ring * rr, y * rr, Math.sin(a) * ring * rr], i * 3);
        lon[i] = a;
      });
      start = to + gap;
    });
  }
  return { pos, lon, sectors };
}
