/*
 * Ultron's slide designer (12 Oct 2026): a deck written as content (title slide, bullets, two
 * columns, a quote, big numbers, a timeline...) laid out by a small design system - themed colours
 * and font pairs, a fixed grid, an accent colour used sparingly, and text sized to fit its box. The
 * agent writes the words; this decides how they look, so every deck comes out consistent.
 *
 * The output is a list of plain shapes in points on a 16:9 page (720 x 405) - google.ts turns it
 * into Google Slides, preview.ts into an HTML preview. Pure, for tests.
 */

export const PAGE = { w: 720, h: 405 };
const M = 48; // margin

export interface Theme {
  id: string; label: string;
  bg: string; panel: string; text: string; muted: string; accent: string; accent2: string;
  head: string; body: string; dark: boolean;
}

export const THEMES: Record<string, Theme> = {
  midnight: { id: 'midnight', label: 'Midnight', bg: '#0F172A', panel: '#1E293B', text: '#F8FAFC', muted: '#94A3B8', accent: '#38BDF8', accent2: '#F472B6', head: 'Montserrat', body: 'Lato', dark: true },
  ultron: { id: 'ultron', label: 'Ultron', bg: '#04090E', panel: '#0B1C27', text: '#E6F7FF', muted: '#7FA3BA', accent: '#00D9FF', accent2: '#FF3B4E', head: 'Oswald', body: 'Roboto', dark: true },
  paper: { id: 'paper', label: 'Paper', bg: '#FAF7F2', panel: '#EFE7DA', text: '#1F2937', muted: '#6B7280', accent: '#C2410C', accent2: '#0F766E', head: 'Playfair Display', body: 'Lato', dark: false },
  ember: { id: 'ember', label: 'Ember', bg: '#1C1917', panel: '#2A2522', text: '#FAFAF9', muted: '#A8A29E', accent: '#F97316', accent2: '#FACC15', head: 'Poppins', body: 'Lato', dark: true },
  forest: { id: 'forest', label: 'Forest', bg: '#0B2A1C', panel: '#123D2A', text: '#ECFDF5', muted: '#9FD8BD', accent: '#34D399', accent2: '#FDE68A', head: 'Raleway', body: 'Open Sans', dark: true },
  royal: { id: 'royal', label: 'Royal', bg: '#1E1B4B', panel: '#2E2A6B', text: '#EEF2FF', muted: '#A5B4FC', accent: '#FBBF24', accent2: '#F472B6', head: 'Playfair Display', body: 'Raleway', dark: true },
  ocean: { id: 'ocean', label: 'Ocean', bg: '#F0F9FF', panel: '#DDEFFC', text: '#0C2D48', muted: '#4B6B85', accent: '#0284C7', accent2: '#F59E0B', head: 'Poppins', body: 'Open Sans', dark: false },
  mono: { id: 'mono', label: 'Mono', bg: '#FFFFFF', panel: '#F2F2F2', text: '#111111', muted: '#6B6B6B', accent: '#111111', accent2: '#E11D48', head: 'Montserrat', body: 'Roboto', dark: false },
};

/** A theme that suits the topic when none is asked for. Pure, for tests. */
export function themeFor(topic: string): Theme {
  const t = topic.toLowerCase();
  if (/empire|war|battle|history|histor|king|queen|dynasty|ancient|medieval|revolution|mongol|roman|ottoman|napoleon/.test(t)) return THEMES.royal;
  if (/biolog|ecosystem|biodivers|plant|animal|environment|climate|nature|forest|cell/.test(t)) return THEMES.forest;
  if (/ocean|water|physics|chemistry|science|space|planet|energy|math/.test(t)) return THEMES.ocean;
  if (/poem|novel|story|english|essay|art|music|literature/.test(t)) return THEMES.paper;
  if (/soccer|sport|game|fitness|training|basketball|badminton/.test(t)) return THEMES.ember;
  if (/ultron|ai|robot|tech|code|computer/.test(t)) return THEMES.ultron;
  return THEMES.midnight;
}

/* ── the content an agent writes ──────────────────────────────────────── */

export interface SlideSpec {
  type: 'title' | 'section' | 'bullets' | 'two_column' | 'image' | 'quote' | 'stats' | 'timeline' | 'closing';
  title?: string;
  subtitle?: string;
  kicker?: string;
  bullets?: string[];
  left_heading?: string; left_bullets?: string[];
  right_heading?: string; right_bullets?: string[];
  /** A picture: a web address, or words to find a free one for (Wikimedia Commons). */
  image?: string;
  caption?: string;
  quote?: string; by?: string;
  stats?: { value: string; label: string }[];
  events?: { when: string; what: string }[];
  notes?: string;
}
export interface DeckSpec { title: string; subtitle?: string; theme?: string; slides: SlideSpec[] }

/* ── what it becomes ──────────────────────────────────────────────────── */

export interface Box { x: number; y: number; w: number; h: number }
export type El =
  | (Box & { kind: 'rect'; fill: string; round?: boolean; ellipse?: boolean; /** 0-1, for tints over pictures */ alpha?: number })
  | (Box & { kind: 'text'; text: string; size: number; font: string; color: string; bold?: boolean; italic?: boolean; align?: 'left' | 'center' | 'right'; valign?: 'top' | 'middle' | 'bottom'; bullets?: boolean; spacing?: number; caps?: boolean })
  | (Box & { kind: 'image'; url: string });
export interface LaidSlide { bg: string; els: El[]; notes: string }
export interface LaidDeck { title: string; theme: Theme; slides: LaidSlide[] }

/** A picture found for a slide: its address and its shape (so it can be fitted), and who made it. */
export interface Picture { url: string; width: number; height: number; credit?: string }

/**
 * The largest font size (between min and max) at which the text fits the box - estimated from
 * average letter widths, which is close enough for these fonts. Pure, for tests.
 */
export function fitSize(text: string | string[], w: number, h: number, max: number, min: number, lineHeight = 1.22, widthFactor = 0.52): number {
  const paras = (Array.isArray(text) ? text : text.split('\n')).map((p) => p.trim()).filter(Boolean);
  for (let size = max; size > min; size -= 1) {
    const perLine = Math.max(1, Math.floor(w / (size * widthFactor)));
    const lines = paras.reduce((n, p) => n + Math.max(1, Math.ceil(p.length / perLine)), 0);
    const gaps = Array.isArray(text) ? (paras.length - 1) * size * 0.45 : 0;
    if (lines * size * lineHeight + gaps <= h) return size;
  }
  return min;
}

/** How tall text set at `size` comes out in a box `w` wide (same estimate as fitSize). Pure, for tests. */
export function textHeight(text: string | string[], w: number, size: number, lineHeight = 1.22, widthFactor = 0.52): number {
  const paras = (Array.isArray(text) ? text : text.split('\n')).map((p) => p.trim()).filter(Boolean);
  const perLine = Math.max(1, Math.floor(w / (size * widthFactor)));
  const lines = paras.reduce((n, p) => n + Math.max(1, Math.ceil(p.length / perLine)), 0);
  return lines * size * lineHeight + (Array.isArray(text) ? (paras.length - 1) * size * 0.45 : 0);
}

/** The shape (width / height) of the picture space on each kind of slide - pictures are picked to match. */
export const PICTURE_ASPECT: Partial<Record<SlideSpec['type'], number>> = { title: 0.86, bullets: 0.92, image: 2.3 };

/**
 * A picture filling a box completely without stretching - the extra runs past the box. Only ever used
 * on boxes that touch the page edge on every side it can spill over (slides clip at the page edge,
 * which is the crop - Google Slides can't crop pictures itself). `anchor` keeps one edge exact:
 * 'left' for a strip on the right of the page. Pure, for tests.
 */
export function cover(pic: { width: number; height: number }, box: Box, anchor: 'center' | 'left' = 'center'): Box {
  const s = Math.max(box.w / pic.width, box.h / pic.height);
  const w = pic.width * s;
  const h = pic.height * s;
  return { x: anchor === 'left' ? box.x : box.x + (box.w - w) / 2, y: box.y + (box.h - h) / 2, w, h };
}

/** A picture placed inside a box without stretching (centred). Pure, for tests. */
export function contain(pic: { width: number; height: number }, box: Box): Box {
  const s = Math.min(box.w / pic.width, box.h / pic.height);
  const w = pic.width * s;
  const h = pic.height * s;
  return { x: box.x + (box.w - w) / 2, y: box.y + (box.h - h) / 2, w, h };
}

const clean = (s?: string) => (s ?? '').replace(/\s+/g, ' ').trim();
const list = (a?: string[], max = 6) => (a ?? []).map(clean).filter(Boolean).slice(0, max);
const num = (n: number) => String(n).padStart(2, '0');

/** Lays a whole deck out. `pics` maps each slide's image (if found) by slide index. Pure, for tests. */
export function layoutDeck(spec: DeckSpec, pics: Map<number, Picture> = new Map()): LaidDeck {
  const theme = THEMES[spec.theme ?? ''] ?? themeFor(`${spec.title} ${spec.subtitle ?? ''}`);
  const T = theme;
  let section = 0;
  const contentCount = spec.slides.filter((s) => !['title', 'section', 'closing'].includes(s.type)).length;
  let content = 0;

  const slides = spec.slides.slice(0, 40).map((s, i): LaidSlide => {
    const els: El[] = [];
    const pic = pics.get(i);
    const notes = [clean(s.notes), pic?.credit ? `Image: ${pic.credit}` : ''].filter(Boolean).join('\n\n');
    const title = clean(s.title);
    const pageNo = (left = false) => {
      content++;
      els.push({ kind: 'text', x: left ? M : PAGE.w - M - 60, y: PAGE.h - 30, w: 60, h: 16, text: `${num(content)} / ${num(contentCount)}`, size: 9, font: T.body, color: T.muted, align: left ? 'left' : 'right' });
    };
    const heading = (y = 34, width = PAGE.w - 2 * M) => {
      const size = fitSize(title, width, 44, 28, 18);
      els.push({ kind: 'rect', x: M, y, w: 36, h: 4, fill: T.accent });
      els.push({ kind: 'text', x: M, y: y + 12, w: width, h: 44, text: title, size, font: T.head, color: T.text, bold: true, valign: 'top' });
      return y + 12 + 44 + 14;
    };

    switch (s.type) {
      case 'title': {
        const withPic = Boolean(pic);
        const textW = withPic ? 360 : PAGE.w - 2 * M - 40;
        if (pic) {
          // The picture fills the whole slide; a tint over it and a solid panel behind the words keep them readable.
          els.push({ kind: 'image', url: pic.url, ...cover(pic, { x: 0, y: 0, w: PAGE.w, h: PAGE.h }) });
          els.push({ kind: 'rect', x: 0, y: 0, w: PAGE.w, h: PAGE.h, fill: T.bg, alpha: 0.35 });
          els.push({ kind: 'rect', x: 0, y: 0, w: 440, h: PAGE.h, fill: T.bg, alpha: 0.86 });
        }
        els.push({ kind: 'rect', x: 0, y: 0, w: 10, h: PAGE.h, fill: T.accent });
        if (!pic) {
          els.push({ kind: 'rect', x: PAGE.w - 150, y: -60, w: 260, h: 260, fill: T.panel, ellipse: true });
          els.push({ kind: 'rect', x: PAGE.w - 95, y: 250, w: 120, h: 120, fill: T.accent2, ellipse: true });
        }
        // The block (kicker, title, bar, subtitle) sized to its real text and centred on the page.
        const kicker = clean(s.kicker);
        const tText = title || clean(spec.title);
        const tSize = fitSize(tText, textW, 150, 46, 26, 1.12);
        const tH = Math.min(150, textHeight(tText, textW, tSize, 1.12) + 6);
        const sub = clean(s.subtitle) || clean(spec.subtitle);
        const sSize = sub ? fitSize(sub, textW, 60, 18, 12) : 0;
        const sH = sub ? Math.min(60, textHeight(sub, textW, sSize) + 4) : 0;
        const block = (kicker ? 24 : 0) + tH + 18 + 3 + (sub ? 14 + sH : 0);
        let y = Math.max(40, (PAGE.h - block) / 2);
        if (kicker) { els.push({ kind: 'text', x: M + 10, y, w: textW, h: 18, text: kicker, size: 11, font: T.body, color: T.accent, bold: true, caps: true, spacing: 2 }); y += 24; }
        els.push({ kind: 'text', x: M + 10, y, w: textW, h: tH, text: tText, size: tSize, font: T.head, color: T.text, bold: true, valign: 'top' });
        y += tH + 18;
        els.push({ kind: 'rect', x: M + 10, y, w: 60, h: 3, fill: T.accent2 });
        y += 3 + 14;
        if (sub) els.push({ kind: 'text', x: M + 10, y, w: textW, h: sH, text: sub, size: sSize, font: T.body, color: T.muted, valign: 'top' });
        break;
      }
      case 'section': {
        section++;
        els.push({ kind: 'rect', x: 0, y: 0, w: PAGE.w, h: PAGE.h, fill: T.panel });
        // A quiet shape on the right, so the page isn't all on one side.
        els.push({ kind: 'rect', x: PAGE.w - 230, y: 70, w: 300, h: 300, fill: T.bg, ellipse: true });
        els.push({ kind: 'rect', x: PAGE.w - 120, y: 50, w: 46, h: 46, fill: T.accent, ellipse: true });
        els.push({ kind: 'text', x: M, y: 92, w: 200, h: 96, text: num(section), size: 80, font: T.head, color: T.accent, bold: true });
        els.push({ kind: 'rect', x: M, y: 196, w: 70, h: 4, fill: T.accent2 });
        els.push({ kind: 'text', x: M, y: 214, w: PAGE.w - 2 * M, h: 70, text: title, size: fitSize(title, PAGE.w - 2 * M, 70, 36, 20, 1.15), font: T.head, color: T.text, bold: true, valign: 'top' });
        const k = clean(s.kicker) || clean(s.subtitle);
        if (k) els.push({ kind: 'text', x: M, y: 292, w: PAGE.w - 2 * M, h: 40, text: k, size: 14, font: T.body, color: T.muted });
        break;
      }
      case 'bullets':
      case 'closing': {
        const items = list(s.bullets ?? [], s.type === 'closing' ? 5 : 6);
        if (s.type === 'closing') {
          els.push({ kind: 'rect', x: 0, y: 0, w: PAGE.w, h: 8, fill: T.accent });
          const size = fitSize(title, PAGE.w - 2 * M, 80, 38, 22, 1.15);
          els.push({ kind: 'text', x: M, y: 60, w: PAGE.w - 2 * M, h: 80, text: title, size, font: T.head, color: T.text, bold: true });
          items.forEach((it, k) => {
            const y = 160 + k * 42;
            els.push({ kind: 'rect', x: M, y: y + 4, w: 20, h: 20, fill: T.accent, round: true });
            els.push({ kind: 'text', x: M + 2, y: y + 3, w: 16, h: 20, text: '✓', size: 12, font: T.body, color: T.bg, bold: true, align: 'center', valign: 'middle' });
            els.push({ kind: 'text', x: M + 34, y, w: PAGE.w - 2 * M - 34, h: 30, text: it, size: fitSize(it, PAGE.w - 2 * M - 34, 30, 17, 11), font: T.body, color: T.text, valign: 'middle' });
          });
          break;
        }
        // With a picture: it fills a full-height strip on the right (bleeding off the page edges), the words take the rest.
        const STRIP = 470;
        if (pic) {
          els.push({ kind: 'image', url: pic.url, ...cover(pic, { x: STRIP, y: 0, w: PAGE.w - STRIP, h: PAGE.h }, 'left') });
          els.push({ kind: 'rect', x: STRIP, y: 0, w: 5, h: PAGE.h, fill: T.accent });
        }
        const textW = pic ? STRIP - M - 24 : PAGE.w - 2 * M;
        const top = heading(34, textW);
        const h = PAGE.h - top - 44;
        if (items.length) els.push({ kind: 'text', x: M, y: top, w: textW, h, text: items.join('\n'), size: fitSize(items, textW - 24, h, 20, 11, 1.3), font: T.body, color: T.text, bullets: true, valign: 'top' });
        pageNo(Boolean(pic));
        break;
      }
      case 'two_column': {
        const top = heading();
        const colW = (PAGE.w - 2 * M - 20) / 2;
        const maxH = PAGE.h - top - 44;
        const cols = [[s.left_heading, s.left_bullets], [s.right_heading, s.right_bullets]].map(([head, items]) => ({ hd: clean(head as string), its: list(items as string[], 5) }));
        // One text size for both columns (they read as a pair), and panels only as tall as they need.
        const size = Math.min(...cols.map((c) => fitSize(c.its.length ? c.its : [' '], colW - 60, maxH - 80, 15, 10, 1.3)));
        const h = Math.min(maxH, Math.max(150, 80 + Math.max(...cols.map((c) => textHeight(c.its.length ? c.its : [' '], colW - 60, size, 1.3))) + 22));
        cols.forEach(({ hd, its }, k) => {
          const x = M + k * (colW + 20);
          els.push({ kind: 'rect', x, y: top, w: colW, h, fill: T.panel, round: true });
          els.push({ kind: 'rect', x: x + 18, y: top + 18, w: 26, h: 4, fill: k ? T.accent2 : T.accent });
          els.push({ kind: 'text', x: x + 18, y: top + 28, w: colW - 36, h: 30, text: hd, size: fitSize(hd, colW - 36, 30, 18, 12), font: T.head, color: T.text, bold: true });
          if (its.length) els.push({ kind: 'text', x: x + 18, y: top + 64, w: colW - 36, h: h - 80, text: its.join('\n'), size, font: T.body, color: T.text, bullets: true });
        });
        pageNo();
        break;
      }
      case 'image': {
        const top = heading();
        const cap = clean(s.caption);
        const box = { x: M, y: top, w: PAGE.w - 2 * M, h: PAGE.h - top - (cap ? 64 : 40) };
        if (pic) els.push({ kind: 'image', url: pic.url, ...contain(pic, box) });
        else els.push({ kind: 'rect', ...box, fill: T.panel, round: true });
        if (cap) els.push({ kind: 'text', x: M, y: PAGE.h - 58, w: PAGE.w - 2 * M, h: 24, text: cap, size: fitSize(cap, PAGE.w - 2 * M, 24, 13, 9), font: T.body, color: T.muted, italic: true, align: 'center' });
        pageNo();
        break;
      }
      case 'quote': {
        const q = clean(s.quote) || title;
        els.push({ kind: 'rect', x: 0, y: 0, w: PAGE.w, h: PAGE.h, fill: T.panel });
        els.push({ kind: 'text', x: M, y: 30, w: 120, h: 110, text: '“', size: 120, font: T.head, color: T.accent, bold: true });
        els.push({ kind: 'text', x: M + 30, y: 110, w: PAGE.w - 2 * M - 60, h: 170, text: q, size: fitSize(q, PAGE.w - 2 * M - 60, 170, 32, 16, 1.25), font: T.head, color: T.text, italic: true, valign: 'middle' });
        const by = clean(s.by);
        if (by) {
          els.push({ kind: 'rect', x: M + 30, y: 300, w: 40, h: 3, fill: T.accent2 });
          els.push({ kind: 'text', x: M + 82, y: 290, w: 400, h: 24, text: by, size: 14, font: T.body, color: T.muted, valign: 'middle' });
        }
        pageNo();
        break;
      }
      case 'stats': {
        const top = heading();
        const st = (s.stats ?? []).filter((x) => clean(x?.value)).slice(0, 4);
        const n = Math.max(1, st.length);
        const gap = 16;
        const cw = (PAGE.w - 2 * M - gap * (n - 1)) / n;
        const ch = Math.min(170, PAGE.h - top - 60);
        // The cards sit in the middle of the space under the heading.
        const cy = top + Math.max(0, (PAGE.h - 40 - top - ch) / 2);
        st.forEach((x, k) => {
          const xx = M + k * (cw + gap);
          els.push({ kind: 'rect', x: xx, y: cy, w: cw, h: ch, fill: T.panel, round: true });
          els.push({ kind: 'rect', x: xx, y: cy, w: cw, h: 5, fill: k % 2 ? T.accent2 : T.accent });
          const v = clean(x.value);
          els.push({ kind: 'text', x: xx + 14, y: cy + 24, w: cw - 28, h: 60, text: v, size: fitSize(v, cw - 28, 60, 44, 18, 1.05, 0.6), font: T.head, color: k % 2 ? T.accent2 : T.accent, bold: true, align: 'center', valign: 'middle' });
          const l = clean(x.label);
          els.push({ kind: 'text', x: xx + 14, y: cy + 90, w: cw - 28, h: ch - 100, text: l, size: fitSize(l, cw - 28, ch - 100, 15, 10), font: T.body, color: T.muted, align: 'center', valign: 'top' });
        });
        pageNo();
        break;
      }
      case 'timeline': {
        const top = heading();
        const ev = (s.events ?? []).filter((e) => clean(e?.when) || clean(e?.what)).slice(0, 5);
        const n = Math.max(1, ev.length);
        // The line runs through the middle of the space under the heading.
        const lineY = top + Math.max(60, (PAGE.h - 40 - top) / 2 - 14);
        const step = (PAGE.w - 2 * M) / n;
        els.push({ kind: 'rect', x: M, y: lineY, w: PAGE.w - 2 * M, h: 3, fill: T.muted });
        ev.forEach((e, k) => {
          const cx = M + step * k + step / 2;
          els.push({ kind: 'rect', x: cx - 9, y: lineY - 8, w: 18, h: 18, fill: k % 2 ? T.accent2 : T.accent, ellipse: true });
          const when = clean(e.when);
          els.push({ kind: 'text', x: cx - step / 2 + 6, y: lineY - 50, w: step - 12, h: 34, text: when, size: fitSize(when, step - 12, 34, 18, 10), font: T.head, color: k % 2 ? T.accent2 : T.accent, bold: true, align: 'center', valign: 'bottom' });
          const what = clean(e.what);
          els.push({ kind: 'text', x: cx - step / 2 + 6, y: lineY + 24, w: step - 12, h: PAGE.h - lineY - 70, text: what, size: fitSize(what, step - 12, PAGE.h - lineY - 70, 14, 9), font: T.body, color: T.text, align: 'center', valign: 'top' });
        });
        pageNo();
        break;
      }
    }
    return { bg: T.bg, els, notes };
  });
  return { title: clean(spec.title) || 'Untitled deck', theme, slides };
}
