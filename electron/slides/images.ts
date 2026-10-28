import type { Picture } from './design';

/*
 * Pictures for slides: an address given by the agent is used as it is; words become a search of
 * Wikimedia Commons - free, no key, openly licensed - for a good-sized photo or painting. The
 * maker and licence go into the slide's speaker notes. Google Slides fetches the picture itself,
 * so it must be a public address (Commons' are).
 */

const UA = 'Ultron/2.0 (personal study assistant; https://commons.wikimedia.org/wiki/Commons:API)';

/**
 * Commons' answer, cut down to a usable picture: a photo or painting, big enough, not a map, logo or
 * sketch - and, among the good ones, the one whose shape best fits the space it will fill (`aspect`
 * is width / height). Photos (JPEG) come before drawings (PNG). Pure, for tests.
 */
export function pickCommons(json: unknown, aspect?: number): Picture | null {
  const pages = Object.values((json as { query?: { pages?: Record<string, unknown> } })?.query?.pages ?? {}) as {
    title?: string; index?: number;
    imageinfo?: { thumburl?: string; url?: string; width?: number; height?: number; thumbwidth?: number; thumbheight?: number; mime?: string; extmetadata?: Record<string, { value?: string }> }[];
  }[];
  const strip = (s?: string) => (s ?? '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
  const ok = pages
    .map((p) => ({ p, ii: p.imageinfo?.[0] }))
    .filter(({ p, ii }) => ii && /image\/(jpeg|png)/.test(ii.mime ?? '') && (ii.width ?? 0) >= 640 && (ii.height ?? 0) >= 360
      && !/\b(map|logo|flag|coat of arms|icon|diagram|chart|seal|svg|drawing|sketch|cartoon|clipart|line art)\b/i.test(p.title ?? ''));
  // Search rank matters most (pictures fill their space whatever their shape); a photo counts for a few places, shape a little.
  const score = ({ p, ii }: (typeof ok)[number]) => {
    const fit = aspect && ii?.width && ii.height ? Math.abs(Math.log((ii.width / ii.height) / aspect)) : 0;
    return (p.index ?? 99) + (ii?.mime === 'image/jpeg' ? 0 : 3) + fit * 1.5;
  };
  const hit = ok.sort((a, b) => score(a) - score(b))[0];
  if (!hit?.ii) return null;
  const ii = hit.ii;
  const meta = ii.extmetadata ?? {};
  const who = strip(meta.Artist?.value).slice(0, 80);
  const licence = strip(meta.LicenseShortName?.value);
  const name = (hit.p.title ?? '').replace(/^File:/, '').replace(/\.[a-z]+$/i, '');
  return {
    url: ii.thumburl ?? ii.url ?? '',
    width: ii.thumbwidth ?? ii.width ?? 1600,
    height: ii.thumbheight ?? ii.height ?? 900,
    credit: [name, who && `by ${who}`, licence, 'Wikimedia Commons'].filter(Boolean).join(', '),
  };
}

/** A picture for some words, or null. */
export async function findPicture(words: string, aspect?: number, signal?: AbortSignal): Promise<Picture | null> {
  const q = new URLSearchParams({
    action: 'query', format: 'json', generator: 'search', gsrnamespace: '6', gsrlimit: '15',
    // Photos unless he asked for a drawing, painting or map.
    gsrsearch: `${words}${/\b(drawing|sketch|illustration|painting|map)s?\b/i.test(words) ? '' : ' -drawing -sketch -illustration'} filetype:bitmap`,
    prop: 'imageinfo', iiprop: 'url|size|mime|extmetadata', iiurlwidth: '1600', origin: '*',
  });
  try {
    const res = await fetch(`https://commons.wikimedia.org/w/api.php?${q}`, { headers: { 'User-Agent': UA }, signal: signal ?? AbortSignal.timeout(15_000) });
    if (!res.ok) return null;
    return pickCommons(await res.json(), aspect);
  } catch {
    return null;
  }
}

/** A picture for a slide: a given address as it is (its shape looked up when possible), or a search. */
export async function pictureFor(image: string, aspect?: number, signal?: AbortSignal): Promise<Picture | null> {
  const v = image.trim();
  if (!v) return null;
  if (/^https:\/\//i.test(v)) return { url: v, width: 1600, height: 900 };
  return findPicture(v, aspect, signal);
}
