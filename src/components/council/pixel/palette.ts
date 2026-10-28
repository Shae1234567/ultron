/*
 * The council chamber in pixels (approved by the operator, 8 Oct 2026 - ported from
 * projects/ultron-council/preview.html, not redesigned). A 320 x 224 room shown at 3x,
 * twelve shades of Ultron's cyan, light from the left, a dark outline on everything.
 */

export const COL = {
  o: '#020b13', y: '#050c16', n: '#0a1626', g: '#0f2238', k: '#173a55', s: '#2a4a66',
  d: '#0b3a4f', b: '#0a5a78', m: '#0891b2', c: '#00d9ff', l: '#8fe9ff', w: '#eaf7ff',
} as const;
export type Ch = keyof typeof COL;
export type ColourMap = Record<Ch, Ch>;

/** Whoever doesn't have the floor sits a few shades darker... */
export const DIM: ColourMap = { o: 'o', y: 'y', n: 'n', g: 'g', k: 'y', s: 'g', d: 'y', b: 'd', m: 'd', c: 'b', l: 's', w: 's' };
/** ...and light on a surface pushes it a shade up. */
export const LIGHT: ColourMap = { o: 'y', y: 'n', n: 'g', g: 'k', k: 's', s: 'b', d: 'b', b: 'm', m: 'c', c: 'l', l: 'w', w: 'w' };

export const P = 3;
export const W = 320;
export const H = 224;

export const ORDER = ['history', 'health', 'school', 'media', 'projects'] as const;
export type Seat = (typeof ORDER)[number];

/** Each seat's centre, left to right. */
export const TX: Record<Seat, number> = { history: 40, health: 100, school: 160, media: 220, projects: 280 };
export const THRONE_TOP = 100;
export const FIG_TOP = 112;
export const BUS = 94;
/** Ultron's ring, and Helios's window. */
export const EMB = { x: 160, y: 66 };
export const SUN = { x: 32, y: 62 };

/** The shared team as busts along the front, in this order. */
export const TEAM: [name: string, role: string][] = [['Athena', 'Strategist'], ['Argus', 'Researcher'], ['Hermes', 'Connector'], ['Chronos', 'Timekeeper'],
  ['Hephaestus', 'Operator'], ['Mnemosyne', 'Memory'], ['Daedalus', 'Web builder']];
export const BUST_X = (i: number) => 34 + i * 42;
export const BUST_Y = 186;
