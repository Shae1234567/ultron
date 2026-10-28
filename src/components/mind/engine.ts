import { hash01, layoutMind, SHELL_RADIUS } from './layout';
import type { MindGraph } from '../../types';

/*
 * The mind sphere's renderer: plain 2D canvas with its own 3D projection (no 3D library).
 * Everything glows with additive blending, so nothing needs sorting by depth.
 *
 *  - notes:     small glowing data fragments, sized by length, brighter when recent
 *  - links:     faint arcs bowed toward the core, lit up around whatever is hovered or picked
 *  - thoughts:  pulses of light running along links, more of them from recent notes
 *  - rings:     segmented orbital rings turning at their own speeds
 *  - streaks:   drifting fragments in a halo around it all
 *  - scanner:   a meridian sweeping round, brightening what it passes
 *  - opening:   every fragment flies in from the dark and settles into place
 * Reduced motion: none of the movement - one still frame, redrawn when he drags or picks.
 */

const GROUP_HUES: [RegExp, string][] = [
  [/^Profile/, '#ffffff'],
  [/^Brains/, '#9ff7ff'],
  [/^Journal/, '#4aa8ff'],
  [/^Team Runs/, '#00ffcc'],
  [/^Research/, '#a493ff'],
  [/^School/, '#ffc94a'],
  [/^Health/, '#5dff9e'],
  [/^Intel/, '#ffe27a'],
  [/^History/, '#ff9a62'],
  [/^Projects/, '#ff6fd8'],
  [/^HQ/, '#8fb6cc'],
];

/** A group's colour: Ultron cyan for memory (each category its own shade), an accent for the rest. */
export function groupColor(group: string): string {
  if (group.startsWith('Memory')) {
    const h = 186 + Math.round((hash01(group) - 0.5) * 26);
    return `hsl(${h}, 100%, ${58 + Math.round(hash01(`${group}l`) * 10)}%)`;
  }
  return GROUP_HUES.find(([re]) => re.test(group))?.[1] ?? '#00d9ff';
}

export interface EngineEvents {
  onHover: (i: number | null, x: number, y: number) => void;
  onSelect: (i: number | null) => void;
}

interface Ring { r: number; tiltX: number; tiltZ: number; segs: number; fill: number; speed: number; phase: number }
interface Thought { e: number; t: number; speed: number; forward: boolean }

const CAM = 3.4;
const STRIPS = 780;
const DAY = 86_400_000;
const ease = (x: number) => 1 - Math.pow(1 - Math.min(1, Math.max(0, x)), 3);

export class MindEngine {
  private ctx: CanvasRenderingContext2D;
  private w = 0;
  private h = 0;
  private dpr = 1;
  private graph: MindGraph | null = null;
  private target: Float32Array = new Float32Array(0);
  private start = new Float32Array(0);
  private delay = new Float32Array(0);
  private lon: Float32Array = new Float32Array(0);
  private color: string[] = [];
  private sprite = new Map<string, HTMLCanvasElement>();
  private degree = new Uint16Array(0);
  private neighbours: number[][] = [];
  private recent = new Float32Array(0);
  // projected, per frame
  private sx = new Float32Array(0);
  private sy = new Float32Array(0);
  private sz = new Float32Array(0);
  private sf = new Float32Array(0);
  private alive = new Float32Array(0);

  private yaw = 0.6;
  private pitch = 0.32;
  private yawVel = 0;
  private zoom = 1;
  private focusTo: { yaw: number; pitch: number; from: { yaw: number; pitch: number }; t0: number } | null = null;
  private dragging: { x: number; y: number; moved: number; lastX: number; lastY: number } | null = null;
  private hover: number | null = null;
  private selected: number | null = null;
  private match: Uint8Array | null = null;
  private pulses = new Map<number, number>();
  private thoughts: Thought[] = [];
  private rings: Ring[] = [
    { r: 1.16, tiltX: 0.22, tiltZ: 0.1, segs: 72, fill: 0.62, speed: 0.12, phase: 0 },
    { r: 1.24, tiltX: 1.05, tiltZ: -0.5, segs: 54, fill: 0.5, speed: -0.08, phase: 1 },
    { r: 0.74, tiltX: -0.7, tiltZ: 0.9, segs: 40, fill: 0.55, speed: 0.2, phase: 2 },
    { r: 1.5, tiltX: 0.45, tiltZ: 0.25, segs: 110, fill: 0.3, speed: 0.04, phase: 3 },
  ];
  private dust: Float32Array;
  /** Decorative strips of light along the shells' latitudes - the mass of the sphere (not notes). */
  private strips: Float32Array;
  private born = 0;
  /** Average milliseconds per frame (shown on the canvas as data-ms, for checks). */
  frameMs = 0;
  private last = 0;
  private raf = 0;
  private running = false;
  private dirty = true;
  private resizeObs: ResizeObserver;

  constructor(private canvas: HTMLCanvasElement, private ev: EngineEvents, private reduced: boolean) {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('No 2D canvas');
    this.ctx = ctx;
    // The halo of drifting streaks: random directions at 1.45-1.95 of the sphere's radius.
    this.dust = new Float32Array(160 * 4);
    for (let i = 0; i < 160; i++) {
      const u = hash01(`d${i}`) * 2 - 1;
      const a = hash01(`a${i}`) * Math.PI * 2;
      const r = 1.45 + hash01(`r${i}`) * 0.5;
      const s = Math.sqrt(1 - u * u);
      this.dust.set([Math.cos(a) * s * r, u * r * 0.8, Math.sin(a) * s * r, 0.4 + hash01(`s${i}`)], i * 4);
    }
    // The strips: most on the main sphere, the rest on an inner shell that turns the other way.
    this.strips = new Float32Array(STRIPS * 5);
    for (let i = 0; i < STRIPS; i++) {
      const inner = i % 10 < 3;
      const y = (hash01(`sy${i}`) * 2 - 1) * 0.96;
      const r = inner ? 0.56 + hash01(`sr${i}`) * 0.14 : 0.9 + hash01(`sr${i}`) * 0.2;
      this.strips.set([y, hash01(`sl${i}`) * Math.PI * 2, 0.03 + hash01(`ss${i}`) * 0.13, r, inner ? -1 : 1], i * 5);
    }
    this.resizeObs = new ResizeObserver(() => this.resize());
    this.resizeObs.observe(canvas);
    this.resize();
    canvas.addEventListener('pointerdown', this.down);
    canvas.addEventListener('pointermove', this.move);
    canvas.addEventListener('pointerup', this.up);
    canvas.addEventListener('pointerleave', this.leave);
    canvas.addEventListener('wheel', this.wheel, { passive: false });
    canvas.addEventListener('dblclick', this.dbl);
  }

  /* ── data ── */

  /**
   * A new graph. The first time, everything flies in. After that (Ultron wrote a note), only the
   * new notes fly in and the rest glide to wherever their slice moved - no re-assembly every message.
   */
  setGraph(g: MindGraph, animate = true): void {
    const prev = this.graph;
    const was = new Map<string, [number, number, number]>();
    if (prev && !animate) {
      prev.nodes.forEach((x, i) => {
        // where it is on screen now, in model space (mid-flight included)
        const k = ease(((performance.now() - this.born) / 1000 - this.delay[i]) / 1.25);
        const at = (a: number) => this.start[i * 3 + a] + (this.target[i * 3 + a] - this.start[i * 3 + a]) * k;
        was.set(x.id, [at(0), at(1), at(2)]);
      });
    }
    const selectedId = this.selected !== null ? prev?.nodes[this.selected]?.id : undefined;
    this.graph = g;
    const n = g.nodes.length;
    const { pos, lon } = layoutMind(g.nodes);
    this.target = pos;
    this.lon = lon;
    this.color = g.nodes.map((x) => groupColor(x.group));
    this.degree = new Uint16Array(n);
    this.neighbours = Array.from({ length: n }, () => []);
    for (const [a, b] of g.links) { this.degree[a]++; this.degree[b]++; this.neighbours[a].push(b); this.neighbours[b].push(a); }
    const now = Date.now();
    this.recent = new Float32Array(n);
    g.nodes.forEach((x, i) => { this.recent[i] = Math.max(0, 1 - (now - x.mtime) / (3 * DAY)); });
    this.sx = new Float32Array(n); this.sy = new Float32Array(n); this.sz = new Float32Array(n); this.sf = new Float32Array(n);
    this.alive = new Float32Array(n);
    const fresh = !prev || animate;
    const age = fresh ? 0 : (performance.now() - this.born) / 1000;
    this.start = new Float32Array(n * 3);
    this.delay = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const id = g.nodes[i].id;
      const old = was.get(id);
      if (old) {
        // Already there: glide from where it was.
        this.start.set(old, i * 3);
        this.delay[i] = age;
        continue;
      }
      // Flies in from the dark: all of them on opening, just the new ones after.
      const k = 2.6 + hash01(`${id}s`) * 2.2;
      const jx = (hash01(`${id}x`) - 0.5) * 1.6;
      const jy = (hash01(`${id}y`) - 0.5) * 1.6;
      this.start.set([pos[i * 3] * k + jx, pos[i * 3 + 1] * k + jy, pos[i * 3 + 2] * k], i * 3);
      this.delay[i] = fresh
        ? (g.nodes[i].shell === 'core' ? 0 : g.nodes[i].shell === 'brain' ? 0.15 : g.nodes[i].shell === 'vault' ? 0.3 : 0.55) + hash01(`${id}d`) * 0.7
        : age + 0.1;
    }
    if (fresh) this.born = performance.now();
    this.thoughts = [];
    this.pulses.clear();
    this.hover = null;
    // Notes are sorted newest first, so a new one shifts every index: keep the pick by its id.
    const again = selectedId ? g.nodes.findIndex((x) => x.id === selectedId) : -1;
    this.selected = again >= 0 ? again : null;
    this.dirty = true;
  }

  /** The picked note's index (after a reload it may have moved). */
  selectedIndex(): number | null { return this.selected; }

  /** Highlights the notes a search matches (null: no search). */
  setMatch(match: Uint8Array | null): void { this.match = match; this.dirty = true; }

  select(i: number | null, focus = true): void {
    this.selected = i;
    if (i !== null && focus) this.focus(i);
    this.dirty = true;
  }

  /** Turns the sphere so a note faces him. */
  focus(i: number): void {
    const p = this.target;
    const x = p[i * 3], y = p[i * 3 + 1], z = p[i * 3 + 2];
    if (!x && !y && !z) return;
    const yaw = Math.atan2(-x, z);
    const z1 = -x * Math.sin(yaw) + z * Math.cos(yaw);
    const pitch = Math.max(-1.1, Math.min(1.1, Math.atan2(y, z1)));
    let dy = yaw - this.yaw;
    dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    this.focusTo = { yaw: this.yaw + dy, pitch, from: { yaw: this.yaw, pitch: this.pitch }, t0: performance.now() };
    this.yawVel = 0;
    this.dirty = true;
  }

  /** Notes Ultron just wrote: they flare, and send thoughts down their links. */
  pulse(ids: string[]): void {
    if (!this.graph) return;
    const t = performance.now();
    ids.forEach((id) => {
      const i = this.graph!.nodes.findIndex((n) => n.id === id);
      if (i < 0) return;
      this.pulses.set(i, t);
      this.recent[i] = 1;
      if (!this.reduced) this.graph!.links.forEach(([a, b], e) => { if (a === i || b === i) this.thoughts.push({ e, t: 0, speed: 0.9, forward: a === i }); });
    });
    this.dirty = true;
  }

  /* ── loop ── */

  startLoop(): void {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    const tick = (t: number) => {
      if (!this.running) return;
      this.raf = requestAnimationFrame(tick);
      if (document.hidden) return;
      const dt = Math.min(0.05, (t - this.last) / 1000);
      this.last = t;
      if (this.reduced && !this.dirty && !this.focusTo) return;
      this.dirty = false;
      this.step(t, dt);
      this.draw(t);
    };
    this.raf = requestAnimationFrame(tick);
  }

  stopLoop(): void { this.running = false; cancelAnimationFrame(this.raf); }

  destroy(): void {
    this.stopLoop();
    this.resizeObs.disconnect();
    this.canvas.removeEventListener('pointerdown', this.down);
    this.canvas.removeEventListener('pointermove', this.move);
    this.canvas.removeEventListener('pointerup', this.up);
    this.canvas.removeEventListener('pointerleave', this.leave);
    this.canvas.removeEventListener('wheel', this.wheel);
    this.canvas.removeEventListener('dblclick', this.dbl);
  }

  private resize(): void {
    const r = this.canvas.getBoundingClientRect();
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.w = Math.max(1, r.width);
    this.h = Math.max(1, r.height);
    this.canvas.width = Math.round(this.w * this.dpr);
    this.canvas.height = Math.round(this.h * this.dpr);
    this.dirty = true;
  }

  private step(t: number, dt: number): void {
    if (this.focusTo) {
      const k = ease((t - this.focusTo.t0) / 900);
      this.yaw = this.focusTo.from.yaw + (this.focusTo.yaw - this.focusTo.from.yaw) * k;
      this.pitch = this.focusTo.from.pitch + (this.focusTo.pitch - this.focusTo.from.pitch) * k;
      if (k >= 1) this.focusTo = null;
    } else if (!this.dragging) {
      if (Math.abs(this.yawVel) > 0.0005) { this.yaw += this.yawVel; this.yawVel *= 0.94; }
      else if (!this.reduced) this.yaw += dt * (this.hover !== null ? 0.012 : this.selected !== null ? 0.025 : 0.075);
    }
    if (this.reduced || !this.graph) return;
    // New thoughts: about a dozen a second, mostly from notes written lately.
    const L = this.graph.links;
    if (L.length) {
      const want = 9 + Math.min(14, L.length / 25);
      let n = Math.floor(want * dt + Math.random());
      while (n-- > 0 && this.thoughts.length < 70) {
        let e = Math.floor(Math.random() * L.length);
        for (let k = 0; k < 3; k++) {
          const c = Math.floor(Math.random() * L.length);
          if (this.recent[L[c][0]] + this.recent[L[c][1]] > this.recent[L[e][0]] + this.recent[L[e][1]]) e = c;
        }
        this.thoughts.push({ e, t: 0, speed: 0.55 + Math.random() * 0.6, forward: Math.random() < 0.5 });
      }
    }
    for (const th of this.thoughts) th.t += dt * th.speed;
    this.thoughts = this.thoughts.filter((th) => th.t < 1);
  }

  /** Model space -> screen: rotate by yaw then pitch, then perspective. */
  private project(x: number, y: number, z: number, out: number[]): void {
    const cy = Math.cos(this.yaw), syw = Math.sin(this.yaw);
    const x1 = x * cy + z * syw;
    const z1 = -x * syw + z * cy;
    const cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
    const y2 = y * cp - z1 * sp;
    const z2 = y * sp + z1 * cp;
    const f = CAM / (CAM - z2);
    const R = this.radius();
    out[0] = this.cx() + x1 * R * f;
    out[1] = this.h * 0.5 - y2 * R * f;
    out[2] = z2;
    out[3] = f;
  }

  /** The panel covers the right-hand side on a wide canvas, so the sphere centres in what's left. */
  private cx(): number { return this.w > 760 ? (this.w - 290) / 2 : this.w / 2; }
  private radius(): number { return Math.min(this.w > 760 ? this.w - 290 : this.w, this.h) * 0.335 * this.zoom; }

  private glow(col: string): HTMLCanvasElement {
    let s = this.sprite.get(col);
    if (s) return s;
    s = document.createElement('canvas');
    s.width = s.height = 64;
    const g = s.getContext('2d')!;
    const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grd.addColorStop(0, col);
    grd.addColorStop(0.25, col);
    grd.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grd;
    g.globalAlpha = 0.9;
    g.fillRect(0, 0, 64, 64);
    this.sprite.set(col, s);
    return s;
  }

  private draw(t: number): void {
    const c = this.ctx;
    const g = this.graph;
    c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    c.clearRect(0, 0, this.w, this.h);
    const P = [0, 0, 0, 0];
    const age = this.reduced ? 99 : (t - this.born) / 1000;
    const R = this.radius();
    const t0 = performance.now();
    this.project(0, 0, 0, P);
    const cx = P[0], cyy = P[1];

    c.globalCompositeOperation = 'lighter';

    // The core: Ultron's own light, breathing.
    const breathe = this.reduced ? 0.8 : 0.72 + Math.sin(t / 900) * 0.12;
    const core = c.createRadialGradient(cx, cyy, 0, cx, cyy, R * 0.55);
    core.addColorStop(0, `rgba(210,250,255,${0.55 * breathe * ease(age / 0.8)})`);
    core.addColorStop(0.18, `rgba(0,217,255,${0.25 * breathe})`);
    core.addColorStop(1, 'rgba(0,40,60,0)');
    c.fillStyle = core;
    c.fillRect(cx - R, cyy - R, R * 2, R * 2);

    // Rings: segmented, turning, drawn in as the mind assembles (one stroke per ring and depth band).
    const ringIn = ease((age - 0.2) / 1.4);
    for (const ring of this.rings) {
      const turn = (this.reduced ? 0 : t / 1000) * ring.speed + ring.phase;
      const segs = Math.floor(ring.segs * ringIn);
      const bands: Path2D[] = [new Path2D(), new Path2D(), new Path2D()];
      const cX = Math.cos(ring.tiltX), sX = Math.sin(ring.tiltX), cZ = Math.cos(ring.tiltZ), sZ = Math.sin(ring.tiltZ);
      for (let k2 = 0; k2 < segs; k2++) {
        if (hash01(`${ring.phase}:${k2}`) > ring.fill + 0.25) continue;
        const a0 = (k2 / ring.segs) * Math.PI * 2 + turn;
        const a1 = a0 + (Math.PI * 2 / ring.segs) * (0.35 + hash01(`${ring.phase}w${k2}`) * 0.5);
        const pts: number[] = [];
        let depth = 0;
        for (let k = 0; k <= 3; k++) {
          const a = a0 + ((a1 - a0) * k) / 3;
          const x = Math.cos(a) * ring.r, z = Math.sin(a) * ring.r;
          const y1 = -z * sX, z1 = z * cX;
          this.project(x * cZ - y1 * sZ, x * sZ + y1 * cZ, z1, P);
          depth += P[2];
          pts.push(P[0], P[1]);
        }
        const band = bands[depth / 4 < -0.5 ? 0 : depth / 4 < 0.4 ? 1 : 2];
        band.moveTo(pts[0], pts[1]);
        for (let k = 2; k < pts.length; k += 2) band.lineTo(pts[k], pts[k + 1]);
      }
      c.lineWidth = ring.r > 1.4 ? 1 : 1.6;
      [0.06, 0.16, 0.4].forEach((al, bi) => { c.strokeStyle = `rgba(0,217,255,${al})`; c.stroke(bands[bi]); });
    }

    // Strips of light along the shells - the body of the sphere, like the reference's data shell.
    const stripIn = ease((age - 0.4) / 1.6);
    if (stripIn > 0) {
      const bands: Path2D[] = [new Path2D(), new Path2D(), new Path2D()];
      const spin = this.reduced ? 0 : t / 1000;
      const st = this.strips;
      for (let i = 0; i < STRIPS; i++) {
        const y = st[i * 5], lon0 = st[i * 5 + 1] + spin * 0.05 * st[i * 5 + 4], span = st[i * 5 + 2] * stripIn, r = st[i * 5 + 3];
        const ringR = Math.sqrt(1 - y * y) * r;
        let depth = 0;
        const pts: number[] = [];
        for (let k = 0; k <= 2; k++) {
          const a = lon0 + (span * k) / 2;
          this.project(Math.cos(a) * ringR, y * r, Math.sin(a) * ringR, P);
          depth += P[2];
          pts.push(P[0], P[1]);
        }
        const band = bands[depth / 3 < -0.35 ? 0 : depth / 3 < 0.35 ? 1 : 2];
        band.moveTo(pts[0], pts[1]); band.lineTo(pts[2], pts[3]); band.lineTo(pts[4], pts[5]);
      }
      c.lineWidth = 1.6;
      [0.07, 0.2, 0.46].forEach((al, bi) => { c.strokeStyle = `rgba(40,225,255,${al * stripIn})`; c.stroke(bands[bi]); });
      // The sphere's edge catches the light.
      const edge = c.createRadialGradient(cx, cyy, R * 0.86, cx, cyy, R * 1.12);
      edge.addColorStop(0, 'rgba(0,217,255,0)');
      edge.addColorStop(0.55, `rgba(0,217,255,${0.09 * stripIn})`);
      edge.addColorStop(1, 'rgba(0,217,255,0)');
      c.fillStyle = edge;
      c.beginPath(); c.arc(cx, cyy, R * 1.12, 0, Math.PI * 2); c.fill();
    }

    // The swirl round the core: three bright arcs turning fast, like a mind thinking.
    if (age > 0.3) {
      const sw = this.reduced ? 0 : t / 1000;
      const arcs: [number, number, number, number][] = [[0.24, 0.9, 1.1, 0], [0.31, -0.7, 0.4, 2], [0.19, 1.3, -0.8, 4]];
      for (const [r, speed, tilt, ph] of arcs) {
        c.beginPath();
        for (let k = 0; k <= 24; k++) {
          const a = sw * speed + ph + (k / 24) * Math.PI * 1.1;
          const x = Math.cos(a) * r, z = Math.sin(a) * r;
          this.project(x, -z * Math.sin(tilt), z * Math.cos(tilt), P);
          if (k === 0) c.moveTo(P[0], P[1]); else c.lineTo(P[0], P[1]);
        }
        c.strokeStyle = `rgba(170,245,255,${0.5 * ease((age - 0.3) / 1)})`;
        c.lineWidth = 2;
        c.stroke();
      }
    }

    // The halo of drifting streaks (two depth bands, one stroke each).
    {
      const bands: Path2D[] = [new Path2D(), new Path2D()];
      const d = this.dust;
      for (let i = 0; i < 160; i++) {
        const spin = (this.reduced ? 0 : t / 1000) * 0.05 * d[i * 4 + 3];
        const x = d[i * 4], y = d[i * 4 + 1], z = d[i * 4 + 2];
        const ca = Math.cos(spin), sa = Math.sin(spin);
        this.project(x * ca - z * sa, y, x * sa + z * ca, P);
        const x0 = P[0], y0 = P[1], dep = P[2];
        const cb = Math.cos(spin + 0.05), sb = Math.sin(spin + 0.05);
        this.project(x * cb - z * sb, y, x * sb + z * cb, P);
        const band = bands[dep < 0 ? 0 : 1];
        band.moveTo(x0, y0); band.lineTo(P[0], P[1]);
      }
      const k = ease((age - 0.6) / 1.2);
      c.lineWidth = 1;
      c.strokeStyle = `rgba(120,230,255,${0.08 * k})`; c.stroke(bands[0]);
      c.strokeStyle = `rgba(120,230,255,${0.26 * k})`; c.stroke(bands[1]);
    }

    if (!g || !g.nodes.length) {
      c.globalCompositeOperation = 'source-over';
      this.frameMs = this.frameMs * 0.9 + (performance.now() - t0) * 0.1;
      return;
    }
    const n = g.nodes.length;

    // Where every note is this frame (flying in, at first).
    for (let i = 0; i < n; i++) {
      const k = ease((age - this.delay[i]) / 1.25);
      this.alive[i] = k;
      const x = this.start[i * 3] + (this.target[i * 3] - this.start[i * 3]) * k;
      const y = this.start[i * 3 + 1] + (this.target[i * 3 + 1] - this.start[i * 3 + 1]) * k;
      const z = this.start[i * 3 + 2] + (this.target[i * 3 + 2] - this.start[i * 3 + 2]) * k;
      this.project(x, y, z, P);
      this.sx[i] = P[0]; this.sy[i] = P[1]; this.sz[i] = P[2]; this.sf[i] = P[3];
    }

    const focus = this.selected ?? this.hover;
    const near = new Set<number>(focus !== null ? [focus, ...this.neighbours[focus]] : []);
    const dimOf = (i: number) => (this.match ? (this.match[i] ? 1 : 0.18) : focus !== null && this.selected !== null ? (near.has(i) ? 1 : 0.35) : 1);

    // Links: faint arcs bowed toward the core, in three depth bands (one stroke each).
    const linksIn = ease((age - 1.0) / 1.0);
    if (linksIn > 0) {
      const bands: [number, number][][] = [[], [], []];
      const lit: [number, number][] = [];
      for (const [a, b] of g.links) {
        if (focus !== null && (a === focus || b === focus)) { lit.push([a, b]); continue; }
        const d = (this.sz[a] + this.sz[b]) / 2;
        bands[d < -0.4 ? 0 : d < 0.4 ? 1 : 2].push([a, b]);
      }
      const arc = (a: number, b: number) => {
        // the control point: the midpoint pulled most of the way toward the centre
        const mx = (this.sx[a] + this.sx[b]) / 2, my = (this.sy[a] + this.sy[b]) / 2;
        c.moveTo(this.sx[a], this.sy[a]);
        c.quadraticCurveTo(mx + (cx - mx) * 0.38, my + (cyy - my) * 0.38, this.sx[b], this.sy[b]);
      };
      const faded = this.match || (this.selected !== null) ? 0.45 : 1;
      [0.03, 0.065, 0.11].forEach((alpha, bi) => {
        c.beginPath();
        for (const [a, b] of bands[bi]) arc(a, b);
        c.strokeStyle = `rgba(0,217,255,${alpha * linksIn * faded})`;
        c.lineWidth = 1;
        c.stroke();
      });
      if (lit.length) {
        c.beginPath();
        for (const [a, b] of lit) arc(a, b);
        c.strokeStyle = `rgba(160,245,255,${0.75 * linksIn})`;
        c.lineWidth = 1.4;
        c.stroke();
      }

      // Thoughts running along the links.
      for (const th of this.thoughts) {
        const [a0, b0] = g.links[th.e];
        const a = th.forward ? a0 : b0, b = th.forward ? b0 : a0;
        const at = (u: number) => {
          const mx = (this.sx[a] + this.sx[b]) / 2, my = (this.sy[a] + this.sy[b]) / 2;
          const qx = mx + (cx - mx) * 0.38, qy = my + (cyy - my) * 0.38;
          const v = 1 - u;
          return [v * v * this.sx[a] + 2 * v * u * qx + u * u * this.sx[b], v * v * this.sy[a] + 2 * v * u * qy + u * u * this.sy[b]];
        };
        const [hx, hy] = at(th.t);
        const [mx2, my2] = at(Math.max(0, th.t - 0.07));
        const [tx, ty] = at(Math.max(0, th.t - 0.16));
        const fade = Math.sin(th.t * Math.PI) * linksIn;
        // A comet: a fading tail along the arc and a bright head.
        const grad = c.createLinearGradient(tx, ty, hx, hy);
        grad.addColorStop(0, 'rgba(120,235,255,0)');
        grad.addColorStop(1, `rgba(200,250,255,${0.7 * fade})`);
        c.strokeStyle = grad;
        c.lineWidth = 1.8;
        c.beginPath(); c.moveTo(tx, ty); c.quadraticCurveTo(mx2, my2, hx, hy); c.stroke();
        c.globalAlpha = 0.9 * fade;
        c.drawImage(this.glow('#d8fbff'), hx - 7, hy - 7, 14, 14);
        c.globalAlpha = 1;
      }
    }

    // The scanner: a meridian sweeping round the sphere.
    const scan = this.reduced ? -10 : ((t / 1000) * 0.55) % (Math.PI * 2);

    // Notes: a soft glow plus a crisp fragment, like a panel of data.
    for (let i = 0; i < n; i++) {
      const life = this.alive[i];
      if (life <= 0.01) continue;
      const node = g.nodes[i];
      const front = (this.sz[i] + SHELL_RADIUS.hq) / (2 * SHELL_RADIUS.hq);
      let d = this.lon[i] - scan;
      d = Math.abs(Math.atan2(Math.sin(d), Math.cos(d)));
      const swept = node.shell === 'core' ? 0 : Math.max(0, 1 - d / 0.22) * 0.7;
      const pulse = this.pulses.has(i) ? Math.max(0, 1 - (t - this.pulses.get(i)!) / 2500) : 0;
      const fresh = this.reduced ? this.recent[i] * 0.6 : this.recent[i] * (0.55 + 0.45 * Math.sin(t / 420 + i));
      const isFocus = i === focus;
      const bright = Math.min(1.6, (0.22 + 0.78 * front * front) * (0.75 + fresh * 0.6 + swept + pulse * 1.5 + (isFocus ? 1.2 : near.has(i) ? 0.5 : 0))) * dimOf(i) * life;
      const col = this.color[i];
      const sz = node.shell === 'core' ? 9 : (1.6 + Math.min(4.5, Math.log10(node.size + 10) * 1.1) + Math.min(3, this.degree[i] * 0.25)) * this.sf[i] * (0.8 + this.zoom * 0.2);
      c.globalAlpha = Math.min(1, bright * 0.55);
      c.drawImage(this.glow(col), this.sx[i] - sz * 2.6, this.sy[i] - sz * 2.6, sz * 5.2, sz * 5.2);
      c.globalAlpha = Math.min(1, bright);
      c.fillStyle = col;
      const fw = node.shell === 'core' ? sz : sz * (1.5 + hash01(node.id) * 1.1);
      const fh = node.shell === 'core' ? sz : Math.max(1.4, sz * 0.5);
      if (node.shell === 'core') {
        c.fillRect(this.sx[i] - fw / 2, this.sy[i] - fh / 2, fw, fh);
      } else {
        // Lie along the sphere: the angle of the latitude line through this point, on screen.
        const x = this.target[i * 3], y = this.target[i * 3 + 1], z = this.target[i * 3 + 2];
        this.project(x * 0.9998 - z * 0.02, y, x * 0.02 + z * 0.9998, P);
        const ang = Math.atan2(P[1] - this.sy[i], P[0] - this.sx[i]);
        const ca = Math.cos(ang) * this.dpr, sa = Math.sin(ang) * this.dpr;
        c.setTransform(ca, sa, -sa, ca, this.sx[i] * this.dpr, this.sy[i] * this.dpr);
        c.fillRect(-fw / 2, -fh / 2, fw, fh);
        c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      }
      if (pulse > 0) {
        c.globalAlpha = pulse * 0.8;
        c.strokeStyle = col;
        c.lineWidth = 1.2;
        c.beginPath(); c.arc(this.sx[i], this.sy[i], sz + (1 - pulse) * 26, 0, Math.PI * 2); c.stroke();
      }
    }
    c.globalAlpha = 1;
    c.globalCompositeOperation = 'source-over';

    // Labels: what's hovered or picked, its neighbours, the search hits, and a few of the most-linked notes.
    const labels: number[] = [];
    if (focus !== null) labels.push(focus, ...this.neighbours[focus].slice(0, 7));
    if (this.match) for (let i = 0; i < n && labels.length < 10; i++) if (this.match[i] && this.sz[i] > -0.2) labels.push(i);
    if (focus === null && !this.match && age > 2.4) {
      const topical = (i: number) => /^(Memory|Brains|Profile|School|Health|History|Projects|Research)/.test(g.nodes[i].group);
      const top = [...Array(n).keys()].filter((i) => this.sz[i] > 0.45 && topical(i)).sort((a, b) => this.degree[b] - this.degree[a]).slice(0, 5);
      labels.push(...top);
    }
    c.font = '10.5px "Share Tech Mono", monospace';
    c.textBaseline = 'middle';
    const drawn: [number, number][] = [];
    for (const i of [...new Set(labels)]) {
      const text = g.nodes[i].title.length > 34 ? `${g.nodes[i].title.slice(0, 33)}...` : g.nodes[i].title;
      const x = this.sx[i] + 9, y = this.sy[i] - 9;
      if (drawn.some(([dx, dy]) => Math.abs(dx - x) < 90 && Math.abs(dy - y) < 13)) continue;
      drawn.push([x, y]);
      const wdt = c.measureText(text).width;
      const strong = i === focus;
      c.globalAlpha = strong ? 1 : 0.8;
      c.fillStyle = 'rgba(2,10,16,0.78)';
      c.fillRect(x - 3, y - 7, wdt + 6, 14);
      c.fillStyle = strong ? '#e9fbff' : this.color[i];
      c.fillText(text, x, y + 0.5);
      c.strokeStyle = strong ? '#9ff7ff' : 'rgba(0,217,255,0.35)';
      c.beginPath(); c.moveTo(this.sx[i], this.sy[i]); c.lineTo(x - 3, y + 7); c.stroke();
    }
    c.globalAlpha = 1;
    this.frameMs = this.frameMs * 0.9 + (performance.now() - t0) * 0.1;
    this.canvas.dataset.ms = this.frameMs.toFixed(2);
  }

  /* ── input ── */

  /** The note under the pointer, preferring the ones in front. */
  pick(x: number, y: number): number | null {
    if (!this.graph) return null;
    let best: number | null = null;
    let bestD = 11 * 11;
    for (let i = 0; i < this.graph.nodes.length; i++) {
      if (this.alive[i] < 0.5 || this.sz[i] < -0.35) continue;
      const dx = this.sx[i] - x, dy = this.sy[i] - y;
      const d = dx * dx + dy * dy - this.sz[i] * 20;
      if (d < bestD) { bestD = d; best = i; }
    }
    return best;
  }

  private local(e: PointerEvent | WheelEvent | MouseEvent): [number, number] {
    const r = this.canvas.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  }

  private down = (e: PointerEvent) => {
    const [x, y] = this.local(e);
    this.dragging = { x, y, moved: 0, lastX: x, lastY: y };
    this.focusTo = null;
    this.canvas.setPointerCapture(e.pointerId);
  };

  private move = (e: PointerEvent) => {
    const [x, y] = this.local(e);
    if (this.dragging) {
      const dx = x - this.dragging.lastX, dy = y - this.dragging.lastY;
      this.dragging.moved += Math.abs(dx) + Math.abs(dy);
      this.dragging.lastX = x; this.dragging.lastY = y;
      this.yaw += dx * 0.006;
      this.yawVel = dx * 0.006;
      this.pitch = Math.max(-1.2, Math.min(1.2, this.pitch + dy * 0.006));
      this.dirty = true;
      return;
    }
    const i = this.pick(x, y);
    if (i !== this.hover) { this.hover = i; this.dirty = true; }
    this.canvas.style.cursor = i !== null ? 'pointer' : 'grab';
    this.ev.onHover(i, i !== null ? this.sx[i] : x, i !== null ? this.sy[i] : y);
  };

  private up = (e: PointerEvent) => {
    const d = this.dragging;
    this.dragging = null;
    try { this.canvas.releasePointerCapture(e.pointerId); } catch { /* not captured */ }
    if (d && d.moved < 5) {
      const [x, y] = this.local(e);
      const i = this.pick(x, y);
      this.selected = i;
      this.ev.onSelect(i);
      this.dirty = true;
    }
  };

  private leave = () => {
    if (this.hover !== null) { this.hover = null; this.dirty = true; }
    this.ev.onHover(null, 0, 0);
  };

  private wheel = (e: WheelEvent) => {
    e.preventDefault();
    this.zoom = Math.max(0.6, Math.min(2.4, this.zoom * Math.exp(-e.deltaY * 0.0012)));
    this.dirty = true;
  };

  private dbl = (e: MouseEvent) => {
    const [x, y] = this.local(e);
    const i = this.pick(x, y);
    if (i !== null) this.focus(i);
  };
}
