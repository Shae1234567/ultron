import { ORDER, type Ch, type Seat } from './palette';

/*
 * Sprites, written out by hand - pure data. A sprite is a list of [row, column, colour]
 * pixels. Rows are written run-length: "9.6o9." is 9 empty, 6 dark, 9 empty. Every row of a
 * block must be exactly as wide as its sprite; SPRITE_ERRORS collects any that are not (a
 * unit test keeps it empty - the preview's console guard, made a test).
 */

export type Px = [r: number, c: number, ch: Ch];

export const SPRITE_ERRORS: string[] = [];

const rle = (s: string) => s.replace(/(\d*)(\D)/g, (_, n: string, ch: string) => ch.repeat(n ? Number(n) : 1));
function rowsPx(rows: string[], r0: number, w: number, name: string): Px[] {
  return rows.flatMap((row, i) => {
    const s = rle(row);
    if (s.length !== w) SPRITE_ERRORS.push(`${name} row ${r0 + i} is ${s.length} wide, not ${w}`);
    return [...s].map((ch, c) => [r0 + i, c, ch] as [number, number, string]).filter((p) => p[2] !== '.') as Px[];
  });
}
export const seg = (r: number, c0: number, c1: number, ch: Ch): Px[] => { const o: Px[] = []; for (let c = c0; c <= c1; c++) o.push([r, c, ch]); return o; };
export const vseg = (c: number, r0: number, r1: number, ch: Ch): Px[] => { const o: Px[] = []; for (let r = r0; r <= r1; r++) o.push([r, c, ch]); return o; };
const alt = (r: number, c0: number, c1: number, a: Ch, b: Ch): Px[] => { const o: Px[] = []; for (let c = c0; c <= c1; c++) o.push([r, c, (c - c0) % 2 ? b : a]); return o; };
const px = (list: [number, number, string][]) => list as Px[];

// One seated figure, 24 wide: head rows 0-13, robe and legs below.
export const HEAD = rowsPx([
  '9.6o9.', '7.2o6l2o7.', '6.o10lo6.', '6.o10lo6.', '6.o10lo6.', '6.o10lo6.',
  '5.o12lo5.', '5.o12lo5.', '6.o10lo6.', '6.o10lo6.', '6.o10lo6.', '7.o8lo7.', '8.o6lo8.', '9.6o9.',
], 0, 24, 'HEAD');
export const HEAD_FX: Px[] = [
  [2, 8, 'w'], [2, 9, 'w'], [3, 7, 'w'],                 // light from the left
  ...vseg(16, 3, 10, 'm'), [11, 15, 'm'], [12, 14, 'm'], // shadow on the right
  [5, 9, 'm'], [5, 10, 'm'], [5, 13, 'm'], [5, 14, 'm'], // brows
  [8, 12, 'm'], [9, 12, 'm'],                            // nose
  [10, 11, 'm'], [10, 12, 'm'],                          // mouth
  [7, 6, 'm'], [7, 17, 'm'],                             // ears
];
export const BODY = rowsPx([
  '9.o4lo9.', '6.o3c4l3co6.', '4.o5c4l5co4.', '3.o7c2l7co3.',
  '3.o16co3.', '3.o16co3.', '3.o16co3.', '3.o16co3.', '3.o16co3.', '3.o16co3.', '3.o16co3.', '3.o16co3.', '3.o16co3.',
  '2.o18co2.', '2.o18co2.', '2.o18co2.', '3.o16co3.', '4.o14co4.',
  '5.o4lo2.o4lo5.', '5.o4lo2.o4lo5.', '5.o4lo2.o4lo5.', '5.o4lo2.o4lo5.', '5.o4lo2.o4lo5.',
  '5.o4lo2.o4lo5.', '5.o4lo2.o4lo5.', '5.o4lo2.o4lo5.', '5.o4lo2.o4lo5.',
  '4.o5lo2.o5lo4.', '4.o5lo2.o5lo4.', '4.7o2.7o4.',
], 14, 24, 'BODY');
export const BODY_FX: Px[] = [
  ...vseg(7, 18, 25, 'b'), ...vseg(16, 18, 25, 'b'),    // where the arms meet the body
  ...vseg(4, 17, 25, 'w'),                               // lit edge of the left arm
  ...vseg(19, 18, 26, 'm'), ...vseg(20, 27, 29, 'm'),    // shaded right side
  ...vseg(10, 19, 24, 'm'), ...vseg(13, 19, 24, 'm'), [21, 12, 'b'], [22, 12, 'b'], [23, 11, 'b'], // folds
  ...seg(25, 8, 15, 'd'), [25, 11, 'w'], [25, 12, 'w'], // belt and buckle
  // the himation: a cloak worn over the left shoulder, down to the right hip
  ...Array.from({ length: 11 }, (_, k): Px => [16 + k, 6 + k, 'w']),
  ...Array.from({ length: 10 }, (_, k): Px => [17 + k, 6 + k, 'm']),
  ...seg(28, 6, 9, 'm'), ...seg(28, 14, 17, 'm'), [29, 11, 'b'], [29, 12, 'b'], [30, 11, 'b'], [30, 12, 'b'], // lap folds
  ...alt(31, 5, 18, 'w', 'm'),                           // patterned hem
  ...vseg(9, 32, 40, 'm'), ...vseg(17, 32, 40, 'm'),     // shins
  ...seg(35, 6, 9, 'd'), ...seg(35, 14, 17, 'd'), ...seg(38, 6, 9, 'd'), ...seg(38, 14, 17, 'd'), // sandal straps
  [41, 5, 'w'], [41, 14, 'w'],
];
const HANDS: Px[] = [[26, 5, 'l'], [26, 6, 'l'], [27, 5, 'l'], [27, 6, 'm'], [26, 17, 'l'], [26, 18, 'l'], [27, 17, 'l'], [27, 18, 'm']];
const darkHair = (extra = 0): Px[] => [
  ...seg(-1, 9 - extra, 14 + extra, 'o'), ...seg(0, 8 - extra, 15 + extra, 'd'), [0, 7 - extra, 'o'], [0, 16 + extra, 'o'],
  ...seg(1, 7 - extra, 16 + extra, 'd'), [1, 6 - extra, 'o'], [1, 17 + extra, 'o'],
  [2, 7, 'd'], [2, 8, 'd'], [2, 15, 'd'], [2, 16, 'd'],
  [0, 10, 'k'], [0, 13, 'k'], [1, 9, 'k'], [1, 12, 'k'], [1, 15, 'k'],
];

const snake = (): Px[] => {
  const o: Px[] = [];
  for (let r = 0; r <= 38; r++) {
    const x = Math.round(27.5 + 2.6 * Math.sin(r * 0.52));
    o.push([r, x, 'c'], [r, x <= 27 ? x - 1 : x + 1, 'm']);
  }
  return o;
};
const flame = (sway: number): Px[] => {
  const o: Px[] = [];
  const rows = 9;
  for (let i = 0; i < rows; i++) {
    const r = -17 - i;
    const hw = i >= rows - 2 ? 0 : Math.max(1, Math.round(3.2 * (1 - i / rows)));
    const cx = 20.5 + sway * (i / rows) * 1.8;
    for (let c = Math.round(cx - hw); c <= Math.round(cx + hw); c++) {
      const d = Math.abs(c - cx);
      o.push([r, c, d < hw * 0.35 ? 'w' : d < hw * 0.75 ? 'l' : 'c']);
    }
  }
  return o;
};

// Each head, by what they wear and hold in Greek art.
const LOOKS: Record<Seat, Px[]> = {
  // Clio: long hair, a band across it, a scroll open on her lap.
  history: [
    ...seg(-1, 9, 14, 'o'), ...seg(0, 9, 14, 'd'), [0, 7, 'o'], [0, 8, 'o'], [0, 15, 'o'], [0, 16, 'o'],
    ...seg(1, 7, 16, 'd'), [1, 6, 'o'], [1, 17, 'o'], [2, 7, 'd'], [2, 8, 'd'], [2, 15, 'd'], [2, 16, 'd'], ...seg(2, 9, 14, 'c'),
    ...Array.from({ length: 16 }, (_, i) => px([[2 + i, 4, 'o'], [2 + i, 5, 'd'], [2 + i, 6, 'd'], [2 + i, 17, 'd'], [2 + i, 18, 'd'], [2 + i, 19, 'o']])).flat(),
    ...seg(18, 4, 6, 'o'), ...seg(18, 17, 19, 'o'),
    [1, 9, 'b'], [1, 10, 'b'], [4, 5, 'b'], [8, 5, 'b'], [12, 5, 'b'], [6, 18, 'b'], [11, 18, 'b'], [15, 6, 'b'],
    ...seg(25, 2, 21, 'o'), ...seg(26, 2, 21, 'w'), ...seg(27, 2, 21, 'l'), ...seg(28, 2, 21, 'm'), ...seg(29, 2, 21, 'o'),
    ...vseg(1, 25, 29, 'o'), ...vseg(22, 25, 29, 'o'),
    [26, 2, 'l'], [27, 2, 'm'], [28, 2, 'b'], [26, 3, 'w'], [27, 3, 'l'], [28, 3, 'm'],
    [26, 20, 'w'], [27, 20, 'l'], [28, 20, 'm'], [26, 21, 'l'], [27, 21, 'm'], [28, 21, 'b'],
    ...seg(27, 7, 10, 'm'), ...seg(27, 13, 16, 'm'),
    [26, 6, 'l'], [27, 6, 'l'], [26, 17, 'l'], [27, 17, 'l'],
  ],
  // Asclepius: white curls, a full beard, his hand on the rod with the snake round it.
  health: [
    ...seg(-1, 9, 14, 'o'), ...alt(0, 8, 15, 'w', 'l'), [0, 7, 'o'], [0, 16, 'o'],
    ...alt(1, 7, 16, 'l', 'w'), [1, 6, 'o'], [1, 17, 'o'], [2, 7, 'w'], [2, 16, 'w'], [3, 7, 'l'], [3, 16, 'l'],
    [5, 9, 'w'], [5, 10, 'w'], [5, 13, 'w'], [5, 14, 'w'],
    ...seg(9, 10, 13, 'w'), [9, 7, 'w'], [9, 8, 'w'], [9, 15, 'w'], [9, 16, 'w'],
    ...seg(10, 7, 10, 'w'), ...seg(10, 13, 16, 'w'),
    [11, 6, 'o'], [11, 17, 'o'], ...seg(11, 7, 16, 'w'), [12, 6, 'o'], [12, 17, 'o'], ...seg(12, 7, 16, 'w'),
    [13, 7, 'o'], [13, 16, 'o'], ...seg(13, 8, 15, 'w'), [14, 8, 'o'], [14, 15, 'o'], ...seg(14, 9, 14, 'l'),
    [15, 9, 'o'], [15, 14, 'o'], ...seg(15, 10, 13, 'l'), [16, 10, 'o'], [16, 13, 'o'], [16, 11, 'l'], [16, 12, 'l'], [17, 11, 'o'], [17, 12, 'o'],
    [11, 9, 'l'], [11, 13, 'l'], [12, 8, 'l'], [12, 11, 'l'], [12, 14, 'l'], [13, 10, 'l'], [13, 13, 'l'],
    ...vseg(27, -18, 43, 'm'), ...vseg(28, -18, 43, 'b'),
    [-20, 27, 'w'], [-20, 28, 'w'], [-19, 26, 'w'], [-19, 27, 'l'], [-19, 28, 'l'], [-19, 29, 'm'],
    ...snake(),
    [-2, 25, 'c'], [-2, 26, 'o'], [-1, 24, 'c'], [-1, 25, 'c'], [-1, 26, 'm'], [-1, 23, 'w'],
    ...vseg(16, 23, 26, 'c'), ...vseg(17, 23, 26, 'c'), ...vseg(18, 23, 26, 'c'), [27, 17, 'c'], [27, 18, 'c'],
    ...seg(20, 19, 24, 'o'), ...seg(21, 19, 24, 'c'), ...seg(22, 19, 24, 'b'), ...seg(23, 19, 24, 'o'),
    [20, 25, 'o'], [20, 26, 'o'], [21, 25, 'l'], [21, 26, 'l'], [22, 25, 'l'], [22, 26, 'm'], [23, 25, 'o'], [23, 26, 'o'],
  ],
  // Prometheus: short dark hair, a jaw that hasn't shaved, holding up the fire he stole.
  school: [
    ...darkHair(), ...seg(5, 8, 10, 'd'), ...seg(5, 13, 15, 'd'),
    [11, 9, 'm'], [11, 11, 'm'], [11, 13, 'm'], [12, 10, 'm'], [12, 12, 'm'],
    ...[18, 19, 20, 21, 22, 23, 24, 25, 26].flatMap((r) => px([[r, 16, 'c'], [r, 17, 'c'], [r, 18, 'c'], [r, 19, 'm']])),
    [26, 17, 'c'], [26, 18, 'c'], [27, 17, 'c'], [27, 18, 'c'],
    ...Array.from({ length: 17 }, (_, i) => px([[1 + i, 18, 'o'], [1 + i, 19, 'c'], [1 + i, 20, 'c'], [1 + i, 21, 'm'], [1 + i, 22, 'o']])).flat(),
    [15, 17, 'c'], [16, 17, 'c'], [17, 17, 'c'],
    ...seg(-3, 19, 21, 'o'), [-2, 18, 'o'], [-2, 22, 'o'], ...seg(-2, 19, 21, 'l'),
    [-1, 18, 'o'], [-1, 22, 'o'], [-1, 19, 'l'], [-1, 20, 'l'], [-1, 21, 'm'], [0, 18, 'o'], [0, 22, 'o'], [0, 19, 'l'], [0, 20, 'l'], [0, 21, 'm'],
    ...Array.from({ length: 10 }, (_, i) => px([[-13 + i, 19, 'o'], [-13 + i, 20, 'm'], [-13 + i, 21, 'b'], [-13 + i, 22, 'o']])).flat(),
    ...seg(-16, 18, 23, 'o'), ...seg(-15, 18, 23, 'c'), [-14, 18, 'o'], ...seg(-14, 19, 22, 'm'), [-14, 23, 'o'],
  ],
  // Dionysus: curls, an ivy wreath with grapes, a grin - and a controller in his hands.
  media: [
    ...darkHair(1),
    ...Array.from({ length: 7 }, (_, i) => px([[3 + i, 4, 'o'], [3 + i, 5, 'd'], [3 + i, 6, 'd'], [3 + i, 17, 'd'], [3 + i, 18, 'd'], [3 + i, 19, 'o']])).flat(),
    [4, 5, 'k'], [7, 18, 'k'],
    [-2, 9, 'c'], [-2, 14, 'c'], [-1, 7, 'c'], [-1, 11, 'c'], [-1, 12, 'c'], [-1, 16, 'c'], [-1, 8, 'm'], [-1, 15, 'm'], [0, 5, 'c'], [0, 18, 'c'],
    [2, 4, 'w'], [3, 3, 'l'], [3, 4, 'l'], [4, 3, 'm'], [4, 4, 'l'], [5, 4, 'm'],
    [9, 10, 'm'], [9, 13, 'm'],
    ...seg(25, 6, 17, 'o'), [26, 5, 'o'], ...seg(26, 6, 17, 'k'), [26, 18, 'o'], [27, 5, 'o'], ...seg(27, 6, 17, 'k'), [27, 18, 'o'],
    [28, 5, 'o'], ...seg(28, 6, 9, 'k'), ...seg(28, 10, 13, 'o'), ...seg(28, 14, 17, 'k'), [28, 18, 'o'], ...seg(29, 6, 9, 'o'), ...seg(29, 14, 17, 'o'),
    [26, 8, 'c'], [27, 7, 'c'], [27, 8, 'c'], [27, 9, 'c'], [28, 8, 'c'], [26, 15, 'w'], [27, 14, 'c'], [27, 16, 'w'], [28, 15, 'c'], [26, 11, 'm'], [26, 12, 'm'],
    [27, 3, 'o'], [28, 3, 'o'], [27, 4, 'l'], [28, 4, 'm'], [27, 19, 'l'], [28, 19, 'm'], [27, 20, 'o'], [28, 20, 'o'],
  ],
  // Odysseus: the pointed felt cap he's always drawn in, a short beard, an oar from the voyage home.
  projects: [
    ...(() => {
      const o: Px[] = [];
      for (let r = -7; r <= 1; r++) {
        const hw = 1 + Math.floor((r + 7) * 0.75);
        const a = 12 - hw;
        const b = 11 + hw;
        for (let c = a; c <= b; c++) o.push([r, c, 'b']);
        o.push([r, a, 'o'], [r, b, 'o'], [r, a + 1, 'm'], [r, b - 1, 'd']);
      }
      o.push([-8, 11, 'o'], [-8, 12, 'o']);
      return o;
    })(),
    ...seg(2, 6, 17, 'm'), [2, 5, 'o'], [2, 18, 'o'], ...seg(2, 7, 10, 'c'),
    ...seg(9, 10, 13, 'd'), ...seg(10, 7, 10, 'd'), ...seg(10, 13, 16, 'd'),
    [11, 6, 'o'], [11, 17, 'o'], ...seg(11, 7, 16, 'd'), [12, 7, 'o'], [12, 16, 'o'], ...seg(12, 8, 15, 'd'), [13, 8, 'o'], [13, 15, 'o'], ...seg(13, 9, 14, 'd'),
    [11, 9, 'k'], [12, 12, 'k'], [11, 14, 'k'],
    ...(() => {
      const o: Px[] = [];
      for (let r = -16; r <= 43; r++) {
        const c = Math.round(1 - ((r + 16) * 6) / 59);
        o.push([r, c, 'm'], [r, c + 1, 'b']);
        if (r >= 28) {
          const hw = r < 31 || r > 41 ? 1 : 2;
          for (let k = -hw; k <= hw; k++) o.push([r, c + k, k === -hw ? 'w' : 'c']);
          o.push([r, c - hw - 1, 'o'], [r, c + hw + 1, 'o']);
        }
      }
      return o;
    })(),
    ...vseg(4, 20, 26, 'c'), ...vseg(5, 20, 26, 'c'), ...vseg(6, 20, 26, 'c'), ...vseg(7, 20, 26, 'c'),
    ...seg(17, 1, 4, 'o'), [18, 0, 'o'], ...seg(18, 1, 4, 'c'), [19, 0, 'o'], ...seg(19, 1, 4, 'b'), ...seg(20, 1, 4, 'o'),
    [18, -1, 'l'], [19, -1, 'l'], [17, -1, 'o'], [20, -1, 'o'],
  ],
};
export const FIG = Object.fromEntries(ORDER.map((id) => [id, [...HEAD, ...HEAD_FX, ...BODY, ...BODY_FX, ...HANDS, ...LOOKS[id]]])) as Record<Seat, Px[]>;
export const FLAMES = [flame(0), flame(1), flame(0.4), flame(-1)];

// Greek letters for the pediments, 5 x 5.
export const LETTER: Record<Seat, string[]> = {
  health: ['#...#', '.#.#.', '..#..', '..#..', '..#..'],
  school: ['#####', '.#...', '..#..', '.#...', '#####'],
  media: ['#...#', '##.##', '#.#.#', '#...#', '#...#'],
  history: ['.###.', '..#..', '..#..', '..#..', '.###.'],
  projects: ['#####', '#....', '####.', '#....', '#####'],
};

// The shared team, as busts on plinths - each with one thing that's theirs.
export const BUST = rowsPx(['3.6o3.', '2.o6lo2.', '2.o6lo2.', '2.o6lo2.', '2.o6lo2.', '3.o4lo3.', '4.o2lo4.', '1.o8co1.', 'o10co', 'o10co', 'o10co', '12o'], 0, 12, 'BUST');
export const BUST_FX: Px[] = [[3, 4, 'o'], [3, 7, 'o'], [2, 3, 'w'], [1, 3, 'w'], ...vseg(8, 1, 4, 'm'), ...vseg(1, 8, 10, 'w'), ...vseg(10, 8, 10, 'm')];
export const BUST_LOOK: Record<string, Px[]> = {
  Athena: [...seg(0, 2, 9, 'm'), ...seg(1, 2, 9, 'm'), [1, 2, 'o'], [1, 9, 'o'], ...seg(-1, 3, 8, 'c'), ...seg(-2, 4, 7, 'c'), [-3, 5, 'w'], [-3, 6, 'w'], [2, 2, 'm'], [2, 9, 'm']],
  Argus: [[2, 5, 'o'], [2, 6, 'o'], [4, 3, 'o'], [4, 8, 'o'], [1, 4, 'o'], [1, 7, 'o']],
  Hermes: [...seg(0, 2, 9, 'm'), [-1, 0, 'w'], [-1, 1, 'w'], [0, 0, 'w'], [0, 1, 'l'], [-1, 10, 'w'], [-1, 11, 'w'], [0, 10, 'l'], [0, 11, 'w']],
  Chronos: [...seg(5, 3, 8, 'w'), ...seg(6, 3, 8, 'w'), ...seg(7, 4, 7, 'l'), ...seg(8, 5, 6, 'l'), ...seg(0, 3, 8, 'w')],
  Hephaestus: [...seg(-1, 3, 8, 'o'), ...seg(0, 2, 9, 'b'), ...seg(5, 3, 8, 'd'), ...seg(6, 4, 7, 'd')],
  Mnemosyne: [...seg(-2, 4, 7, 'd'), ...seg(-1, 3, 8, 'd'), ...seg(0, 2, 9, 'd'), ...vseg(1, 1, 6, 'd'), ...vseg(10, 1, 6, 'd')],
  Daedalus: [...vseg(-1, 6, 10, 'w'), ...vseg(-2, 7, 9, 'l'), ...vseg(12, 6, 10, 'w'), ...vseg(13, 7, 9, 'l')],
};
export const PLINTH: Px[] = [
  ...seg(12, 1, 10, 'c'),
  ...[13, 14, 15, 16, 17, 18].flatMap((r): Px[] => [...seg(r, 2, 9, 'b'), [r, 2, 'm'], [r, 9, 'd']]),
  ...seg(19, 0, 11, 'm'), ...seg(20, 0, 11, 'o'),
];
export const BODY_TOP: Px[] = [...BODY, ...BODY_FX].filter(([r]) => r <= 16);

const mirror = (list: Px[]): Px[] => list.map(([r, c, ch]): Px => [r, 23 - c, ch]);
const longHair = (h: Ch, hl: Ch, to = 16): Px[] => [
  ...seg(-1, 9, 14, 'o'), ...seg(0, 9, 14, h), [0, 7, 'o'], [0, 8, 'o'], [0, 15, 'o'], [0, 16, 'o'],
  ...seg(1, 7, 16, h), [1, 6, 'o'], [1, 17, 'o'], [2, 7, h], [2, 8, h], [2, 15, h], [2, 16, h],
  ...Array.from({ length: to - 1 }, (_, i): Px[] => [[2 + i, 4, 'o'], [2 + i, 5, h], [2 + i, 6, h], [2 + i, 17, h], [2 + i, 18, h], [2 + i, 19, 'o']]).flat(),
  ...seg(to + 1, 4, 6, 'o'), ...seg(to + 1, 17, 19, 'o'),
  [1, 9, hl], [1, 10, hl], [4, 5, hl], [9, 5, hl], [6, 18, hl], [12, 18, hl],
];
const shortHair = (h: Ch = 'd', hl: Ch = 'k'): Px[] => [
  ...seg(-1, 9, 14, 'o'), ...seg(0, 8, 15, h), [0, 7, 'o'], [0, 16, 'o'],
  ...seg(1, 7, 16, h), [1, 6, 'o'], [1, 17, 'o'], [2, 7, h], [2, 8, h], [2, 15, h], [2, 16, h],
  [0, 10, hl], [0, 13, hl], [1, 9, hl], [1, 12, hl], [1, 15, hl],
];
const beard = (h: Ch, hl: Ch): Px[] => [
  ...seg(10, 7, 10, h), ...seg(10, 13, 16, h), [11, 6, 'o'], [11, 17, 'o'], ...seg(11, 7, 16, h),
  [12, 6, 'o'], [12, 17, 'o'], ...seg(12, 7, 16, h), [13, 7, 'o'], [13, 16, 'o'], ...seg(13, 8, 15, h),
  [14, 8, 'o'], [14, 15, 'o'], ...seg(14, 9, 14, h), [15, 9, 'o'], [15, 14, 'o'], ...seg(15, 10, 13, h),
  ...seg(9, 10, 13, h), [11, 9, hl], [12, 12, hl], [13, 10, hl], [14, 13, hl],
];
const wingL = (rows: [number, number, number, Ch][]): Px[] => rows.flatMap(([r, c0, c1, ch]): Px[] => [...seg(r, c0, c1, ch), [r, c0 - 1, 'o']]);

export interface Face { over?: Px[]; under?: Px[]; eyes?: 'closed' | 'none' }

// The specialists' faces: the same head, and one or two things that make each of them who they are.
export const SPEC: Record<string, Face> = {
  // Achilles: an open bronze helmet with a horsehair crest swept back.
  Achilles: { over: [
    ...seg(-2, 8, 15, 'o'), ...seg(-1, 8, 15, 'm'), [-1, 7, 'o'], [-1, 16, 'o'],
    ...seg(0, 6, 17, 'm'), [0, 5, 'o'], [0, 18, 'o'], [0, 7, 'c'], [0, 8, 'c'],
    ...seg(1, 5, 18, 'm'), [1, 4, 'o'], [1, 19, 'o'], [1, 6, 'c'], ...seg(2, 5, 18, 'b'), [2, 4, 'o'], [2, 19, 'o'],
    ...vseg(5, 3, 9, 'm'), ...vseg(6, 3, 9, 'b'), ...vseg(4, 3, 9, 'o'), ...vseg(18, 3, 9, 'm'), ...vseg(17, 3, 9, 'b'), ...vseg(19, 3, 9, 'o'),
    ...seg(10, 4, 6, 'o'), ...seg(10, 17, 19, 'o'),
    ...seg(-3, 9, 14, 'c'), ...seg(-4, 9, 15, 'w'), ...seg(-5, 10, 16, 'c'), ...seg(-6, 12, 17, 'c'),
    ...seg(-7, 12, 17, 'o'), [-6, 11, 'o'], [-5, 9, 'o'], [-4, 8, 'o'], [-3, 8, 'o'], [-6, 18, 'o'], [-5, 17, 'm'], [-5, 18, 'o'],
  ] },
  // Heracles: the lion of Nemea worn as a hood - ears, eyes, teeth over his brow, mane down the sides.
  Heracles: { over: [
    [-5, 7, 'o'], [-5, 8, 'o'], [-5, 15, 'o'], [-5, 16, 'o'], [-4, 6, 'o'], [-4, 7, 'd'], [-4, 8, 'b'], [-4, 9, 'o'],
    [-4, 14, 'o'], [-4, 15, 'b'], [-4, 16, 'd'], [-4, 17, 'o'],
    ...seg(-3, 7, 16, 'b'), [-3, 6, 'o'], [-3, 17, 'o'], ...seg(-2, 5, 18, 'b'), [-2, 4, 'o'], [-2, 19, 'o'],
    ...seg(-1, 4, 19, 'b'), [-1, 3, 'o'], [-1, 20, 'o'], ...seg(0, 4, 19, 'b'), [0, 3, 'o'], [0, 20, 'o'],
    ...seg(1, 4, 19, 'd'), [1, 3, 'o'], [1, 20, 'o'], ...alt(2, 6, 17, 'w', 'd'), ...seg(2, 3, 5, 'b'), ...seg(2, 18, 20, 'b'), [2, 2, 'o'], [2, 21, 'o'],
    ...Array.from({ length: 13 }, (_, i): Px[] => [[3 + i, 2, 'o'], [3 + i, 3, 'b'], [3 + i, 4, 'd'], [3 + i, 5, 'b'], [3 + i, 18, 'b'], [3 + i, 19, 'd'], [3 + i, 20, 'b'], [3 + i, 21, 'o']]).flat(),
    [-2, 9, 'o'], [-2, 14, 'o'], [-1, 9, 'c'], [-1, 14, 'c'], [0, 11, 'o'], [0, 12, 'o'], [5, 3, 'k'], [11, 3, 'k'], [8, 20, 'k'], [13, 20, 'k'],
    ...beard('d', 'k'),
  ] },
  // Demeter: long hair under a crown of wheat.
  Demeter: { over: [
    ...longHair('b', 'm'), ...seg(0, 7, 16, 'c'),
    ...[8, 11, 14].flatMap((c): Px[] => [[-1, c, 'm'], [-2, c, 'm'], [-3, c, 'w'], [-4, c, 'l'], [-5, c, 'w'], [-6, c, 'l'], [-3, c - 1, 'l'], [-5, c + 1, 'l'], [-4, c + 1, 'w'], [-6, c - 1, 'w']]),
    [-2, 6, 'm'], [-3, 5, 'l'], [-2, 17, 'm'], [-3, 18, 'l'],
  ] },
  // Hypnos: little wings at his temples. Asleep, naturally.
  Hypnos: { eyes: 'closed', over: [
    ...shortHair(),
    ...wingL([[0, 3, 5, 'w'], [1, 2, 5, 'w'], [2, 1, 5, 'l'], [3, 1, 5, 'l'], [4, 2, 5, 'm'], [5, 3, 5, 'm']]),
    ...mirror(wingL([[0, 3, 5, 'w'], [1, 2, 5, 'w'], [2, 1, 5, 'l'], [3, 1, 5, 'l'], [4, 2, 5, 'm'], [5, 3, 5, 'm']])),
    ...seg(-7, 18, 21, 'w'), [-6, 20, 'w'], [-5, 19, 'w'], ...seg(-4, 18, 21, 'w'), [-2, 16, 'l'], [-2, 17, 'l'], [-1, 17, 'l'], [0, 16, 'l'], [0, 17, 'l'],
    [10, 11, 'b'], [10, 12, 'b'],
  ] },
  // Chiron: the old teacher. Bald on top, a fringe, a long brown beard.
  Chiron: { over: [
    ...vseg(6, 2, 7, 'd'), ...vseg(7, 2, 4, 'd'), ...vseg(16, 2, 4, 'd'), ...vseg(17, 2, 7, 'd'), ...vseg(5, 2, 5, 'o'), ...vseg(18, 2, 5, 'o'),
    [1, 9, 'w'], [1, 10, 'w'], [2, 9, 'w'], ...beard('b', 'm'), [16, 10, 'o'], [16, 13, 'o'], [16, 11, 'b'], [16, 12, 'b'], [17, 11, 'o'], [17, 12, 'o'],
  ] },
  // The Sphinx: a striped headcloth.
  Sphinx: { over: [
    ...seg(-2, 9, 14, 'o'), ...seg(-1, 7, 16, 'c'), [-1, 6, 'o'], [-1, 17, 'o'], ...seg(0, 6, 17, 'b'), [0, 5, 'o'], [0, 18, 'o'],
    ...seg(1, 5, 18, 'c'), [1, 4, 'o'], [1, 19, 'o'], ...seg(2, 5, 18, 'w'), [2, 4, 'o'], [2, 19, 'o'],
    ...Array.from({ length: 12 }, (_, i): Px[] => { const r = 3 + i; const ch: Ch = r % 2 ? 'c' : 'b'; return [[r, 3, 'o'], [r, 4, ch], [r, 5, ch], [r, 6, ch], [r, 17, ch], [r, 18, ch], [r, 19, ch], [r, 20, 'o']]; }).flat(),
    ...seg(15, 3, 6, 'o'), ...seg(15, 17, 20, 'o'),
  ] },
  // Kratos: shaved head, heavy brows pulled in, a short beard. Never smiles.
  Kratos: { over: [
    ...seg(4, 8, 10, 'd'), ...seg(5, 8, 10, 'd'), ...seg(4, 13, 15, 'd'), ...seg(5, 13, 15, 'd'), [5, 10, 'o'], [5, 13, 'o'],
    [1, 9, 'w'], [1, 10, 'w'], [2, 9, 'w'], ...seg(10, 10, 13, 'o'), ...seg(11, 9, 14, 'd'), ...seg(12, 10, 13, 'd'), [13, 11, 'd'], [13, 12, 'd'],
  ] },
  // Theseus: curls and a headband, ready for the labyrinth.
  Theseus: { over: [...shortHair(), ...seg(2, 7, 16, 'c'), [2, 6, 'o'], [2, 17, 'o'], [3, 5, 'c'], [4, 4, 'c'], [5, 4, 'm']] },
  // Morpheus: a hood the colour of night, with stars in it.
  Morpheus: { over: [
    ...seg(-4, 9, 14, 'o'), ...seg(-3, 7, 16, 's'), [-3, 6, 'o'], [-3, 17, 'o'], ...seg(-2, 5, 18, 's'), [-2, 4, 'o'], [-2, 19, 'o'],
    ...seg(-1, 4, 19, 'k'), [-1, 3, 'o'], [-1, 20, 'o'], ...seg(0, 4, 19, 'k'), [0, 3, 'o'], [0, 20, 'o'], ...seg(1, 4, 19, 'k'), [1, 3, 'o'], [1, 20, 'o'],
    ...seg(2, 3, 6, 'k'), ...seg(2, 17, 20, 'k'), [2, 2, 'o'], [2, 21, 'o'],
    ...Array.from({ length: 14 }, (_, i): Px[] => [[3 + i, 2, 'o'], [3 + i, 3, 'k'], [3 + i, 4, 's'], [3 + i, 5, 'k'], [3 + i, 18, 'k'], [3 + i, 19, 's'], [3 + i, 20, 'k'], [3 + i, 21, 'o']]).flat(),
    [-2, 9, 'w'], [-1, 15, 'w'], [0, 7, 'l'], [6, 3, 'w'], [11, 20, 'w'], [14, 4, 'l'],
  ] },
  // Orpheus: the greatest musician in the myths. These days: headphones.
  Orpheus: { over: [
    ...longHair('d', 'k', 10),
    ...seg(-4, 8, 15, 'o'), ...seg(-3, 7, 16, 'm'), [-3, 6, 'o'], [-3, 17, 'o'], [-2, 5, 'm'], [-2, 6, 'm'], [-2, 17, 'm'], [-2, 18, 'm'], [-2, 4, 'o'], [-2, 19, 'o'],
    ...vseg(4, -1, 3, 'm'), ...vseg(3, -1, 3, 'o'), ...vseg(19, -1, 3, 'm'), ...vseg(20, -1, 3, 'o'),
    ...[4, 5, 6, 7, 8, 9].flatMap((r): Px[] => [[r, 1, 'o'], [r, 2, 'c'], [r, 3, 'c'], [r, 4, 'b'], [r, 5, 'o'], [r, 18, 'o'], [r, 19, 'b'], [r, 20, 'c'], [r, 21, 'c'], [r, 22, 'o']]),
    ...seg(3, 1, 5, 'o'), ...seg(10, 1, 5, 'o'), ...seg(3, 18, 22, 'o'), ...seg(10, 18, 22, 'o'), [5, 2, 'w'], [5, 20, 'w'],
  ] },
  // Ares: a full Corinthian helmet - eye holes, a nose guard, a crest standing straight up.
  Ares: { over: [
    ...seg(-2, 8, 15, 'o'),
    ...Array.from({ length: 13 }, (_, i): Px[] => { const r = -1 + i; return [...seg(r, 5, 18, 'm'), [r, 4, 'o'], [r, 19, 'o'], [r, 6, 'c'], [r, 17, 'b']]; }).flat(),
    ...seg(12, 4, 19, 'o'),
    ...seg(5, 8, 10, 'l'), ...seg(6, 8, 10, 'l'), ...seg(7, 8, 10, 'l'), ...seg(5, 13, 15, 'l'), ...seg(6, 13, 15, 'l'), ...seg(7, 13, 15, 'l'),
    ...seg(4, 8, 10, 'o'), ...seg(4, 13, 15, 'o'), ...vseg(11, 4, 9, 'm'), ...vseg(12, 4, 9, 'b'),
    ...seg(9, 10, 13, 'o'), ...seg(10, 10, 13, 'o'), ...seg(11, 10, 13, 'o'),
    ...Array.from({ length: 5 }, (_, i) => seg(-7 + i, 9, 14, i % 2 ? 'c' : 'w')).flat(), ...vseg(8, -7, -3, 'o'), ...vseg(15, -7, -3, 'o'),
  ] },
  // Calliope: long hair, a laurel wreath, a quill tucked behind her ear.
  Calliope: { over: [
    ...longHair('d', 'k'),
    [0, 7, 'c'], [-1, 9, 'c'], [-1, 10, 'm'], [-1, 13, 'm'], [-1, 14, 'c'], [0, 16, 'c'], [-2, 11, 'c'], [-2, 12, 'c'],
    [6, 21, 'w'], [5, 21, 'w'], [4, 22, 'l'], [3, 22, 'w'], [2, 23, 'l'], [7, 20, 'm'], [8, 20, 'm'],
  ] },
  // Atlas: a huge beard, brows straining - and the sky he holds, shrunk to a globe over his head.
  Atlas: { over: [
    ...seg(4, 8, 10, 'd'), ...seg(4, 13, 15, 'd'), [3, 10, 'd'], [3, 13, 'd'], ...beard('d', 'k'), [16, 10, 'o'], [16, 13, 'o'], [16, 11, 'd'], [16, 12, 'd'],
    ...(() => {
      const o: Px[] = [];
      for (let y = -7; y <= -1; y++) for (let x = 8; x <= 15; x++) {
        const d = Math.hypot(x - 11.5, y + 4);
        if (d <= 3.1) o.push([y, x, x === 11 || x === 12 || y === -4 ? 'm' : 'b']);
        else if (d <= 3.9) o.push([y, x, 'o']);
      }
      o.push([-6, 10, 'c'], [-5, 9, 'c']);
      return o;
    })(),
  ] },
  // Talos: the bronze man Hephaestus built. A robot, three thousand years early.
  Talos: { eyes: 'none', over: [
    ...seg(-1, 6, 17, 'o'),
    ...Array.from({ length: 14 }, (_, i): Px[] => [...seg(i, 6, 17, 'm'), [i, 5, 'o'], [i, 18, 'o'], [i, 7, 'c'], [i, 16, 'b']]).flat(),
    ...seg(14, 5, 18, 'o'), ...seg(0, 7, 16, 'c'),
    ...seg(5, 8, 15, 'o'), ...seg(6, 8, 15, 'o'), ...seg(7, 8, 15, 'o'), [6, 9, 'c'], [6, 10, 'w'], [6, 13, 'c'], [6, 14, 'w'],
    [2, 8, 'w'], [2, 15, 'w'], [12, 8, 'w'], [12, 15, 'w'],
    ...alt(9, 9, 14, 'o', 'b'), ...alt(10, 9, 14, 'b', 'o'), ...alt(11, 9, 14, 'o', 'b'),
    ...vseg(11, -4, -2, 'm'), ...vseg(12, -4, -2, 'b'), [-5, 11, 'w'], [-5, 12, 'w'],
    [6, 4, 'b'], [7, 4, 'b'], [6, 3, 'o'], [7, 3, 'o'], [6, 19, 'b'], [7, 19, 'b'], [6, 20, 'o'], [7, 20, 'o'],
  ] },
  // Nike: big wings, her hair up, a laurel for whoever finishes.
  Nike: {
    under: [
      ...wingL([[-5, 3, 5, 'w'], [-4, 2, 5, 'w'], [-3, 1, 5, 'l'], [-2, 0, 5, 'l'], [-1, 0, 5, 'w'], [0, 0, 5, 'l'], [1, 0, 5, 'w'],
        [2, 0, 5, 'l'], [3, 1, 5, 'm'], [4, 1, 5, 'm'], [5, 1, 5, 'm'], [6, 1, 5, 'm'], [7, 2, 5, 'b'], [8, 2, 5, 'b'], [9, 2, 5, 'b'], [10, 3, 5, 'd'], [11, 3, 5, 'd']]),
      ...mirror(wingL([[-5, 3, 5, 'w'], [-4, 2, 5, 'w'], [-3, 1, 5, 'l'], [-2, 0, 5, 'l'], [-1, 0, 5, 'w'], [0, 0, 5, 'l'], [1, 0, 5, 'w'],
        [2, 0, 5, 'l'], [3, 1, 5, 'm'], [4, 1, 5, 'm'], [5, 1, 5, 'm'], [6, 1, 5, 'm'], [7, 2, 5, 'b'], [8, 2, 5, 'b'], [9, 2, 5, 'b'], [10, 3, 5, 'd'], [11, 3, 5, 'd']])),
      ...[-4, -2, 0, 2, 4, 6, 8].flatMap((r): Px[] => [[r, 4, 'b'], [r, 19, 'b']]),
    ],
    over: [
      ...shortHair(), ...seg(-4, 10, 13, 'o'), ...seg(-3, 10, 13, 'd'), [-3, 9, 'o'], [-3, 14, 'o'], ...seg(-2, 10, 13, 'd'), [-2, 11, 'k'],
      [0, 7, 'c'], [-1, 8, 'c'], [0, 16, 'c'], [-1, 15, 'c'],
    ],
  },
};
