import { connectedApps, findActions, runAction } from '../composio';
import type { LaidDeck } from './design';
import { dig, requestsFor } from './requests';

/*
 * A laid-out deck (design.ts) as a real Google Slides presentation in his own Google account,
 * through the Google Slides app (or "Google - all apps") he connected in Apps. Each shape becomes
 * a Slides API request; text is set in the theme's fonts (Google Fonts, built into Slides).
 * requestsFor is pure, for tests; buildInGoogle does the calls.
 */

/* ── the calls ───────────────────────────────────────────────────────── */

interface Acts { app: string; create: { slug: string; titleKey: string }; batch: { slug: string; idKey: string; reqKey: string }; get: { slug: string; idKey: string } }
let acts: Acts | null = null;

/** The Google Slides app's real action names and parameter names, looked up once. */
async function actions(): Promise<Acts> {
  if (acts) return acts;
  const apps = (await connectedApps()).map((a) => a.slug);
  const app = apps.includes('googleslides') ? 'googleslides' : apps.includes('googlesuper') ? 'googlesuper' : null;
  if (!app) throw new Error('Google Slides is not connected. In Apps, connect "Google Slides" (or "Google - all apps") - you sign in with Google yourself.');
  const P = app.toUpperCase();
  const find = async (q: string, re: RegExp) => {
    try { return (await findActions(q, app, 8)).actions.find((a) => re.test(a.slug)) ?? null; } catch { return null; }
  };
  const key = (a: { params: Record<string, string> } | null, re: RegExp, fallback: string) => Object.keys(a?.params ?? {}).find((k) => re.test(k)) ?? fallback;
  const c = await find('create a new Google Slides presentation', /CREATE.*PRESENTATION|PRESENTATIONS_CREATE/);
  const b = await find('batch update a Google Slides presentation', /BATCH_UPDATE/);
  const g = await find('get a Google Slides presentation', /PRESENTATIONS_GET|GET_PRESENTATION|PRESENTATION_GET/);
  acts = {
    app,
    create: { slug: c?.slug ?? `${P}_PRESENTATIONS_CREATE`, titleKey: key(c, /title/i, 'title') },
    batch: { slug: b?.slug ?? `${P}_PRESENTATIONS_BATCH_UPDATE`, idKey: key(b, /presentation_?id/i, 'presentationId'), reqKey: key(b, /requests?/i, 'requests') },
    get: { slug: g?.slug ?? `${P}_PRESENTATIONS_GET`, idKey: key(g, /presentation_?id/i, 'presentationId') },
  };
  return acts;
}

export function resetSlidesActions(): void { acts = null; }

/** Sends requests in parts. Returns how many pictures had to be left out. */
async function batch(a: Acts, id: string, requests: Record<string, unknown>[]): Promise<number> {
  let dropped = 0;
  // The Slides API takes big batches, but a huge one is slower to fail cleanly - send it in parts.
  for (let i = 0; i < requests.length; i += 400) {
    let part = requests.slice(i, i + 400);
    let r = await runAction(a.batch.slug, { [a.batch.idKey]: id, [a.batch.reqKey]: part });
    // A part is all-or-nothing: if Google couldn't fetch a picture, nothing in it was applied - send it again without pictures.
    if (!r.ok && /image|retriev|url/i.test(r.error ?? '') && part.some((q) => 'createImage' in q)) {
      const before = part.length;
      part = part.filter((q) => !('createImage' in q));
      dropped += before - part.length;
      r = await runAction(a.batch.slug, { [a.batch.idKey]: id, [a.batch.reqKey]: part });
    }
    if (!r.ok) throw new Error(`Google Slides refused part of the deck: ${(r.error ?? '').slice(0, 240)}`);
  }
  return dropped;
}

/** Builds the deck in his Google account; returns its link. */
export async function buildInGoogle(deck: LaidDeck): Promise<{ id: string; url: string; picturesDropped: number }> {
  const a = await actions();
  const made = await runAction(a.create.slug, { [a.create.titleKey]: deck.title });
  if (!made.ok) throw new Error(`Google Slides wouldn't create the presentation: ${(made.error ?? '').slice(0, 200)}`);
  const id = String(dig(made.data, 'presentationId') ?? dig(made.data, 'presentation_id') ?? dig(made.data, 'id') ?? '');
  if (!id) throw new Error('Google Slides made the presentation but didn\'t say which one it was.');

  // A new presentation comes with one slide of its own - it goes once ours are in.
  const before = await runAction(a.get.slug, { [a.get.idKey]: id });
  const starter = (dig(before.data, 'slides') as { objectId?: string }[] | undefined)?.map((s) => s.objectId).filter(Boolean) ?? [];
  const picturesDropped = await batch(a, id, requestsFor(deck));
  if (starter.length) await batch(a, id, starter.map((objectId) => ({ deleteObject: { objectId } })));

  // Speaker notes: each slide's notes box only exists once the slide does.
  const withNotes = deck.slides.map((s, i) => ({ i, notes: s.notes })).filter((x) => x.notes);
  if (withNotes.length) {
    const after = await runAction(a.get.slug, { [a.get.idKey]: id });
    const slides = (dig(after.data, 'slides') as { objectId?: string; slideProperties?: { notesPage?: { notesProperties?: { speakerNotesObjectId?: string } } } }[] | undefined) ?? [];
    const reqs = withNotes.flatMap(({ i, notes }) => {
      const s = slides.find((x) => x.objectId === `ult_s${i}`);
      const box = s?.slideProperties?.notesPage?.notesProperties?.speakerNotesObjectId;
      return box ? [{ insertText: { objectId: box, insertionIndex: 0, text: notes } }] : [];
    });
    if (reqs.length) await batch(a, id, reqs).catch(() => undefined); // notes are a nice-to-have - the deck is already made
  }
  return { id, url: `https://docs.google.com/presentation/d/${id}/edit`, picturesDropped };
}
