import { describe, expect, it, vi } from 'vitest';

vi.mock('../brain/privacy', () => ({ isPrivateRel: (r: string) => r.includes('/Private/') || r.startsWith('HQ/health-fitness/') }));
vi.mock('./hq', () => ({ listHqNotes: () => [], readHqNote: () => null }));
vi.mock('./semantic', () => ({ indexSize: () => ({ notes: 0, passages: 0 }) }));
vi.mock('./vault', () => ({ listNotes: () => [], readNote: () => null, vaultRoot: () => 'C:/vault' }));

const { buildGraph, groupOf, parseLinks, shellOf } = await import('./graph');

const note = (rel: string, mtime = 1) => ({ rel, title: rel.split('/').pop()!.replace(/\.md$/, ''), folder: rel.split('/')[0], mtime, size: 100 });

describe('parseLinks', () => {
  it('finds every [[link]], without aliases or headings, embeds included', () => {
    expect(parseLinks('See [[Projects Viral Video]] and [[Journal/2026/2026-10-01|that day]], [[Math#Unit 2]] ![[diagram]]'))
      .toEqual(['Projects Viral Video', 'Journal/2026/2026-10-01', 'Math', 'diagram']);
  });
  it('ignores empty and broken brackets', () => {
    expect(parseLinks('[[ ]] [[unfinished and [single] text')).toEqual([]);
  });
});

describe('groupOf / shellOf', () => {
  it('groups memory by its category, HQ by area, everything else by folder', () => {
    expect(groupOf('Memory/Health/Sleep.md')).toBe('Memory/Health');
    expect(groupOf('Journal/2026/2026-10-01.md')).toBe('Journal');
    expect(groupOf('HQ/school/context/math.md')).toBe('HQ/school');
    expect(groupOf('HQ/north-star.md')).toBe('HQ');
    expect(groupOf('Home.md')).toBe('Home');
  });
  it('puts the profile at the core, brains inside, HQ outside', () => {
    expect(shellOf('Profile/Operator.md')).toBe('core');
    expect(shellOf('Brains/Asclepius.md')).toBe('brain');
    expect(shellOf('HQ/north-star.md')).toBe('hq');
    expect(shellOf('Memory/Goals/Tier 3.md')).toBe('vault');
  });
});

describe('buildGraph', () => {
  const notes = [
    note('Memory/Projects/Viral Video.md', 5),
    note('Journal/2026/2026-10-01.md', 4),
    note('Team Runs/2026-10-01 Edit video.md', 3),
    note('Tasks/Tasks.md', 9),
    note('Journal/Private/2026/2026-10-11.md', 2),
    note('HQ/north-star.md', 1),
  ];
  const text: Record<string, string> = {
    'Memory/Projects/Viral Video.md': 'From [[Journal/2026/2026-10-01]] and [[Edit video|the run]]... [[Viral Video]] [[Nowhere]]',
    'Journal/2026/2026-10-01.md': 'Talked about [[Viral Video]] twice: [[Viral Video]]. Plan: [[north-star]]',
    'Team Runs/2026-10-01 Edit video.md': 'Notes: [[Memory/Projects/Viral Video]]',
    'Tasks/Tasks.md': '[[Viral Video]]',
  };
  const g = buildGraph(notes, (r) => text[r] ?? null);
  const id = (rel: string) => g.nodes.findIndex((n) => n.id === rel);
  const has = (a: string, b: string) => g.links.some(([x, y]) => (x === id(a) && y === id(b)) || (x === id(b) && y === id(a)));

  it('resolves links by path and by note name, as Obsidian does', () => {
    expect(has('Memory/Projects/Viral Video.md', 'Journal/2026/2026-10-01.md')).toBe(true);
    expect(has('Memory/Projects/Viral Video.md', 'Team Runs/2026-10-01 Edit video.md')).toBe(true); // the run links back by path
    expect(has('Journal/2026/2026-10-01.md', 'HQ/north-star.md')).toBe(true);
  });
  it('keeps each link once, and drops self-links and links to nothing', () => {
    const vv = id('Memory/Projects/Viral Video.md');
    expect(g.links.filter(([a, b]) => a === vv || b === vv)).toHaveLength(2); // the journal and the team run - not itself, not "Nowhere"
    expect(new Set(g.links.map(([a, b]) => `${a}:${b}`)).size).toBe(g.links.length);
  });
  it('does not match a link to part of a note name', () => {
    const only = buildGraph([note('A.md'), note('Team Runs/2026-10-01 Edit video.md')], (r) => (r === 'A.md' ? '[[Edit video]]' : ''));
    expect(only.links).toEqual([]);
  });
  it('leaves the task list out, and marks private notes', () => {
    expect(id('Tasks/Tasks.md')).toBe(-1);
    expect(g.nodes[id('Journal/Private/2026/2026-10-11.md')].private).toBe(true);
    expect(g.nodes[id('Memory/Projects/Viral Video.md')].private).toBe(false);
  });
});
