import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { ultron } from '../../services/bridge';
import { relTime } from '../../services/format';
import { groupColor, MindEngine } from './engine';
import type { MindGraph } from '../../types';
import './mind.css';

/*
 * The Memory tab's "second brain", shown (11 Oct 2026): every note Ultron has written, the
 * agents' own brains, the operator's profile at the core and his HQ files around it, joined by
 * their [[links]] - the same graph Obsidian draws, as a living sphere in Ultron's colours.
 * Drag to turn it, scroll to zoom, click a fragment to read it, double-click to fly to it.
 */

const GROUP_LABEL = (g: string) => (g === 'HQ' ? 'HQ (north star)' : g.startsWith('HQ/') ? `HQ - ${g.slice(3)}` : g.startsWith('Memory/') ? `Memory - ${g.slice(7)}` : g);
const SHELL_LABEL = { core: 'CORE - ALWAYS IN MIND', brain: 'AN AGENT\'S OWN BRAIN', vault: 'ULTRON\'S VAULT', hq: 'YOUR HQ - READ-ONLY' } as const;

export function MindSphere() {
  const canvas = useRef<HTMLCanvasElement>(null);
  const engine = useRef<MindEngine | null>(null);
  const [graph, setGraph] = useState<MindGraph | null>(null);
  const [hover, setHover] = useState<{ i: number; x: number; y: number } | null>(null);
  const [sel, setSel] = useState<number | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [group, setGroup] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [found, setFound] = useState<number | null>(null);
  const reduced = useMemo(() => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false, []);

  // The engine lives as long as the panel is open.
  useEffect(() => {
    if (!canvas.current) return;
    const e = new MindEngine(canvas.current, {
      onHover: (i, x, y) => setHover(i === null ? null : { i, x, y }),
      onSelect: (i) => setSel(i),
    }, reduced);
    engine.current = e;
    e.startLoop();
    return () => { e.destroy(); engine.current = null; };
  }, [reduced]);

  // The graph, and again whenever Ultron writes to memory - those notes flare.
  useEffect(() => {
    let first = true;
    const load = (changed?: string[]) => void ultron.vault.graph().then((g) => {
      setGraph(g);
      engine.current?.setGraph(g, first);
      // The picked note keeps its place in the panel even though the list was re-sorted.
      if (!first) setSel(engine.current?.selectedIndex() ?? null);
      setHover(null);
      first = false;
      if (changed?.length) engine.current?.pulse(changed);
    }).catch(() => undefined);
    load();
    return ultron.vault.onUpdated((u) => load(u.saved.map((s) => s.rel)));
  }, []);

  // Search and the group legend both just light up the matching notes.
  useEffect(() => {
    if (!graph) return;
    const q = query.trim().toLowerCase();
    if (!q && !group) { engine.current?.setMatch(null); setFound(null); return; }
    const m = Uint8Array.from(graph.nodes, (n) => (
      (!q || n.title.toLowerCase().includes(q) || n.id.toLowerCase().includes(q)) && (!group || n.group === group) ? 1 : 0
    ));
    engine.current?.setMatch(m);
    setFound(q ? m.reduce((a, b) => a + b, 0) : null);
  }, [query, group, graph]);

  // Picking a note: its text for the panel.
  useEffect(() => {
    setPreview(null);
    if (sel === null || !graph?.nodes[sel]) return;
    let live = true;
    void ultron.vault.read(graph.nodes[sel].id).then((t) => { if (live) setPreview(t); });
    return () => { live = false; };
  }, [sel, graph]);

  const pick = (i: number | null) => { setSel(i); engine.current?.select(i); };
  const firstMatch = () => {
    if (!graph) return;
    const q = query.trim().toLowerCase();
    // A note whose name matches first, then one whose folder does.
    let i = graph.nodes.findIndex((n) => n.title.toLowerCase().includes(q));
    if (i < 0) i = graph.nodes.findIndex((n) => n.id.toLowerCase().includes(q));
    if (i >= 0) pick(i);
  };
  const open = async (rel: string) => {
    const r = await ultron.vault.open(rel);
    setNote(r.hint ?? (r.ok ? null : r.error ?? 'Could not open it.'));
  };

  const node = sel !== null ? graph?.nodes[sel] : undefined;
  const linked = useMemo(() => {
    if (sel === null || !graph) return [];
    return graph.links.filter(([a, b]) => a === sel || b === sel).map(([a, b]) => (a === sel ? b : a));
  }, [sel, graph]);
  const st = graph?.stats;
  const empty = graph && !graph.nodes.length;

  return (
    <div className="mind" data-reduced={reduced || undefined} data-notes={st?.notes}>
      <canvas ref={canvas} className="mind__canvas" aria-label="Ultron's memory, shown as a sphere of linked notes" />
      <span className="mind__corner mind__corner--tl" /><span className="mind__corner mind__corner--tr" />
      <span className="mind__corner mind__corner--bl" /><span className="mind__corner mind__corner--br" />

      <div className="mind__top">
        <div className="mind__title"><span className="dot dot--live" /> ULTRON&apos;S MIND</div>
        <input
          className="hud-input mind__search"
          value={query}
          placeholder="find a memory..."
          aria-label="Find a memory"
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') firstMatch(); if (e.key === 'Escape') setQuery(''); }}
        />
        {found !== null && <span className={`mind__found ${found ? '' : 'mind__found--none'}`}>{found ? `${found} found - Enter to fly there` : 'nothing matches'}</span>}
      </div>

      {empty && <div className="mind__empty">Nothing in memory yet - talk to Ultron and watch it fill up.</div>}

      {hover && graph?.nodes[hover.i] && sel !== hover.i && (
        <div className="mind__tip" style={{ left: hover.x + 14, top: hover.y + 10 }}>
          <b>{graph.nodes[hover.i].title}</b>
          <span>{GROUP_LABEL(graph.nodes[hover.i].group)} · {relTime(graph.nodes[hover.i].mtime)}</span>
        </div>
      )}

      <aside className="mind__panel" aria-live="polite">
        {node ? (
          <>
            <div className="mind__kicker" style={{ '--g': groupColor(node.group) } as CSSProperties}>{SHELL_LABEL[node.shell]}</div>
            <h3 className="mind__name">{node.title}</h3>
            <div className="mind__meta">
              {GROUP_LABEL(node.group)}{node.private ? ' · PRIVATE' : ''}<br />
              written {relTime(node.mtime)} · {linked.length} link{linked.length === 1 ? '' : 's'}
            </div>
            {linked.length > 0 && (
              <div className="mind__links">
                {linked.slice(0, 8).map((j) => (
                  <button key={j} className="mind__link" style={{ '--g': groupColor(graph!.nodes[j].group) } as CSSProperties} onClick={() => pick(j)}>
                    {graph!.nodes[j].title}
                  </button>
                ))}
                {linked.length > 8 && <span className="mind__more">+{linked.length - 8} more</span>}
              </div>
            )}
            <pre className="mind__preview">{preview === null ? 'Reading...' : preview.replace(/^---[\s\S]*?---\s*/, '').slice(0, 900) || '(empty note)'}</pre>
            <div className="mind__actions">
              <button className="hud-btn hud-btn--active" onClick={() => void open(node.id)}>{node.shell === 'hq' ? 'Open file' : 'Open in Obsidian'}</button>
              <button className="hud-btn" onClick={() => pick(null)}>Back</button>
            </div>
            {note && <div className="mind__note">{note}</div>}
          </>
        ) : (
          <>
            <div className="mind__kicker">SECOND BRAIN</div>
            <div className="mind__stats">
              <div><b>{st?.notes ?? '-'}</b><span>NOTES</span></div>
              <div><b>{st?.links ?? '-'}</b><span>LINKS</span></div>
              <div><b>{st?.brains ?? '-'}</b><span>AGENT BRAINS</span></div>
              <div><b>{st?.hq ?? '-'}</b><span>HQ FILES</span></div>
              <div><b>{st?.passages ?? '-'}</b><span>SEARCHABLE PASSAGES</span></div>
              <div><b>{st?.lastWrite ? relTime(st.lastWrite) : '-'}</b><span>LAST THOUGHT</span></div>
            </div>
            <div className="mind__legend">
              {(graph?.groups ?? []).slice(0, 14).map((g) => (
                <button
                  key={g.id}
                  className={`mind__chip ${group === g.id ? 'mind__chip--on' : ''}`}
                  style={{ '--g': groupColor(g.id) } as CSSProperties}
                  onClick={() => setGroup(group === g.id ? null : g.id)}
                >
                  <i /> {GROUP_LABEL(g.id)} <em>{g.count}</em>
                </button>
              ))}
            </div>
            <div className="mind__help">Core: your profile. Inner shell: each agent&apos;s own brain. Sphere: Ultron&apos;s vault. Outer shell: your HQ files. Lines are [[links]]; the moving lights are links being followed.</div>
          </>
        )}
      </aside>

      <div className="mind__hint">DRAG TO TURN · SCROLL TO ZOOM · CLICK TO READ · DOUBLE-CLICK TO FLY</div>
    </div>
  );
}
