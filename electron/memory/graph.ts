import { isPrivateRel } from '../brain/privacy';
import { listHqNotes, readHqNote } from './hq';
import { indexSize } from './semantic';
import { listNotes, readNote, vaultRoot, type VaultNote } from './vault';

/*
 * Ultron's mind as a graph, for the Memory tab's sphere (src/components/mind): every note in
 * Ultron's vault, the agents' own brains, the operator's profile and his HQ files (read-only),
 * joined by their [[wikilinks]] - the same links Obsidian's graph view draws.
 * Read-only: nothing here writes a note.
 */

/** Where a note sits in the sphere: the profile at the core, brains inside, the vault, then HQ around it. */
export type MindShell = 'core' | 'brain' | 'vault' | 'hq';

export interface MindNode {
  id: string;
  title: string;
  /** "Memory/Health", "Journal", "School", "HQ/school"... */
  group: string;
  shell: MindShell;
  mtime: number;
  size: number;
  private: boolean;
}

export interface MindGraph {
  root: string;
  nodes: MindNode[];
  /** Index pairs into nodes, each link once. */
  links: [number, number][];
  groups: { id: string; count: number; shell: MindShell }[];
  stats: { notes: number; links: number; brains: number; hq: number; passages: number; indexedNotes: number; lastWrite: number | null };
}

const MAX_NODES = 1500;
const SKIP = /^(Tasks\/|\.ultron\/)/;

/** The targets of every [[wikilink]] in a note, without aliases or headings. Pure, for tests. */
export function parseLinks(md: string): string[] {
  const out: string[] = [];
  for (const m of md.matchAll(/!?\[\[([^\]\n]+?)\]\]/g)) {
    const target = m[1].split('|')[0].split('#')[0].trim();
    if (target) out.push(target);
  }
  return out;
}

/** The group a note belongs to (its colour and slice of the sphere). Pure, for tests. */
export function groupOf(rel: string): string {
  const parts = rel.split('/');
  if (parts[0] === 'HQ') return parts.length > 2 ? `HQ/${parts[1]}` : 'HQ';
  if (parts[0] === 'Memory' && parts.length > 2) return `Memory/${parts[1]}`;
  return parts.length > 1 ? parts[0] : 'Home';
}

export function shellOf(rel: string): MindShell {
  if (rel.startsWith('Profile/')) return 'core';
  if (rel.startsWith('Brains/')) return 'brain';
  if (rel.startsWith('HQ/')) return 'hq';
  return 'vault';
}

const keyOf = (s: string) => s.replace(/\\/g, '/').replace(/\.md$/i, '').trim().toLowerCase();

/**
 * Builds the graph from a list of notes and a way to read each one. Links resolve the way
 * Obsidian resolves them: by path ("Journal/2026/2026-10-01") or by note name alone. Pure, for tests.
 */
export function buildGraph(notes: VaultNote[], read: (rel: string) => string | null): Pick<MindGraph, 'nodes' | 'links'> {
  const kept = notes
    .filter((n) => !SKIP.test(n.rel))
    .sort((a, b) => b.mtime - a.mtime)
    .slice(0, MAX_NODES);
  const nodes: MindNode[] = kept.map((n) => ({
    id: n.rel,
    title: n.title,
    group: groupOf(n.rel),
    shell: shellOf(n.rel),
    mtime: n.mtime,
    size: n.size,
    private: isPrivateRel(n.rel),
  }));
  const byPath = new Map<string, number>();
  const byName = new Map<string, number>();
  nodes.forEach((n, i) => {
    const p = keyOf(n.id);
    byPath.set(p, i);
    // HQ notes are found by their path inside HQ too.
    if (p.startsWith('hq/')) byPath.set(p.slice(3), i);
    const name = keyOf(n.title);
    if (!byName.has(name)) byName.set(name, i); // newest first wins, like a recent-first lookup
  });
  const seen = new Set<string>();
  const links: [number, number][] = [];
  nodes.forEach((n, i) => {
    const text = read(n.id);
    if (!text) return;
    for (const target of parseLinks(text)) {
      const k = keyOf(target);
      const j = byPath.get(k) ?? byName.get(k) ?? byName.get(k.split('/').pop() ?? k);
      if (j === undefined || j === i) continue;
      const pair = i < j ? `${i}:${j}` : `${j}:${i}`;
      if (seen.has(pair)) continue;
      seen.add(pair);
      links.push(i < j ? [i, j] : [j, i]);
    }
  });
  return { nodes, links };
}

let cache: { sig: string; graph: MindGraph } | null = null;

/** The whole mind, rebuilt only when a note has changed since last time. */
export function mindGraph(): MindGraph {
  const vault = listNotes();
  const hq = listHqNotes();
  const all = [...vault, ...hq];
  const sig = `${vaultRoot()}|${all.length}|${all.reduce((m, n) => Math.max(m, n.mtime), 0)}`;
  if (cache?.sig === sig) return cache.graph;
  const { nodes, links } = buildGraph(all, (rel) => (rel.startsWith('HQ/') ? readHqNote(rel) : readNote(rel)));
  const counts = new Map<string, { count: number; shell: MindShell }>();
  for (const n of nodes) {
    const g = counts.get(n.group) ?? { count: 0, shell: n.shell };
    g.count++;
    counts.set(n.group, g);
  }
  const idx = indexSize();
  const graph: MindGraph = {
    root: vaultRoot(),
    nodes,
    links,
    groups: [...counts.entries()].map(([id, g]) => ({ id, ...g })).sort((a, b) => b.count - a.count),
    stats: {
      notes: nodes.filter((n) => n.shell !== 'hq').length,
      links: links.length,
      brains: nodes.filter((n) => n.shell === 'brain').length,
      hq: nodes.filter((n) => n.shell === 'hq').length,
      passages: idx.passages,
      indexedNotes: idx.notes,
      lastWrite: vault.reduce<number | null>((m, n) => (m === null || n.mtime > m ? n.mtime : m), null),
    },
  };
  cache = { sig, graph };
  return graph;
}

/** One note's text for the preview panel (vault or HQ), never anything outside them. */
export function readMindNote(rel: string, max = 4000): string | null {
  const text = rel.startsWith('HQ/') ? readHqNote(rel) : readNote(rel);
  if (text === null) return null;
  return text.length > max ? `${text.slice(0, max)}\n...` : text;
}
