/*
 * What every agent that researches gets - the shared team's researchers, every department
 * agent and Helios. A leaf module (no imports), so department agent files can use it
 * without pulling in the whole team.
 */

/** How anyone with a browser - Argus or a helper - should research: like a person, on sites it picks itself. */
export const BROWSING_RULES = [
  'You have your own real web browser. Browse like a person: search, open the promising results, scroll, click into threads and comments, compare several sources - never stop at the first results page.',
  'Work fast: read_webpage opens and reads a page in ONE step (mode "page" for front pages, feeds, rankings and listings - it includes the real links). Use browser_open and clicks only when you must interact with the page.',
  'Pick the sites yourself for the topic. For what is trending, viral or popular right now, go where it is happening - for example Google Trends (trends.google.com/trending?geo=CA), Reddit (reddit.com/r/popular, or a subreddit\'s /top/?t=day), YouTube (search, sorted by upload date or views), TikTok (tiktok.com/discover, tiktok.com/tag/NAME), X trends (trends24.in), Know Your Meme, Hacker News, GitHub Trending, Product Hunt and news sites - then follow whatever leads you find.',
  'Move between pages by clicking the numbered links, or by opening addresses you actually saw on a page or in search results. Never type an address you guessed - a made-up ID opens the wrong page.',
  'Social and video pages are visual: browser_look reads views, likes, thumbnails and charts that text misses; browser_scroll loads more of a feed; browser_read with mode "page" gets whole threads and comment sections.',
  'If a page is a login wall, CAPTCHA or bot check, do not try to get around it - use what is visible or another source. On cookie banners pick the most private option (reject / necessary only).',
  'Always report the URLs you actually visited, with dates and numbers where you saw them. Never invent a URL, statistic or quote.',
];

/**
 * Ultron's research power, for every department agent: search and read the web, read
 * videos and feeds, browse, work things out in code, look things up in the skills library
 * and in memory. A department adds its own tools on top.
 */
export const RESEARCH_KIT = [
  // Search and reading
  'google_search', 'web_search', 'read_webpage', 'read_link', 'deep_research', 'youtube_transcript', 'read_feed', 'encyclopedia_lookup',
  // Browsing (reading only - typing and building on sites stay Daedalus's)
  'browser_open', 'browser_click', 'browser_scroll', 'browser_back', 'browser_read', 'browser_find', 'browser_links', 'browser_look',
  // Working things out
  'run_code', 'calculate',
  // Skills and memory
  'skill_search', 'skill_read', 'memory_search', 'memory_read_note',
];

/** An agent's own tools on top of the kit, without repeats. */
export function withKit(own: string[]): string[] {
  return [...new Set([...RESEARCH_KIT, ...own])];
}
