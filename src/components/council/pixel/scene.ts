import { BUS, BUST_X, BUST_Y, COL, DIM, EMB, FIG_TOP, H, LIGHT, ORDER, P, SUN, TEAM, THRONE_TOP, TX, W, type Ch, type ColourMap, type Seat } from './palette';
import { BODY_TOP, BUST, BUST_FX, BUST_LOOK, FIG, FLAMES, HEAD, HEAD_FX, LETTER, PLINTH, SPEC, type Px } from './sprites';

/*
 * The chamber's frame loop - ported from the approved preview. The room is drawn once
 * (with a per-pixel colour map, so light can really brighten what is under it); thrones,
 * figures, the spotlight, sparks and eyes are drawn on top every tick, at 10 fps on purpose.
 */

type Ctx = CanvasRenderingContext2D;

function put(c: Ctx, x: number, y: number, ch: Ch | '.', map?: ColourMap | null): void {
  if (ch === '.' || x < 0 || y < 0 || x >= W || y >= H) return;
  c.fillStyle = COL[map ? map[ch] : ch];
  c.fillRect(x * P, y * P, P, P);
}

/* ── The room, drawn once and shared ─────────────────────────────────── */

interface Room { bg: HTMLCanvasElement; idx: Ch[] }
let room: Room | null = null;

function drawRoom(): Room {
  const bg = document.createElement('canvas');
  bg.width = W * P; bg.height = H * P;
  const bctx = bg.getContext('2d')!;
  const idx: Ch[] = new Array(W * H).fill('y');
  const bput = (x: number, y: number, ch: Ch) => { if (x < 0 || y < 0 || x >= W || y >= H) return; idx[y * W + x] = ch; put(bctx, x, y, ch); };
  const bfill = (x: number, y: number, w: number, h: number, ch: Ch) => { for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) bput(i, j, ch); };
  // A small, fixed random: the same speckles every time, like a texture someone painted.
  let seed = 7;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

  // A coffered ceiling, each recess stepped three times with a rosette in the middle.
  bfill(0, 0, W, 24, 'y');
  for (let x = 1; x < W; x += 22) {
    bfill(x, 3, 20, 16, 'g'); bfill(x + 2, 5, 16, 12, 'n'); bfill(x + 4, 7, 12, 8, 'y');
    for (let i = 0; i < 20; i++) bput(x + i, 3, 'k');
    for (let j = 0; j < 16; j++) bput(x, 3 + j, 'k');
    bfill(x + 8, 9, 4, 4, 'b'); bfill(x + 9, 10, 2, 2, 'c');
    bput(x + 10, 8, 'm'); bput(x + 7, 11, 'm'); bput(x + 12, 10, 'm'); bput(x + 9, 13, 'm');
  }
  bfill(0, 20, W, 1, 'd'); bfill(0, 21, W, 1, 'o');
  // The frieze: a Greek key running the length of the wall.
  bfill(0, 22, W, 1, 'm'); bfill(0, 23, W, 9, 'd'); bfill(0, 32, W, 1, 'c'); bfill(0, 33, W, 1, 'm');
  const KEY = ['######', '#.....', '#.###.', '#.#.#.', '#...#.', '#####.'];
  for (let x = 0; x < W; x++) KEY.forEach((row, j) => { if (row[x % 6] === '#') bput(x, 25 + j, 'c'); });
  bfill(0, 24, W, 1, 'b'); bfill(0, 31, W, 1, 'b');
  // Stone wall, block by block, with a little wear.
  bfill(0, 34, W, 122, 'n');
  for (let y = 34, row = 0; y < 156; y += 12, row++) {
    bfill(0, y, W, 1, 'g');
    for (let x = row % 2 ? 12 : 0; x < W; x += 24) for (let j = 1; j < 12 && y + j < 156; j++) bput(x, y + j, 'g');
  }
  for (let i = 0; i < 700; i++) {
    const x = Math.floor(rand() * W);
    const y = 35 + Math.floor(rand() * 120);
    if (idx[y * W + x] === 'n') bput(x, y, rand() < 0.6 ? 'g' : 'y');
  }
  // Ionic columns between the seats: volutes on top, fluted shafts, stepped bases.
  const FLUTE: Ch[] = ['k', 'm', 'c', 'w', 'c', 'm', 'b', 'm', 'b', 'd', 'b', 'o'];
  const VOLUTE = ['.###.', '#...#', '#.#.#', '#.##.', '.#...'];
  for (const cx of [70, 130, 190, 250]) {
    bfill(cx - 10, 34, 20, 2, 'm'); for (let i = -10; i < 10; i++) bput(cx + i, 34, 'c');
    bfill(cx - 8, 36, 16, 4, 'b');
    for (let i = -8; i < 8; i += 2) { bput(cx + i, 37, 'c'); bput(cx + i, 38, 'm'); }
    VOLUTE.forEach((row, j) => [...row].forEach((ch, i) => {
      if (ch !== '#') return;
      bput(cx - 12 + i, 36 + j, 'c'); bput(cx + 7 + (4 - i), 36 + j, 'c');
    }));
    bfill(cx - 6, 41, 12, 3, 'm'); bfill(cx - 6, 41, 12, 1, 'c');
    for (let y = 44; y < 148; y++) FLUTE.forEach((ch, i) => bput(cx - 6 + i, y, ch));
    bfill(cx - 7, 148, 14, 2, 'm'); bfill(cx - 6, 150, 12, 1, 'd'); bfill(cx - 8, 151, 16, 2, 'c'); bfill(cx - 8, 152, 16, 1, 'm');
    bfill(cx - 9, 153, 18, 3, 'b'); bfill(cx - 9, 153, 18, 1, 'm');
  }
  // An arched window to the outside, where Helios lives.
  const inArch = (x: number, y: number, r: number) => (y >= SUN.y - 2 ? Math.abs(x - 31.5) <= r : Math.hypot(x - 31.5, y - (SUN.y - 2)) <= r);
  for (let y = 34; y <= 90; y++) for (let x = 6; x <= 58; x++) {
    if (y > 88) continue;
    if (inArch(x, y, 24)) bput(x, y, 'o');
    if (inArch(x, y, 23)) bput(x, y, x < 32 ? 'c' : 'b');
    if (inArch(x, y, 21)) bput(x, y, 'm');
    if (inArch(x, y, 20)) bput(x, y, y > 76 ? ((x + y) % 2 ? 'y' : 'k') : 'y');
  }
  bfill(6, 89, 53, 1, 'c'); bfill(6, 90, 53, 2, 'm'); bfill(6, 92, 53, 1, 'o');
  // Ultron, set into the wall: rings, notches, an iris.
  const ring = (r: number, ch: Ch, gap = false) => {
    for (let a = 0; a < 720; a++) {
      const t = (a / 720) * Math.PI * 2;
      if (gap && Math.floor((a / 720) * 24) % 2 === 1) continue;
      bput(Math.round(EMB.x + Math.cos(t) * r), Math.round(EMB.y + Math.sin(t) * r), ch);
    }
  };
  const disc = (r: number, ch: Ch) => { for (let y = -r; y <= r; y++) for (let x = -r; x <= r; x++) if (x * x + y * y <= r * r + r * 0.6) bput(EMB.x + x, EMB.y + y, ch); };
  disc(21, 'o'); disc(20, 'y'); ring(20, 'm'); ring(19, 'b'); ring(17, 'c', true); ring(15, 'd'); ring(12, 'b');
  disc(8, 'd'); ring(8, 'm'); disc(5, 'c'); disc(2, 'w');
  bfill(EMB.x - 3, 43, 6, 2, 'm'); bfill(EMB.x - 1, 45, 2, 1, 'c');
  // Cables: Helios feeds the line, Ultron sits on it, every seat drops off it. Clips every 16 pixels.
  for (let y = 93; y <= BUS; y++) bput(SUN.x, y, 'k');
  for (let y = EMB.y + 21; y <= BUS; y++) bput(EMB.x, y, 'k');
  for (let x = SUN.x; x <= TX.projects; x++) bput(x, BUS, 'k');
  for (let x = SUN.x + 8; x < TX.projects; x += 16) { bput(x, BUS - 1, 'm'); bput(x, BUS + 1, 'm'); }
  for (const x of Object.values(TX)) {
    for (let y = BUS + 1; y < THRONE_TOP - 2; y++) bput(x, y, 'k');
    bfill(x - 1, BUS - 1, 3, 3, 'm'); bput(x, BUS, 'c');
  }
  // The dais, with an engraved plate under each seat, and a step down to the floor.
  bfill(4, 156, 312, 1, 'w'); bfill(4, 157, 312, 1, 'c'); bfill(4, 158, 312, 10, 'd'); bfill(4, 168, 312, 1, 'b'); bfill(4, 169, 312, 1, 'o');
  for (let x = 6; x < 314; x += 4) bput(x, 158, 'b');
  for (const cx of Object.values(TX)) {
    bfill(cx - 22, 160, 44, 7, 'y'); bfill(cx - 22, 160, 44, 1, 'o'); bfill(cx - 22, 166, 44, 1, 'b');
    for (let y = 160; y < 167; y++) { bput(cx - 23, y, 'b'); bput(cx + 22, y, 'm'); }
  }
  bfill(0, 170, W, 1, 'm'); bfill(0, 171, W, 5, 'b'); bfill(0, 176, W, 1, 'o');
  // The floor: worn tiles, darker at the edges.
  for (let y = 177; y < H; y++) for (let x = 0; x < W; x++) {
    const tile: Ch = ((Math.floor(x / 16) + Math.floor((y - 177) / 8)) % 2) ? 'n' : 'g';
    bput(x, y, (x % 16 === 0 || (y - 177) % 8 === 0) ? 'y' : tile);
  }
  for (let i = 0; i < 260; i++) {
    const x = Math.floor(rand() * W);
    const y = 178 + Math.floor(rand() * 45);
    if (idx[y * W + x] !== 'y') bput(x, y, rand() < 0.5 ? 'k' : 'y');
  }
  return { bg, idx };
}

function theRoom(): Room {
  return (room ??= drawRoom());
}

/* ── One chamber ─────────────────────────────────────────────────────── */

export type Selection = Seat | 'helios' | null;
export const isSeat = (id: unknown): id is Seat => typeof id === 'string' && (ORDER as readonly string[]).includes(id);

export interface SceneOptions {
  reducedMotion: boolean;
  /** A department not built yet sits dimmed. */
  built: (seat: Seat) => boolean;
  /** The shared-team names a seat borrows (their busts light up). */
  borrows: (seat: Seat) => string[];
}

interface Spark { path: [number, number][]; i: number; speed: number; onDone: () => void }
interface Eye { dx: number; up: boolean; blink: number }

const STARS: [number, number][] = [[18, 48], [44, 46], [22, 70], [48, 66], [27, 54], [40, 74], [15, 60], [36, 50]];

// An orthogonal run of pixels: down, along, down.
function cable(x0: number, y0: number, yMid: number, x1: number, y1: number): [number, number][] {
  const pts: [number, number][] = [];
  for (let y = y0; y <= yMid; y++) pts.push([x0, y]);
  const step = x1 >= x0 ? 1 : -1;
  for (let x = x0 + step; step > 0 ? x <= x1 : x >= x1; x += step) pts.push([x, yMid]);
  for (let y = yMid + 1; y <= y1; y++) pts.push([x1, y]);
  return pts;
}

export function createScene(canvas: HTMLCanvasElement | null, opts: SceneOptions) {
  const { bg, idx } = theRoom();
  const ctx = canvas?.getContext('2d') ?? null;
  const RM = opts.reducedMotion;
  const eyes = Object.fromEntries(ORDER.map((id) => [id, { dx: 0, up: false, blink: 0 }])) as Record<Seat, Eye>;
  const state = {
    sel: null as Selection, convening: false, intel: new Set<Seat>(), sparks: [] as Spark[], flash: {} as Partial<Record<Seat, number>>,
    frame: 0, timer: null as ReturnType<typeof setInterval> | null, reveal: H, spot: 0, motes: [] as { x: number; y: number; t: number }[],
  };
  const idle: ReturnType<typeof setInterval>[] = [];
  const live = new Set<{ cnv: HTMLCanvasElement; fn: (frame: number) => void }>();

  function drawThrone(c: Ctx, id: Seat, map: ColourMap | null, lit: boolean): void {
    const L = TX[id] - 16;
    const T = THRONE_TOP;
    const p = (x: number, y: number, ch: Ch) => put(c, x, y, ch, map);
    p(L + 15, T - 2, 'c'); p(L + 16, T - 2, 'c'); p(L + 15, T - 1, 'm'); p(L + 16, T - 1, 'm');
    for (let r = 0; r < 8; r++) {
      const half = 2 + r * 2;
      const x0 = L + 16 - half;
      const x1 = L + 15 + half;
      for (let x = x0; x <= x1; x++) p(x, T + r, r >= 3 && x > x0 + 2 && x < x1 - 2 ? 'd' : 'm');
      p(x0, T + r, lit ? 'w' : 'c'); if (r) p(x0 + 1, T + r, 'c'); p(x1, T + r, 'b');
    }
    LETTER[id].forEach((row, j) => [...row].forEach((ch, i) => { if (ch === '#') p(L + 14 + i, T + 3 + j, lit ? 'w' : 'c'); }));
    p(L, T + 6, 'c'); p(L + 31, T + 6, 'c');
    const cornice: Ch = (state.flash[id] ?? 0) > 0 ? 'w' : lit ? 'w' : 'c';
    for (let x = L; x < L + 32; x++) { p(x, T + 8, cornice); p(x, T + 9, 'm'); p(x, T + 10, (x - L) % 2 ? 'd' : 'm'); }
    for (let y = T + 11; y < T + 38; y++) {
      for (let x = L + 2; x < L + 30; x++) p(x, y, x < L + 4 || x > L + 27 ? 'm' : 'y');
      p(L + 2, y, lit ? 'w' : 'c'); p(L + 29, y, 'b');
    }
    for (let x = L + 6; x <= L + 25; x++) { p(x, T + 13, 'k'); p(x, T + 35, 'k'); }
    for (let y = T + 13; y <= T + 35; y++) { p(L + 6, y, 'k'); p(L + 25, y, 'k'); }
    for (const ax of [L, L + 28]) {
      for (let y = T + 28; y < T + 38; y++) for (let x = ax; x < ax + 4; x++) p(x, y, y === T + 28 ? 'c' : x === ax ? 'c' : 'm');
      p(ax + 1, T + 30, 'w'); p(ax + 2, T + 30, 'w'); p(ax + 2, T + 31, 'w'); p(ax + 1, T + 32, 'w');
    }
    for (let x = L; x < L + 32; x++) { p(x, T + 38, 'w'); p(x, T + 39, 'c'); p(x, T + 40, 'b'); }
    for (const lx of [L + 2, L + 26]) {
      for (let y = T + 41; y < T + 56; y++) {
        const bulge = (y >= T + 45 && y <= T + 47) || y >= T + 54;
        const x0 = bulge ? lx - 1 : lx;
        const x1 = bulge ? lx + 4 : lx + 3;
        for (let x = x0; x <= x1; x++) p(x, y, x === x0 ? 'c' : x === x1 ? 'b' : 'm');
      }
    }
  }

  function drawFigure(c: Ctx, id: Seat, map: ColourMap | null, frame: number, still: boolean): void {
    const ox = TX[id] - 12;
    const oy = FIG_TOP;
    for (const [r, col, ch] of FIG[id]) put(c, ox + col, oy + r, ch, map);
    if (id === 'school') for (const [r, col, ch] of FLAMES[still ? 0 : Math.floor(frame / 3) % 4]) put(c, ox + col, oy + r, ch, map);
    const e = eyes[id];
    if (e.blink && !still) {
      put(c, ox + 8, oy + 7, 'b'); put(c, ox + 9, oy + 7, 'b'); put(c, ox + 14, oy + 7, 'b'); put(c, ox + 15, oy + 7, 'b');
    } else {
      const r0 = e.up && !still ? 5 : 6;
      for (const ex of [9, 14]) { put(c, ox + ex + e.dx, oy + r0, 'o', map); put(c, ox + ex + e.dx, oy + r0 + 1, 'o', map); }
    }
  }

  // A pool of light from the ceiling onto whoever has the floor. It brightens what's under it.
  function drawSpot(c: Ctx, id: Seat, strength: number): void {
    const cx = TX[id];
    for (let y = 34; y < 156; y++) {
      const t = (y - 34) / 122;
      const half = Math.round(4 + t * 22);
      for (let x = cx - half; x <= cx + half; x++) {
        const edge = Math.abs(x - cx) > half - 2;
        const on = strength >= 2 && !edge ? (x + y) % 2 === 0 : (x % 2 === 0 && y % 2 === 0);
        if (on && x >= 0 && x < W) put(c, x, y, LIGHT[idx[y * W + x]]);
      }
    }
  }

  function drawBust(c: Ctx, i: number, lit: boolean): void {
    const [name] = TEAM[i];
    const x0 = BUST_X(i) - 6;
    const y0 = BUST_Y;
    for (const [r, col, ch] of [...PLINTH, ...BUST, ...BUST_FX, ...BUST_LOOK[name]]) put(c, x0 + col, y0 + r, ch, lit ? null : DIM);
  }

  // Helios and Ultron's moving parts, shared by the room and the panel. Each is [x, y, colour].
  function sunPx(frame: number, still: boolean): [number, number, Ch][] {
    const o: [number, number, Ch][] = [];
    for (let y = -6; y <= 6; y++) for (let x = -6; x <= 6; x++) {
      const d = Math.hypot(x, y);
      if (d <= 4.6) o.push([SUN.x + x, SUN.y + y, d < 2.5 ? 'w' : 'l']);
      else if (d <= 5.4) o.push([SUN.x + x, SUN.y + y, 'c']);
    }
    const turn = still ? 0 : (Math.floor(frame / 5) % 4) * (Math.PI / 16);
    for (let k = 0; k < 8; k++) {
      const a = turn + (k * Math.PI) / 4;
      const len = k % 2 ? 10 : 12;
      for (let r = 7; r <= len; r++) o.push([Math.round(SUN.x + Math.cos(a) * r), Math.round(SUN.y + Math.sin(a) * r), state.sel === 'helios' ? 'w' : r > len - 2 ? 'm' : 'c']);
    }
    STARS.forEach(([x, y], i) => o.push([x, y, still ? 'k' : (frame + i * 7) % 23 < 2 ? 'w' : (frame + i * 3) % 11 < 5 ? 's' : 'k']));
    return o;
  }
  function sweepPx(frame: number, still: boolean): [number, number, Ch][] {
    if (still) return [];
    const step = Math.floor(frame / 2) % 24;
    const o: [number, number, Ch][] = [];
    for (let s = 0; s < 3; s++) {
      const a = (((step - s + 24) % 24) / 24) * Math.PI * 2;
      o.push([Math.round(EMB.x + Math.cos(a) * 17), Math.round(EMB.y + Math.sin(a) * 17), s ? 'l' : 'w']);
    }
    return o;
  }

  function draw(c: Ctx | null = ctx, frame = state.frame, still = false): void {
    if (!c) return;
    c.drawImage(bg, 0, 0);
    const sel = isSeat(state.sel) ? state.sel : null;
    if (sel && !still && state.spot) drawSpot(c, sel, state.spot);
    for (const [x, y, ch] of sunPx(frame, still)) put(c, x, y, ch);
    // Ultron: a light sweeping round the notched ring, one step per frame.
    for (const [x, y, ch] of sweepPx(frame, still)) put(c, x, y, ch);
    if (state.convening && frame % 4 < 2) {
      for (let a = 0; a < 360; a += 2) { const t = (a * Math.PI) / 180; put(c, Math.round(EMB.x + Math.cos(t) * 12), Math.round(EMB.y + Math.sin(t) * 12), 'c'); }
    }
    for (const id of ORDER) {
      // Not built yet, or not the one with the floor: a few shades darker.
      const map = (sel && sel !== id) || !opts.built(id) ? DIM : null;
      drawThrone(c, id, map, sel === id && opts.built(id));
      drawFigure(c, id, map, frame, still);
      if (state.intel.has(id) && !still) {
        const x = TX[id] + 10;
        const y = THRONE_TOP + 1;
        for (let j = 0; j < 4; j++) { put(c, x, y + j, 'w'); put(c, x + 1, y + j, 'w'); }
        put(c, x, y + 5, 'w'); put(c, x + 1, y + 5, 'w');
      }
    }
    if (sel && !still) for (const m of state.motes) put(c, Math.round(m.x), Math.round(m.y), (frame + m.t) % 6 < 3 ? 'w' : 'l');
    for (const s of state.sparks) {
      [0, 1, 2, 3].forEach((back) => {
        const [x, y] = s.path[Math.max(0, Math.min(s.i - back, s.path.length - 1))];
        put(c, x, y, (['w', 'l', 'c', 'm'] as Ch[])[back]);
      });
    }
    const borrowed = sel ? opts.borrows(sel) : [];
    TEAM.forEach(([name], i) => drawBust(c, i, borrowed.includes(name)));
    // Opening switches the room on top to bottom, like an old screen warming up.
    if (state.reveal < H && !still) {
      c.fillStyle = COL.y;
      c.fillRect(0, state.reveal * P, W * P, (H - state.reveal) * P);
      c.fillStyle = COL.c;
      c.fillRect(0, state.reveal * P, W * P, P);
    }
  }

  /** A still picture of the room, for the sidebar launcher. */
  function snapshot(target: HTMLCanvasElement): void {
    const off = document.createElement('canvas');
    off.width = W * P; off.height = H * P;
    draw(off.getContext('2d'), 0, true);
    const t = target.getContext('2d');
    if (!t) return;
    t.imageSmoothingEnabled = false;
    t.clearRect(0, 0, target.width, target.height);
    t.drawImage(off, 0, 0, target.width, target.height);
  }

  function newMotes(id: Seat): void {
    state.motes = Array.from({ length: 9 }, (_, i) => ({ x: TX[id] - 14 + Math.random() * 28, y: 60 + Math.random() * 90, t: i * 2 }));
  }

  function tick(): void {
    state.frame += 1;
    const now = Date.now();
    for (const id of ORDER) {
      if (eyes[id].blink && now > eyes[id].blink) eyes[id].blink = 0;
      if ((state.flash[id] ?? 0) > 0) state.flash[id]! -= 1;
    }
    if (isSeat(state.sel) && state.spot < 2) state.spot += 1;
    for (const m of state.motes) {
      m.y -= 0.35; m.x += Math.sin((state.frame + m.t) / 6) * 0.25;
      if (m.y < 50 && isSeat(state.sel)) { m.y = 150; m.x = TX[state.sel] - 14 + Math.random() * 28; }
    }
    for (const s of state.sparks) s.i += s.speed;
    const done = state.sparks.filter((s) => s.i >= s.path.length + 3);
    state.sparks = state.sparks.filter((s) => s.i < s.path.length + 3);
    for (const s of done) s.onDone();
    draw();
    redrawLive();
  }

  const look = (id: Seat, dx: number, up = false) => { eyes[id].dx = dx; eyes[id].up = up; };

  function start(): void {
    if (state.timer) return;
    if (!RM) {
      state.reveal = 0;
      const warm = setInterval(() => {
        state.reveal = Math.min(H, state.reveal + 28);
        if (!state.timer) draw();
        if (state.reveal >= H) clearInterval(warm);
      }, 30);
      state.timer = setInterval(tick, 100);
      // Idle life, kept small: someone blinks, someone glances over.
      idle.push(setInterval(() => {
        if (state.convening) return;
        eyes[ORDER[Math.floor(Math.random() * ORDER.length)]].blink = Date.now() + 140;
      }, 1600));
      idle.push(setInterval(() => {
        if (state.convening || isSeat(state.sel)) return;
        const id = ORDER[Math.floor(Math.random() * ORDER.length)];
        look(id, Math.random() < 0.5 ? -1 : 1);
        setTimeout(() => { if (!isSeat(state.sel) && !state.convening) look(id, 0); }, 1500);
      }, 3700));
    }
    draw();
  }
  function stop(): void {
    if (state.timer) clearInterval(state.timer);
    state.timer = null;
    state.reveal = H;
    while (idle.length) clearInterval(idle.pop()!);
    live.clear();
  }

  function select(id: Selection): void {
    state.sel = id;
    state.spot = RM ? 2 : 0;
    for (const s of ORDER) look(s, !isSeat(id) || s === id ? 0 : Math.sign(TX[id] - TX[s]));
    if (isSeat(id)) { state.intel.delete(id); newMotes(id); }
    if (!state.timer) draw();
  }

  /** Helios sends a spark down the cable to a seat - new intel. */
  function signal(id: Seat): Promise<void> {
    return new Promise((resolve) => {
      if (RM || !state.timer) { state.intel.add(id); resolve(); return; }
      state.sparks.push({ path: cable(SUN.x, 93, BUS, TX[id], THRONE_TOP - 3), i: 0, speed: 6, onDone: () => { state.intel.add(id); state.flash[id] = 3; resolve(); } });
    });
  }

  /** Ultron calls everyone in: sparks to every seat, everyone looks up. */
  function convene(seats: readonly Seat[] = ORDER): Promise<void> {
    state.convening = true;
    for (const id of ORDER) look(id, 0, true);
    for (const id of seats) {
      if (RM || !state.timer) { state.flash[id] = 1; continue; }
      state.sparks.push({ path: cable(EMB.x, EMB.y + 21, BUS, TX[id], THRONE_TOP - 3), i: 0, speed: 12, onDone: () => { state.flash[id] = 5; } });
    }
    if (!state.timer) draw();
    return new Promise((r) => setTimeout(r, RM ? 0 : 1300));
  }
  function stopConvene(): void {
    state.convening = false;
    state.sparks = [];
    for (const id of ORDER) { state.flash[id] = 0; look(id, 0); }
    if (isSeat(state.sel)) select(state.sel);
    if (!state.timer) draw();
  }

  /* ── Portraits for the side panel ──────────────────────────────────── */

  const art = (w: number, h: number) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c.getContext('2d')!; };
  const paint = (o: Ctx, pixels: Px[], x0: number, y0: number) => {
    for (const [r, c, ch] of pixels) {
      const x = c - x0;
      const y = r - y0;
      if (x >= 0 && y >= 0 && x < o.canvas.width && y < o.canvas.height) { o.fillStyle = COL[ch]; o.fillRect(x, y, 1, 1); }
    }
  };
  // Dark behind them, with a little floor-light dithered in at the bottom.
  const backdrop = (o: Ctx) => {
    const { width: w, height: h } = o.canvas;
    o.fillStyle = COL.y; o.fillRect(0, 0, w, h);
    o.fillStyle = COL.n;
    for (let y = Math.floor(h * 0.6); y < h; y++) for (let x = y % 2; x < w; x += 2) o.fillRect(x, y, 1, 1);
  };
  const show = (target: HTMLCanvasElement, o: Ctx) => {
    const t = target.getContext('2d');
    if (!t) return;
    t.imageSmoothingEnabled = false;
    t.clearRect(0, 0, target.width, target.height);
    t.drawImage(o.canvas, 0, 0, target.width, target.height);
  };
  // The panel's portrait blinks when the one in the room blinks: they're the same person.
  const eyesOf = (id: Seat | null, closed = false): Px[] => {
    const e = (id && eyes[id]) || { dx: 0, up: false, blink: 0 };
    if (closed || e.blink) return [[7, 8, 'b'], [7, 9, 'b'], [7, 14, 'b'], [7, 15, 'b']];
    const r0 = e.up ? 5 : 6;
    return [9, 14].flatMap((x): Px[] => [[r0, x + e.dx, 'o'], [r0 + 1, x + e.dx, 'o']]);
  };
  const fromRoom = (o: Ctx, x0: number, y0: number) => {
    const { width: w, height: h } = o.canvas;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { o.fillStyle = COL[idx[(y0 + y) * W + (x0 + x)]]; o.fillRect(x, y, 1, 1); }
  };

  const RENDER: Record<string, (target: HTMLCanvasElement, arg: string, frame: number) => void> = {
    // A department head, big: head, shoulders, and whatever they're holding.
    head(target, arg, frame) {
      const id = arg as Seat;
      // In the close-up Prometheus holds the torch lower, so his face and the fire both fit.
      const shortTorch = (pixels: Px[]) => pixels.flatMap(([r, c, ch]): Px[] => (c >= 17 && c <= 24 && r <= -8 ? (r >= -13 ? [] : [[r + 6, c, ch]]) : [[r, c, ch]]));
      const o = art(32, 32);
      const y0 = id === 'school' ? -16 : -12;
      backdrop(o);
      paint(o, id === 'school' ? shortTorch(FIG[id]) : FIG[id], -4, y0);
      if (id === 'school') paint(o, shortTorch(FLAMES[Math.floor(frame / 3) % 4]), -4, y0);
      paint(o, eyesOf(id), -4, y0);
      show(target, o);
    },
    // The same head, small, for lists.
    mini(target, arg) {
      const id = arg as Seat;
      const o = art(24, 24);
      backdrop(o); paint(o, FIG[id], 0, -7); paint(o, eyesOf(id), 0, -7);
      show(target, o);
    },
    face(target, name) {
      const look = SPEC[name];
      if (!look) return;
      const o = art(24, 24);
      backdrop(o);
      paint(o, [...(look.under ?? []), ...HEAD, ...HEAD_FX, ...BODY_TOP, ...(look.over ?? [])], 0, -7);
      if (look.eyes !== 'none') paint(o, eyesOf(null, look.eyes === 'closed'), 0, -7);
      show(target, o);
    },
    bust(target, name) {
      if (!BUST_LOOK[name]) return;
      const o = art(16, 25);
      o.fillStyle = COL.y; o.fillRect(0, 0, 16, 25);
      paint(o, [...PLINTH, ...BUST, ...BUST_FX, ...BUST_LOOK[name]], -2, -4);
      show(target, o);
    },
    ultron(target, _arg, frame) {
      const o = art(46, 46);
      fromRoom(o, EMB.x - 23, EMB.y - 23);
      if (state.convening && frame % 4 < 2) {
        for (let a = 0; a < 360; a += 2) { const t = (a * Math.PI) / 180; o.fillStyle = COL.c; o.fillRect(Math.round(23 + Math.cos(t) * 12), Math.round(23 + Math.sin(t) * 12), 1, 1); }
      }
      paint(o, sweepPx(frame, false).map(([x, y, ch]): Px => [y, x, ch]), EMB.x - 23, EMB.y - 23);
      show(target, o);
    },
    helios(target, _arg, frame) {
      const o = art(40, 40);
      fromRoom(o, SUN.x - 20, SUN.y - 20);
      paint(o, sunPx(frame, false).map(([x, y, ch]): Px => [y, x, ch]), SUN.x - 20, SUN.y - 20);
      show(target, o);
    },
  };

  /** Draws a portrait now; the ones that move (blinking, the torch, the sweep, the rays) join the loop. */
  function portrait(cnv: HTMLCanvasElement, spec: string): () => void {
    const [kind, arg = ''] = spec.split(':');
    const render = RENDER[kind];
    if (!render) return () => {};
    const entry = { cnv, fn: (frame: number) => render(cnv, arg, frame) };
    entry.fn(state.frame);
    if (kind !== 'face' && kind !== 'bust') live.add(entry);
    return () => { live.delete(entry); };
  }
  function redrawLive(): void {
    for (const p of live) {
      if (!p.cnv.isConnected) live.delete(p);
      else p.fn(state.frame);
    }
  }

  return { draw, snapshot, start, stop, select, signal, convene, stopConvene, portrait, state };
}

export type Scene = ReturnType<typeof createScene>;
