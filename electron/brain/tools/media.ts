import { shell } from 'electron';
import { allGames, epicFreeGames, steamNews } from '../../media/library';
import { collected, load as loadPlay, on as trackerOn, playtime } from '../../media/tracker';
import { N, S, bool, num, obj, str, type AgentTool } from './types';

/*
 * The Media department's tools: his game library (installed, last played, playtime), the
 * playtime the tracker has seen this week, patch notes for his games, and Epic's free games.
 * Nothing is ever bought or claimed: a free game's page can be opened in his browser, and he
 * clicks Get himself.
 */

const hours = (min?: number) => (min === undefined ? undefined : `${Math.round((min / 60) * 10) / 10} h`);

export const mediaTools: AgentTool[] = [
  {
    name: 'media_games',
    owner: 'theseus',
    description: 'His game library on this PC (Steam and Epic): every installed game, when it was last played, total playtime, and what the game tracker saw him play this week.',
    parameters: obj({}),
    label: () => 'game library',
    run: async () => {
      const week = playtime(loadPlay());
      return {
        installed: allGames().slice(0, 40).map((g) => ({ name: g.name, launcher: g.launcher, last_played: g.lastPlayed ? new Date(g.lastPlayed).toLocaleDateString('en-CA') : undefined, playtime: hours(g.playtimeMin), size: g.sizeGb ? `${g.sizeGb} GB` : undefined })),
        played_this_week: trackerOn() ? week.map((w) => `${w.game}: ${hours(w.minutes)} in ${w.sessions} session${w.sessions === 1 ? '' : 's'}`) : 'the game tracker is switched off (Settings - trackers)',
      };
    },
  },
  {
    name: 'media_game_news',
    owner: 'theseus',
    description: 'Latest news and patch notes for one of his Steam games (Steam\'s public news feed).',
    parameters: obj({ game: S('Game name, e.g. "Rainbow Six Siege"'), count: N('How many items (default 3)') }, ['game']),
    label: (a) => `news: ${str(a, 'game')}`,
    run: async (a) => {
      const want = str(a, 'game').toLowerCase().replace(/[^a-z0-9 ]/g, '');
      const g = allGames().find((x) => x.launcher === 'steam' && x.name.toLowerCase().replace(/[^a-z0-9 ]/g, '').includes(want));
      if (!g) return { error: `"${str(a, 'game')}" isn't one of his installed Steam games - search the web for its news instead.` };
      const items = await steamNews(g.id, Math.min(6, Math.max(1, num(a, 'count', 3))));
      return { game: g.name, news: items.map((n) => ({ title: n.title, date: new Date(n.date).toLocaleDateString('en-CA'), url: n.url, summary: n.text })) };
    },
  },
  {
    name: 'media_free_games',
    owner: 'theseus',
    description: 'Epic Games Store\'s free games this week and next. With open: true, opens the current free game\'s page in his browser so HE can click Get - Ultron never claims, buys or signs in.',
    parameters: obj({ open: { type: 'boolean', description: 'Open the current free game\'s page in his browser' } }),
    label: () => 'Epic free games',
    run: async (a) => {
      const games = await epicFreeGames();
      const now = games.filter((g) => g.now);
      if (bool(a, 'open') && now[0]) await shell.openExternal(now[0].url);
      return {
        free_now: now.map((g) => ({ title: g.title, until: g.until ? new Date(g.until).toLocaleString('en-CA', { weekday: 'short', month: 'short', day: 'numeric' }) : undefined, page: g.url })),
        next_week: games.filter((g) => !g.now).map((g) => ({ title: g.title, from: g.from ? new Date(g.from).toLocaleDateString('en-CA') : undefined })),
        opened: bool(a, 'open') && now[0] ? `${now[0].title} - he clicks Get himself` : undefined,
      };
    },
  },
  {
    name: 'media_playtime',
    owner: 'dionysus',
    description: 'What the game tracker collected: play sessions per game (from the running-program list only), this week or in full.',
    parameters: obj({ days: N('Days back (default 7)'), everything: { type: 'boolean', description: 'List every session it has recorded' } }),
    label: () => 'playtime',
    run: async (a) => {
      if (!trackerOn()) return { note: 'The game tracker is switched off (Settings - trackers).' };
      if (bool(a, 'everything')) return { sessions: collected().slice(-100) };
      return { playtime: playtime(loadPlay(), Date.now(), Math.min(60, Math.max(1, num(a, 'days', 7)))).map((w) => ({ game: w.game, time: hours(w.minutes), sessions: w.sessions })) };
    },
  },
];
