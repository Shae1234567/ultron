import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';

/** Real autonomous web browsing (search, navigate, click, type, screenshot) for the
 *  "Scout" browser agent and the orchestrator - not just opening a link in the OS
 *  browser. One headless Chromium instance is kept alive and reused across calls
 *  so multi-step tasks (search -> open -> click -> read) share the same page state. */

let browser: Browser | null = null;
let context: BrowserContext | null = null;
let page: Page | null = null;

async function getPage(): Promise<Page> {
  if (page && !page.isClosed()) return page;
  if (!browser) {
    try {
      browser = await chromium.launch({ headless: true });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      if (message.includes("Executable doesn't exist")) {
        throw new Error('Playwright browsers are not installed. Run: npx playwright install');
      }
      throw e;
    }
  }
  if (!context) {
    context = await browser.newContext();
  }
  page = await context.newPage();
  return page;
}

export interface WebSearchResult {
  title: string;
  url: string;
  snippet: string;
}

export async function webSearch(query: string, limit = 8): Promise<{ ok: boolean; results: WebSearchResult[]; error?: string }> {
  try {
    const p = await getPage();
    const url = `https://duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
    await p.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });

    const results = await p.evaluate((max) => {
      const out: { title: string; url: string; snippet: string }[] = [];
      const titleEls = Array.from(document.querySelectorAll('.result__title a'));
      const snippetEls = Array.from(document.querySelectorAll('.result__snippet'));
      for (let i = 0; i < titleEls.length && out.length < max; i++) {
        const a = titleEls[i] as HTMLAnchorElement | undefined;
        if (!a) continue;
        const href = a.getAttribute('href') || '';
        const title = (a.textContent || '').trim();
        if (!href || !title) continue;
        const snippet = (snippetEls[i]?.textContent || '').trim();
        out.push({ title, url: href, snippet });
      }
      return out;
    }, limit);

    return { ok: true, results };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return { ok: false, results: [], error: message };
  }
}

export async function openPage(url: string): Promise<{ ok: boolean; title?: string; text?: string; url?: string; error?: string }> {
  try {
    if (!/^https?:\/\//i.test(url)) {
      return { ok: false, error: 'Only http(s) URLs can be opened.' };
    }
    const p = await getPage();
    await p.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });
    const title = await p.title();
    const text = (await p.evaluate(() => document.body.innerText)).slice(0, 6000);
    return { ok: true, title, text, url: p.url() };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return { ok: false, error: message };
  }
}

export interface YouTubeResult { title: string; url: string; channel: string; duration?: string }

/** Dedicated YouTube search - DDG's general results rarely surface real watch
 *  links cleanly, so this scrapes YouTube's own results page directly instead. */
export async function youtubeSearch(query: string, limit = 8): Promise<{ ok: boolean; results: YouTubeResult[]; error?: string }> {
  try {
    const p = await getPage();
    const url = `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;
    await p.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });
    // Give the results grid a moment to hydrate - it's client-rendered.
    await p.waitForSelector('a#video-title, a.yt-lockup-metadata-view-model-wiz__title', { timeout: 8000 }).catch(() => {});

    const results = await p.evaluate((max) => {
      const out: { title: string; url: string; channel: string; duration?: string }[] = [];
      const seen = new Set<string>();
      const links = Array.from(
        document.querySelectorAll('a#video-title, a.yt-lockup-metadata-view-model-wiz__title'),
      );
      for (const el of links) {
        if (out.length >= max) break;
        const a = el as HTMLAnchorElement;
        const href = a.getAttribute('href') || '';
        if (!href.startsWith('/watch')) continue;
        const url = 'https://www.youtube.com' + href;
        if (seen.has(url)) continue;
        seen.add(url);
        const title = (a.getAttribute('title') || a.textContent || '').trim();
        if (!title) continue;
        const container = a.closest('ytd-video-renderer, ytd-compact-video-renderer, yt-lockup-view-model');
        const channel = (container?.querySelector('ytd-channel-name a, ytd-channel-name #text, .yt-content-metadata-view-model-wiz__metadata-text')?.textContent || '').trim();
        out.push({ title, url, channel });
      }
      return out;
    }, limit);

    return { ok: true, results };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return { ok: false, results: [], error: message };
  }
}

export async function clickOnPage(selector: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const p = await getPage();
    await p.click(selector, { timeout: 10000 });
    return { ok: true };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return { ok: false, error: message };
  }
}

export async function typeOnPage(selector: string, text: string, submit = false): Promise<{ ok: boolean; error?: string }> {
  try {
    const p = await getPage();
    await p.fill(selector, '', { timeout: 10000 });
    await p.fill(selector, text, { timeout: 10000 });
    if (submit) await p.press(selector, 'Enter');
    return { ok: true };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return { ok: false, error: message };
  }
}

export async function screenshotPage(): Promise<{ ok: boolean; dataUrl?: string; error?: string }> {
  try {
    const p = await getPage();
    const buffer = await p.screenshot({ type: 'png' });
    return { ok: true, dataUrl: `data:image/png;base64,${buffer.toString('base64')}` };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return { ok: false, error: message };
  }
}

export async function closeBrowser(): Promise<void> {
  try {
    await page?.close();
  } catch {
    /* already closed */
  }
  try {
    await context?.close();
  } catch {
    /* already closed */
  }
  try {
    await browser?.close();
  } catch {
    /* already closed */
  }
  page = null;
  context = null;
  browser = null;
}
