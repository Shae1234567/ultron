import { useCallback, useEffect, useRef, useState } from 'react';
import { HexPanel } from '../hud/HexPanel';
import { ultron } from '../../services/bridge';
import { useStore } from '../../state/store';
import type { CouncilBriefing, CouncilState } from '../../types';
import { CouncilPanel, type View } from './CouncilPanel';
import { BUST_X, BUST_Y, ORDER, P, TEAM, TX, type Seat } from './pixel/palette';
import { createScene, isSeat, type Scene } from './pixel/scene';
import './council.css';

/*
 * The council chamber (approved design, 8 Oct 2026): the pixel room on the left, the
 * character sheet on the right. The 10 fps loop runs only while it is open.
 * Click a seat (or Enter/Space on it); Esc lets go, Esc again closes.
 */

const REDUCED = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

export function CouncilChamber() {
  const council = useStore((s) => s.council);
  const setCouncil = useStore((s) => s.setCouncil);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const [scene, setScene] = useState<Scene | null>(null);
  const [state, setState] = useState<CouncilState | null>(null);
  const stateRef = useRef<CouncilState | null>(null);
  const [view, setView] = useState<View>('overview');
  const [briefing, setBriefing] = useState<CouncilBriefing | 'loading' | null>(null);
  const [closing, setClosing] = useState(false);

  const seatOf = (id: Seat) => stateRef.current?.seats.find((s) => s.id === id);

  // The room, once the canvas is there; real seats and numbers, refreshed while it is open.
  useEffect(() => {
    if (!canvasRef.current) return undefined;
    const s = createScene(canvasRef.current, {
      reducedMotion: Boolean(REDUCED),
      built: (id) => Boolean(seatOf(id)?.built),
      borrows: (id) => seatOf(id)?.borrows ?? [],
    });
    setScene(s);
    s.start();
    return () => s.stop();
  }, []);
  useEffect(() => {
    let live = true;
    const load = () => void ultron.council.state().then((st) => {
      if (!live) return;
      stateRef.current = st;
      setState(st);
      scene?.draw();
    });
    load();
    const id = setInterval(load, 20_000);
    return () => { live = false; clearInterval(id); };
  }, [scene]);

  // Opening: fade the overlay in, then focus Close.
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    void el.offsetWidth;
    el.classList.add('is-open');
    const t = setTimeout(() => closeRef.current?.focus({ preventScroll: true }), 40);
    return () => clearTimeout(t);
  }, []);

  const close = useCallback((instant = false) => {
    if (instant || REDUCED) { setCouncil({ open: false }); return; }
    setClosing(true);
    rootRef.current?.classList.remove('is-open');
    setTimeout(() => setCouncil({ open: false }), 180);
  }, [setCouncil]);

  const select = useCallback((v: View) => {
    if (!scene) return;
    if (view === 'briefing') scene.stopConvene();
    setBriefing(null);
    setView(v);
    scene.select(isSeat(v) ? v : v === 'helios' ? 'helios' : null);
  }, [scene, view]);

  const convene = useCallback(async () => {
    if (!scene) return;
    scene.select(null);
    setView('briefing');
    setBriefing('loading');
    const seated = ORDER.filter((id) => seatOf(id)?.built);
    const [b] = await Promise.all([ultron.council.convene(), scene.convene(seated.length ? seated : ORDER)]);
    setBriefing(b);
    setTimeout(() => scene.stopConvene(), REDUCED ? 0 : 3600);
  }, [scene]);

  // Opened from the sidebar's Convene button.
  useEffect(() => {
    if (council.convene && scene && state) {
      const t = setTimeout(() => void convene(), REDUCED ? 0 : 700);
      return () => clearTimeout(t);
    }
    return undefined;
  }, [council.convene, scene, Boolean(state)]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      if (view !== 'overview') select('overview');
      else close(true);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [view, select, close]);

  const pick = (target: EventTarget | null): View | undefined => {
    const el = target as Element | null;
    const seat = el?.closest?.('.px-seat') as SVGGElement | null;
    if (seat?.dataset.id) return seat.dataset.id as Seat;
    if (el?.closest?.('.px-helios')) return 'helios';
    return undefined;
  };
  const onStageClick = (e: React.MouseEvent) => {
    const id = pick(e.target);
    if (id) select(view === id ? 'overview' : id);
    else if (view !== 'overview') select('overview');
  };
  const onStageKey = (e: React.KeyboardEvent) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const id = pick(e.target);
    if (!id) return;
    e.preventDefault();
    select(view === id ? 'overview' : id);
  };

  const selectedSeat = isSeat(view) ? view : null;
  const borrowed = selectedSeat ? state?.seats.find((s) => s.id === selectedSeat)?.borrows ?? [] : [];

  return (
    <div ref={rootRef} className={`council-root${closing ? ' is-closing' : ''}`} role="dialog" aria-modal="true" aria-label="The council"
      onClick={(e) => { if (e.target === rootRef.current) close(); }}>
      <HexPanel
        title="Council"
        scroll={false}
        actions={
          <>
            <button className="hud-btn" onClick={() => void convene()}>Convene</button>
            <button ref={closeRef} className="hud-btn" onClick={() => close()}>Close</button>
          </>
        }
      >
        <div className="chamber-body">
          <div className="stage-wrap">
            <canvas ref={canvasRef} width={960} height={672} />
            <svg viewBox="0 0 960 672" preserveAspectRatio="xMidYMid meet" aria-label="The council chamber" onClick={onStageClick} onKeyDown={onStageKey}>
              <text className="px-label" x="30" y="298">HELIOS</text>
              <text className="px-label" x="572" y="204">ULTRON</text>
              {ORDER.map((id) => {
                const s = state?.seats.find((x) => x.id === id);
                const x = TX[id] * P;
                const built = Boolean(s?.built);
                return (
                  <g key={id} className={`px-seat${selectedSeat === id ? ' is-selected' : ''}${built ? '' : ' is-unbuilt'}`} data-id={id} tabIndex={0} role="button"
                    aria-label={`Seat ${s?.seat ?? ''}, ${s?.name ?? id}: ${s?.head.name ?? ''}${built ? '' : ', not built yet'}`}>
                    <rect className="px-name-bg" x={x - 66} y={480} width={132} height={21} />
                    <text className="px-name" x={x} y={495}>{(s?.head.name ?? '').toUpperCase()}</text>
                    <text className="px-dept" x={x} y={524}>{(s?.name ?? '').toUpperCase()}</text>
                    {!built && <text className="px-soon" x={x} y={541}>NOT BUILT YET</text>}
                    <rect className="px-hit" x={(TX[id] - 22) * P} y={88 * P} width={44 * P} height={(177 - 88) * P} />
                  </g>
                );
              })}
              {TEAM.map(([name], i) => (
                <text key={name} className={`px-team${borrowed.includes(name) ? ' on' : ''}`} x={BUST_X(i) * P} y={(BUST_Y + 27) * P}>{name.toUpperCase()}</text>
              ))}
              <text className="px-team" x="480" y={(BUST_Y + 33) * P}>SHARED TEAM, BORROWED PER JOB</text>
              <rect className="px-hit px-helios" x={6 * P} y={36 * P} width={53 * P} height={57 * P} tabIndex={0} role="button" aria-label="Helios, the background researcher" />
            </svg>
            <div className="stage-hint">Click a seat. Esc lets go, Esc again closes.</div>
          </div>
          {state
            ? <CouncilPanel view={view} state={state} scene={scene} briefing={briefing} onGo={select} />
            : <aside className="council-panel"><p className="np-note">Opening the council...</p></aside>}
        </div>
      </HexPanel>
    </div>
  );
}
