import type { El, LaidDeck } from './design';

/*
 * A laid-out deck (design.ts) as Google Slides API requests: one blank slide each, its background,
 * then its shapes - text in the theme's fonts (Google Fonts, built into Slides). Pure, for tests;
 * google.ts sends them.
 */

const pt = (v: number) => ({ magnitude: Math.round(v * 100) / 100, unit: 'PT' });

export function rgb(hex: string): { red: number; green: number; blue: number } {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
  return { red: ((n >> 16) & 255) / 255, green: ((n >> 8) & 255) / 255, blue: (n & 255) / 255 };
}

const place = (page: string, e: { x: number; y: number; w: number; h: number }) => ({
  pageObjectId: page,
  size: { width: pt(Math.max(1, e.w)), height: pt(Math.max(1, e.h)) },
  transform: { scaleX: 1, scaleY: 1, translateX: Math.round(e.x * 100) / 100, translateY: Math.round(e.y * 100) / 100, unit: 'PT' },
});

/** The Slides API requests that draw one slide's shapes. Pure, for tests. */
export function elementRequests(page: string, els: El[], idBase: string): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  els.forEach((e, k) => {
    const id = `${idBase}_${k}`;
    if (e.kind === 'rect') {
      out.push({ createShape: { objectId: id, shapeType: e.ellipse ? 'ELLIPSE' : e.round ? 'ROUND_RECTANGLE' : 'RECTANGLE', elementProperties: place(page, e) } });
      out.push({
        updateShapeProperties: {
          objectId: id,
          shapeProperties: { shapeBackgroundFill: { solidFill: { color: { rgbColor: rgb(e.fill) }, alpha: e.alpha ?? 1 } }, outline: { propertyState: 'NOT_RENDERED' } },
          fields: 'shapeBackgroundFill.solidFill.color,shapeBackgroundFill.solidFill.alpha,outline.propertyState',
        },
      });
    } else if (e.kind === 'image') {
      out.push({ createImage: { objectId: id, url: e.url, elementProperties: place(page, e) } });
    } else {
      const text = e.caps ? e.text.toUpperCase() : e.text;
      if (!text.trim()) return;
      out.push({ createShape: { objectId: id, shapeType: 'TEXT_BOX', elementProperties: place(page, e) } });
      out.push({ insertText: { objectId: id, insertionIndex: 0, text } });
      out.push({
        updateTextStyle: {
          objectId: id,
          textRange: { type: 'ALL' },
          style: { fontFamily: e.font, fontSize: pt(e.size), bold: Boolean(e.bold), italic: Boolean(e.italic), foregroundColor: { opaqueColor: { rgbColor: rgb(e.color) } } },
          fields: 'fontFamily,fontSize,bold,italic,foregroundColor',
        },
      });
      out.push({
        updateParagraphStyle: {
          objectId: id,
          textRange: { type: 'ALL' },
          style: { alignment: e.align === 'center' ? 'CENTER' : e.align === 'right' ? 'END' : 'START', lineSpacing: e.bullets ? 120 : 105, spaceBelow: pt(e.bullets ? e.size * 0.45 : 0) },
          fields: 'alignment,lineSpacing,spaceBelow',
        },
      });
      out.push({
        updateShapeProperties: {
          objectId: id,
          shapeProperties: { contentAlignment: e.valign === 'middle' ? 'MIDDLE' : e.valign === 'bottom' ? 'BOTTOM' : 'TOP' },
          fields: 'contentAlignment',
        },
      });
      if (e.bullets) out.push({ createParagraphBullets: { objectId: id, textRange: { type: 'ALL' }, bulletPreset: 'BULLET_DISC_CIRCLE_SQUARE' } });
    }
  });
  return out;
}

/** Every request for the deck: one blank slide each, its background, then its shapes. Pure, for tests. */
export function requestsFor(deck: LaidDeck): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  deck.slides.forEach((s, i) => {
    const page = `ult_s${i}`;
    out.push({ createSlide: { objectId: page, insertionIndex: i, slideLayoutReference: { predefinedLayout: 'BLANK' } } });
    out.push({
      updatePageProperties: {
        objectId: page,
        pageProperties: { pageBackgroundFill: { solidFill: { color: { rgbColor: rgb(s.bg) } } } },
        fields: 'pageBackgroundFill.solidFill.color',
      },
    });
    out.push(...elementRequests(page, s.els, `ult_s${i}e`));
  });
  return out;
}

/** Finds a value by key anywhere in an action's answer (Composio wraps answers differently). Pure, for tests. */
export function dig(data: unknown, key: string, depth = 0): unknown {
  if (depth > 6 || data == null) return undefined;
  if (typeof data === 'string') {
    const t = data.trim();
    if (!t.startsWith('{') && !t.startsWith('[')) return undefined;
    try { return dig(JSON.parse(t), key, depth + 1); } catch { return undefined; }
  }
  if (typeof data !== 'object') return undefined;
  const o = data as Record<string, unknown>;
  if (key in o) return o[key];
  for (const v of Object.values(o)) { const r = dig(v, key, depth + 1); if (r !== undefined) return r; }
  return undefined;
}
