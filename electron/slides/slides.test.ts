import { describe, expect, it, vi } from 'vitest';

const runAction = vi.fn();
const findActions = vi.fn(async () => ({ actions: [] as { slug: string; params: Record<string, string> }[] }));
vi.mock('../composio', () => ({ connectedApps: async () => [{ slug: 'googleslides' }], findActions, runAction }));

const { contain, cover, fitSize, layoutDeck, PAGE, textHeight, themeFor, THEMES } = await import('./design');
const { requestsFor, rgb, dig } = await import('./requests');
const { deckHtml } = await import('./preview');
const { pickCommons } = await import('./images');
const { buildInGoogle, resetSlidesActions } = await import('./google');

const pic = { url: 'https://upload.wikimedia.org/a.jpg', width: 1600, height: 1000, credit: 'A photo, CC0' };
const every = {
  title: 'Biodiversity', subtitle: 'Sections 2A-2C', slides: [
    { type: 'title' as const, title: 'Biodiversity', subtitle: 'Grade 9', kicker: 'Unit B', image: 'forest' },
    { type: 'section' as const, title: 'What it means' },
    { type: 'bullets' as const, title: 'Three levels', bullets: ['Genetic', 'Species', 'Ecosystem'], image: 'reef' },
    { type: 'two_column' as const, title: 'Native vs invasive', left_heading: 'Native', left_bullets: ['a', 'b'], right_heading: 'Invasive', right_bullets: ['c'] },
    { type: 'image' as const, title: 'A food web', image: 'web', caption: 'Pull one strand...' },
    { type: 'quote' as const, quote: 'We conserve what we love.', by: 'Baba Dioum' },
    { type: 'stats' as const, title: 'Numbers', stats: [{ value: '8.7M', label: 'species' }, { value: '86%', label: 'undescribed' }] },
    { type: 'timeline' as const, title: 'After a fire', events: [{ when: 'Year 0', what: 'Fire' }, { when: 'Year 5', what: 'Shrubs' }] },
    { type: 'closing' as const, title: 'Takeaways', bullets: ['Three levels'], notes: 'Recap.' },
  ],
};

describe('the slide designer', () => {
  it('sizes text to fit its box - long text gets smaller, never below the minimum', () => {
    const short = fitSize('Biodiversity', 300, 60, 46, 20);
    const long = fitSize('A very long title that goes on and on about the many levels of biodiversity in Alberta', 300, 60, 46, 20);
    expect(short).toBe(46);
    expect(long).toBeLessThan(short);
    expect(long).toBeGreaterThanOrEqual(20);
    expect(textHeight('one line', 600, 20)).toBeCloseTo(24.4, 1);
  });

  it('fits pictures without stretching: inside a box, or covering it', () => {
    const inside = contain({ width: 1600, height: 900 }, { x: 0, y: 0, w: 400, h: 400 });
    expect(inside.w / inside.h).toBeCloseTo(1600 / 900, 3);
    expect(inside.w).toBeLessThanOrEqual(400);
    const over = cover({ width: 1000, height: 2000 }, { x: 470, y: 0, w: 250, h: 405 }, 'left');
    expect(over.x).toBe(470);
    expect(over.w).toBeGreaterThanOrEqual(250);
    expect(over.h).toBeGreaterThanOrEqual(405);
    expect(over.w / over.h).toBeCloseTo(0.5, 3);
  });

  it('picks a theme to suit the topic', () => {
    expect(themeFor('The Mongol Empire').id).toBe('royal');
    expect(themeFor('Biodiversity in Alberta').id).toBe('forest');
    expect(themeFor('My soccer season').id).toBe('ember');
    expect(themeFor('Something else').id).toBe('midnight');
  });

  it('lays out every kind of slide, with all words inside the page', () => {
    for (const theme of Object.keys(THEMES)) {
      const deck = layoutDeck({ ...every, theme }, new Map([[0, pic], [2, pic], [4, pic]]));
      expect(deck.slides).toHaveLength(9);
      for (const s of deck.slides) {
        for (const e of s.els) {
          if (e.kind !== 'text') continue;
          expect(e.x).toBeGreaterThanOrEqual(0);
          expect(e.y).toBeGreaterThanOrEqual(0);
          expect(e.x + e.w).toBeLessThanOrEqual(PAGE.w + 0.01);
          expect(e.y + e.h).toBeLessThanOrEqual(PAGE.h + 0.01);
          expect(e.size).toBeGreaterThanOrEqual(9);
        }
      }
    }
  });

  it('numbers the content slides, credits the pictures in the notes', () => {
    const deck = layoutDeck(every, new Map([[0, pic]]));
    const numbers = deck.slides.flatMap((s) => s.els.filter((e) => e.kind === 'text' && /^\d\d \/ \d\d$/.test(e.text)).map((e) => (e as { text: string }).text));
    expect(numbers).toEqual(['01 / 06', '02 / 06', '03 / 06', '04 / 06', '05 / 06', '06 / 06']);
    expect(deck.slides[0].notes).toMatch(/Image: A photo, CC0/);
    expect(deck.slides[8].notes).toBe('Recap.');
  });
});

describe('Google Slides requests', () => {
  const reqs = requestsFor(layoutDeck(every, new Map([[0, pic], [2, pic]])));
  it('every object id follows Google\'s rules (5-50 characters, letters, digits, _ - :) and is used once', () => {
    const created = reqs.flatMap((r) => (r.createSlide || r.createShape || r.createImage ? [(Object.values(r)[0] as { objectId: string }).objectId] : []));
    expect(created.length).toBeGreaterThan(50);
    for (const id of created) expect(id).toMatch(/^[a-zA-Z0-9_][a-zA-Z0-9_\-:]{4,49}$/);
    expect(new Set(created).size).toBe(created.length);
  });
  it('makes one blank slide per slide, in order, and puts pictures in', () => {
    const slides = reqs.filter((r) => r.createSlide).map((r) => (r.createSlide as { insertionIndex: number }).insertionIndex);
    expect(slides).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
    expect(reqs.filter((r) => r.createImage)).toHaveLength(2);
  });
  it('colours convert to Google\'s 0-1 form', () => {
    expect(rgb('#FF8000')).toEqual({ red: 1, green: 128 / 255, blue: 0 });
  });
  it('finds a value wherever Composio wrapped it', () => {
    expect(dig({ data: { response_data: '{"presentationId":"abc123"}' } }, 'presentationId')).toBe('abc123');
  });
});

describe('the offline slideshow', () => {
  it('is one self-contained page with every slide and the theme\'s fonts', () => {
    const html = deckHtml(layoutDeck(every, new Map([[0, pic]])));
    expect((html.match(/<section class="s"/g) ?? []).length).toBe(9);
    expect(html).toMatch(/fonts\.googleapis\.com\/css2\?family=Raleway/);
    expect(html).not.toMatch(/<script[^>]*src=/);
  });
});

describe('free pictures', () => {
  const page = (index: number, title: string, mime: string, w: number, h: number) => ({ index, title, imageinfo: [{ thumburl: `https://up/${index}`, width: w, height: h, thumbwidth: w, thumbheight: h, mime, extmetadata: { Artist: { value: '<a>Jane</a>' }, LicenseShortName: { value: 'CC BY-SA 4.0' } } }] });
  it('takes the best-ranked real photo, skipping small ones, maps and sketches', () => {
    const json = { query: { pages: { a: page(1, 'File:Map of reefs.png', 'image/png', 2000, 1500), b: page(2, 'File:Reef sketch.jpg', 'image/jpeg', 2000, 1500), c: page(3, 'File:Tiny reef.jpg', 'image/jpeg', 300, 200), d: page(4, 'File:Coral reef.jpg', 'image/jpeg', 1600, 1000) } } };
    const p = pickCommons(json, 1.5);
    expect(p?.url).toBe('https://up/4');
    expect(p?.credit).toBe('Coral reef, by Jane, CC BY-SA 4.0, Wikimedia Commons');
  });
  it('has nothing to offer when nothing fits', () => {
    expect(pickCommons({ query: { pages: {} } })).toBeNull();
  });
});

describe('building in Google', () => {
  it('creates the deck, swaps the starter slide for ours, adds speaker notes, and gives the link', async () => {
    resetSlidesActions();
    const calls: { slug: string; args: Record<string, unknown> }[] = [];
    let gets = 0;
    runAction.mockImplementation(async (slug: string, args: Record<string, unknown>) => {
      calls.push({ slug, args });
      if (slug.endsWith('_CREATE')) return { ok: true, data: { presentationId: 'deck123' } };
      if (slug.endsWith('_GET')) {
        gets++;
        return { ok: true, data: { slides: gets === 1 ? [{ objectId: 'p' }] : [{ objectId: 'ult_s8', slideProperties: { notesPage: { notesProperties: { speakerNotesObjectId: 'notes8' } } } }] } };
      }
      return { ok: true, data: {} };
    });
    const r = await buildInGoogle(layoutDeck(every));
    expect(r).toEqual({ id: 'deck123', url: 'https://docs.google.com/presentation/d/deck123/edit', picturesDropped: 0 });
    const batches = calls.filter((c) => c.slug.endsWith('BATCH_UPDATE')).map((c) => c.args.requests as Record<string, unknown>[]);
    expect(batches[0].some((q) => 'createSlide' in q)).toBe(true);
    expect(batches.some((b) => b.some((q) => JSON.stringify(q) === JSON.stringify({ deleteObject: { objectId: 'p' } })))).toBe(true);
    expect(batches.some((b) => b.some((q) => (q.insertText as { objectId?: string } | undefined)?.objectId === 'notes8'))).toBe(true);
  });

  it('a picture Google cannot fetch is left out instead of losing the deck', async () => {
    resetSlidesActions();
    let tries = 0;
    runAction.mockImplementation(async (slug: string, args: Record<string, unknown>) => {
      if (slug.endsWith('_CREATE')) return { ok: true, data: { presentationId: 'd2' } };
      if (slug.endsWith('_GET')) return { ok: true, data: { slides: [] } };
      const reqs = args.requests as Record<string, unknown>[];
      if (reqs.some((q) => 'createImage' in q)) { tries++; return { ok: false, error: 'Invalid requests[5].createImage: There was a problem retrieving the image.' }; }
      return { ok: true, data: {} };
    });
    const r = await buildInGoogle(layoutDeck(every, new Map([[0, pic]])));
    expect(tries).toBe(1);
    expect(r.picturesDropped).toBe(1);
  });
});
