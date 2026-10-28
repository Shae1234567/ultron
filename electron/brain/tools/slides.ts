import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';
import { layoutDeck, PICTURE_ASPECT, THEMES, type DeckSpec, type Picture, type SlideSpec } from '../../slides/design';
import { deckHtml } from '../../slides/preview';
import { pictureFor } from '../../slides/images';
import { buildInGoogle } from '../../slides/google';
import { A, S, obj, str, type AgentTool } from './types';

/*
 * Beautiful Google Slides (12 Oct 2026). The agent writes the content; slides/design.ts lays it out
 * in a consistent design (themes, fonts, sizes that fit); slides/google.ts builds it in his Google
 * account after he says yes. An offline copy - a slideshow that opens in any browser - is always
 * saved too, so a deck is never lost to a missing connection.
 */

const TYPES: SlideSpec['type'][] = ['title', 'section', 'bullets', 'two_column', 'image', 'quote', 'stats', 'timeline', 'closing'];

/** What the agent sent, made safe: known slide types only, text where text belongs. Pure, for tests. */
export function cleanSpec(args: Record<string, unknown>): DeckSpec | { error: string } {
  const title = str(args, 'title').trim();
  const raw = Array.isArray(args.slides) ? args.slides : [];
  if (!title) return { error: 'A deck needs a title.' };
  if (!raw.length) return { error: 'A deck needs at least one slide.' };
  const text = (v: unknown) => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : undefined);
  const texts = (v: unknown) => (Array.isArray(v) ? v.map(text).filter((x): x is string => Boolean(x && x.trim())) : undefined);
  const slides: SlideSpec[] = raw.slice(0, 40).map((r) => {
    const o = (r && typeof r === 'object' ? r : {}) as Record<string, unknown>;
    const type = TYPES.includes(o.type as SlideSpec['type']) ? o.type as SlideSpec['type'] : 'bullets';
    return {
      type,
      title: text(o.title), subtitle: text(o.subtitle), kicker: text(o.kicker),
      bullets: texts(o.bullets), left_heading: text(o.left_heading), left_bullets: texts(o.left_bullets),
      right_heading: text(o.right_heading), right_bullets: texts(o.right_bullets),
      image: text(o.image), caption: text(o.caption), quote: text(o.quote), by: text(o.by), notes: text(o.notes),
      stats: Array.isArray(o.stats) ? o.stats.map((x) => ({ value: text((x as Record<string, unknown>)?.value) ?? '', label: text((x as Record<string, unknown>)?.label) ?? '' })) : undefined,
      events: Array.isArray(o.events) ? o.events.map((x) => ({ when: text((x as Record<string, unknown>)?.when) ?? '', what: text((x as Record<string, unknown>)?.what) ?? '' })) : undefined,
    };
  });
  // A deck opens with a title slide - add one if the agent forgot.
  if (slides[0].type !== 'title') slides.unshift({ type: 'title', title, subtitle: str(args, 'subtitle') || undefined });
  const theme = str(args, 'theme').toLowerCase();
  return { title, subtitle: str(args, 'subtitle') || undefined, theme: THEMES[theme] ? theme : undefined, slides };
}

const safeFile = (s: string) => s.replace(/[<>:"/\\|?*\x00-\x1f]/g, '').replace(/\s+/g, ' ').trim().slice(0, 80) || 'Deck';

export const slidesTools: AgentTool[] = [
  {
    name: 'slides_make',
    owner: 'hermes',
    writes: true,
    description: [
      'Make a beautiful Google Slides presentation in his Google account (asks him first), plus an offline copy on his PC. You write the content; the design (theme, fonts, layout, sizes) is done for you.',
      'Slide types: title (title, subtitle, kicker, image) - section (title, kicker) - bullets (title, bullets, optional image shown beside them) - two_column (title, left_heading, left_bullets, right_heading, right_bullets) - image (title, image, caption) - quote (quote, by) - stats (title, stats: [{value, label}] up to 4) - timeline (title, events: [{when, what}] up to 5) - closing (title, bullets as takeaways).',
      'Good decks: one idea per slide, 3-5 bullets of under 12 words, a section slide between parts, a stats or timeline slide where numbers or dates matter, a closing slide. Speaker notes (notes) hold the detail.',
      'image: a few words to find a free photo (Wikimedia Commons, credited in the notes) or an https address. Themes: midnight, ultron, paper, ember, forest, royal, ocean, mono - or leave it and one is picked to suit the topic.',
      'Use real content: read his course material or sources first. Never a deck to hand in as his own work.',
    ].join(' '),
    parameters: obj({
      title: S('The deck\'s title'),
      subtitle: S('A subtitle (optional)'),
      theme: S('midnight, ultron, paper, ember, forest, royal, ocean or mono (optional)', { enum: Object.keys(THEMES) }),
      slides: A('The slides, in order', obj({
        type: S('title, section, bullets, two_column, image, quote, stats, timeline or closing', { enum: TYPES }),
        title: S('Slide title'), subtitle: S('Subtitle'), kicker: S('Small label above a title'),
        bullets: A('Short points'), left_heading: S('Left column heading'), left_bullets: A('Left column points'),
        right_heading: S('Right column heading'), right_bullets: A('Right column points'),
        image: S('Words to find a photo, or an https address'), caption: S('Picture caption'),
        quote: S('A quotation'), by: S('Who said it'),
        stats: A('Big numbers', obj({ value: S('e.g. 8.7M'), label: S('what it counts') })),
        events: A('Timeline points', obj({ when: S('date or step'), what: S('what happened') })),
        notes: S('Speaker notes'),
      }, ['type'])),
    }, ['title', 'slides']),
    label: (a) => `make slides: ${str(a, 'title').slice(0, 50)}`,
    run: async (args, ctx) => {
      const spec = cleanSpec(args);
      if ('error' in spec) return spec;
      ctx.progress('finding pictures');
      const pics = new Map<number, Picture>();
      await Promise.all(spec.slides.map(async (s, i) => {
        if (!s.image || !['title', 'bullets', 'image'].includes(s.type)) return;
        const p = await pictureFor(s.image, PICTURE_ASPECT[s.type], ctx.signal).catch(() => null);
        if (p) pics.set(i, p);
      }));
      const deck = layoutDeck(spec, pics);

      // The offline copy, always.
      // (A test build can point this elsewhere, so checks never write into his real Documents.)
      const dir = !app.isPackaged && process.env.ULTRON_SLIDES_DIR ? process.env.ULTRON_SLIDES_DIR : path.join(app.getPath('documents'), 'Ultron Slides');
      fs.mkdirSync(dir, { recursive: true });
      const file = path.join(dir, `${safeFile(deck.title)}.html`);
      fs.writeFileSync(file, deckHtml(deck), 'utf8');
      const base = { slides: deck.slides.length, theme: deck.theme.label, pictures: pics.size, offline_copy: file };

      const ok = await ctx.approve('slides', `Make "${deck.title}" in Google Slides?`, `${deck.slides.length} slides, ${deck.theme.label} theme, in your own Google account (private to you).`);
      if (!ok) return { ...base, google: 'not made - he said no (or did not answer). The offline copy is saved.' };
      ctx.progress('building in Google Slides');
      try {
        const g = await buildInGoogle(deck);
        return { ...base, link: g.url, note: g.picturesDropped ? `${g.picturesDropped} picture(s) Google could not fetch were left out.` : undefined };
      } catch (e) {
        return { ...base, google: `not made: ${e instanceof Error ? e.message : String(e)}`, note: 'The offline copy is saved - it opens in any browser (arrow keys to move, F for full screen).' };
      }
    },
  },
];
