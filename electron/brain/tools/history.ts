import { onThisDay } from '../../helios/feeds';
import { scoreItem } from '../../helios/triage';
import { EMPIRES, finishDive, load, markTold, startDive, writeSection } from '../../departments/history/store';
import { readNote, safeName, writeNote } from '../../memory/vault';
import { A, S, obj, str, type AgentTool } from './types';

/*
 * The History department's tools: the story of the day (picked for his empires and battles),
 * deep-dives written into the vault section by section, timelines Obsidian can draw, and
 * scripts for a history video. History here is his hobby - entertainment with real sources -
 * not schoolwork (that is School's, under School's rules).
 */

export const historyTools: AgentTool[] = [
  {
    name: 'history_story',
    owner: 'clio',
    description: 'Today\'s best story from history: Wikipedia\'s "on this day" events, ranked for his favourite empires, battles and drama, skipping ones already told. Tell it as a story, with the source.',
    parameters: obj({}),
    label: () => 'story of the day',
    run: async () => {
      const told = new Set(load().told);
      const events = await onThisDay(new Date());
      const ranked = events
        .map((e) => ({ e, s: scoreItem({ title: e.title, summary: '', at: null }, 'history', EMPIRES.map((x) => x.split(' ')[0])).score }))
        .filter((x) => x.s > 0 && !told.has(x.e.title))
        .sort((a, b) => b.s - a.s);
      const pick = ranked[0]?.e ?? events.find((e) => !told.has(e.title));
      if (!pick) return { error: 'Nothing new on this day - pick an empire and go deeper instead.' };
      markTold(pick.title);
      return { story: pick.title, source: pick.link || 'Wikipedia - on this day', also_today: ranked.slice(1, 4).map((x) => x.e.title) };
    },
  },
  {
    name: 'history_deepdive',
    owner: 'clio',
    description: 'A deep-dive note in his vault (History/<Topic>.md): start one, write or replace a section ("Story", "Timeline", "Key figures", "Battles", "Myths vs facts", "Sources"), finish it, or list them. Finished deep-dives are History\'s number.',
    parameters: obj({
      action: S('start, section, finish or list', { enum: ['start', 'section', 'finish', 'list'] }),
      topic: S('e.g. "The Siege of Baghdad (1258)"'),
      empire: S('Which empire it belongs to (optional)'),
      section: S('For section: the heading'),
      content: S('For section: the markdown for it, with sources'),
    }, ['action']),
    label: (a) => `${str(a, 'action')} deep-dive ${str(a, 'topic')}`,
    writes: true,
    run: async (a) => {
      const action = str(a, 'action');
      if (action === 'list') return { deep_dives: load().dives.map((d) => ({ topic: d.topic, status: d.status, sections: d.sections, note: d.rel })) };
      const topic = str(a, 'topic').trim();
      if (!topic) return { error: 'Which topic?' };
      if (action === 'start') { const d = startDive(topic, str(a, 'empire')); return { started: d.topic, note: d.rel }; }
      if (action === 'finish') return finishDive(topic);
      const r = writeSection(topic, str(a, 'section'), str(a, 'content'));
      return 'error' in r ? r : { written: str(a, 'section'), note: r.rel, sections: r.sections };
    },
  },
  {
    name: 'history_timeline',
    owner: 'atlas',
    description: 'Write a timeline into a deep-dive (or its own note) from dated events - as a table plus a Mermaid timeline Obsidian draws. Every event needs a year; get them from sources, never from memory alone.',
    parameters: obj({
      title: S('e.g. "Rise of the Mongols"'),
      events: A('Events as "YEAR: what happened", e.g. "1206: Temujin proclaimed Genghis Khan"'),
      deepdive: S('Optional: the deep-dive topic to add it to as its "Timeline" section'),
    }, ['title', 'events']),
    label: (a) => `timeline: ${str(a, 'title')}`,
    writes: true,
    run: async (a) => {
      const rows = (Array.isArray(a.events) ? a.events : []).map(String)
        .map((e) => /^\s*(-?\d{1,4}(?:\s*(?:BC|BCE|AD|CE))?)\s*[:\-–]\s*(.+)$/i.exec(e))
        .filter((m): m is RegExpExecArray => Boolean(m)).slice(0, 60)
        .map((m) => ({ year: m[1].trim(), what: m[2].trim().replace(/\|/g, '/').slice(0, 200) }));
      if (rows.length < 2) return { error: 'Give at least two events as "YEAR: what happened".' };
      const md = [
        '| Year | What happened |', '| --- | --- |', ...rows.map((r) => `| ${r.year} | ${r.what} |`), '',
        '```mermaid', 'timeline', `    title ${str(a, 'title').replace(/[:\n]/g, ' ')}`, ...rows.map((r) => `    ${r.year} : ${r.what.replace(/[:\n]/g, ' ').slice(0, 90)}`), '```',
      ].join('\n');
      const dive = str(a, 'deepdive');
      if (dive) {
        const r = writeSection(dive, 'Timeline', md);
        return 'error' in r ? r : { added_to: r.rel, events: rows.length };
      }
      const rel = `History/Timelines/${safeName(str(a, 'title'))}.md`;
      writeNote(rel, `# ${str(a, 'title')}\n\n${md}\n`);
      return { written: rel, events: rows.length };
    },
  },
  {
    name: 'history_script',
    owner: 'calliope',
    description: 'Write a script for a history video he might make (his channel idea) into his vault: hook, acts, the twist, the ending, with sources. Creative work for his own project - not a school assignment.',
    parameters: obj({ title: S('Working title'), script: S('The script in markdown (hook, acts with narration and on-screen notes, ending, sources)') }, ['title', 'script']),
    label: (a) => `script: ${str(a, 'title')}`,
    writes: true,
    run: async (a) => {
      const rel = `History/Scripts/${safeName(str(a, 'title'))}.md`;
      const had = readNote(rel);
      writeNote(rel, `---\nsource: Calliope\nwritten: ${new Date().toISOString().slice(0, 10)}\n---\n\n# ${str(a, 'title')}\n\n${str(a, 'script').trim().slice(0, 40_000)}\n`);
      return { written: rel, replaced: Boolean(had) };
    },
  },
];
