import type { DepartmentId } from '../brain/types';
import { decodeEntities, htmlText } from '../docs';

/*
 * Helios' free pulls: public news feeds (RSS/Atom) per department, and Wikipedia's "on this
 * day" for History. No keys, no AI, nothing about the operator is sent - just a GET with
 * Ultron's name as the user agent. Each item is a title, a link, a date and a short summary.
 */

export interface FeedItem { title: string; link: string; at: number | null; summary: string; source: string }
export interface FeedDef { id: string; dept: DepartmentId; label: string; url: string }

/** Starting feeds, each checked to answer (10 Oct 2026). Standing requests add focus on top. */
export const DEFAULT_FEEDS: FeedDef[] = [
  { id: 'cbc-soccer', dept: 'health', label: 'CBC Sports - soccer', url: 'https://www.cbc.ca/webfeed/rss/rss-sports-soccer' },
  { id: 'bbc-football', dept: 'health', label: 'BBC Sport - football', url: 'https://feeds.bbci.co.uk/sport/football/rss.xml' },
  { id: 'espn-soccer', dept: 'health', label: 'ESPN - soccer', url: 'https://www.espn.com/espn/rss/soccer/news' },
  { id: 'sciencedaily', dept: 'school', label: 'ScienceDaily', url: 'https://www.sciencedaily.com/rss/top/science.xml' },
  { id: 'cbc-canada', dept: 'school', label: 'CBC News - Canada', url: 'https://www.cbc.ca/webfeed/rss/rss-canada' },
  { id: 'ign', dept: 'media', label: 'IGN', url: 'https://feeds.feedburner.com/ign/games-all' },
  { id: 'pcgamer', dept: 'media', label: 'PC Gamer', url: 'https://www.pcgamer.com/rss/' },
  { id: 'smithsonian-history', dept: 'history', label: 'Smithsonian - history', url: 'https://www.smithsonianmag.com/rss/history/' },
  { id: 'hn', dept: 'projects', label: 'Hacker News', url: 'https://hnrss.org/frontpage' },
];

const tag = (block: string, name: string): string => {
  const m = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, 'i').exec(block);
  if (!m) return '';
  return m[1].replace(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/, '$1').trim();
};

/** RSS <item>s or Atom <entry>s, as plain items. Pure. */
export function parseFeed(xml: string, source: string): FeedItem[] {
  const blocks = xml.match(/<item\b[\s\S]*?<\/item>/gi) ?? xml.match(/<entry\b[\s\S]*?<\/entry>/gi) ?? [];
  const out: FeedItem[] = [];
  for (const b of blocks.slice(0, 60)) {
    const title = decodeEntities(tag(b, 'title').replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim();
    if (!title) continue;
    const link = decodeEntities(tag(b, 'link') || /<link[^>]*href="([^"]+)"/i.exec(b)?.[1] || tag(b, 'guid')).trim();
    const when = tag(b, 'pubDate') || tag(b, 'published') || tag(b, 'updated') || tag(b, 'dc:date');
    const t = when ? Date.parse(when) : NaN;
    const raw = tag(b, 'description') || tag(b, 'summary') || tag(b, 'content');
    const summary = htmlText(decodeEntities(raw)).replace(/\s+/g, ' ').slice(0, 400);
    out.push({ title: title.slice(0, 220), link: /^https?:\/\//.test(link) ? link : '', at: Number.isFinite(t) ? t : null, summary, source });
  }
  return out;
}

const UA = 'Ultron/2.0 (personal assistant; feed reader)';

export async function fetchFeed(def: Pick<FeedDef, 'url' | 'label'>): Promise<FeedItem[]> {
  const res = await fetch(def.url, { headers: { 'User-Agent': UA, Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml' }, signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`${def.label} answered ${res.status}`);
  const text = await res.text();
  return parseFeed(text.slice(0, 2_000_000), def.label);
}

/** Wikipedia's "on this day" events (History's daily story), newest years first. */
export async function onThisDay(now = new Date()): Promise<FeedItem[]> {
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  const res = await fetch(`https://api.wikimedia.org/feed/v1/wikipedia/en/onthisday/events/${mm}/${dd}`, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`Wikipedia answered ${res.status}`);
  const body = (await res.json()) as { events?: { text: string; year: number; pages?: { content_urls?: { desktop?: { page?: string } } }[] }[] };
  return (body.events ?? []).slice(0, 80).map((e) => ({
    title: `${e.year}: ${e.text}`.slice(0, 220),
    link: e.pages?.[0]?.content_urls?.desktop?.page ?? '',
    at: now.getTime(),
    summary: '',
    source: 'Wikipedia - on this day',
  }));
}
