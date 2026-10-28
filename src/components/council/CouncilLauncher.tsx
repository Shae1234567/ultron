import { useEffect, useRef, useState } from 'react';
import { ultron } from '../../services/bridge';
import { useStore } from '../../state/store';
import { createScene } from './pixel/scene';
import './council.css';

/** The council launcher at the top of the Systems sidebar: a still of the room, Open and Convene. */
export function CouncilLauncher({ built }: { built: (id: string) => boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const setCouncil = useStore((s) => s.setCouncil);
  const builtKey = ['history', 'health', 'school', 'media', 'projects'].map((id) => (built(id) ? 1 : 0)).join('');
  const [fresh, setFresh] = useState<number | null>(null);
  useEffect(() => {
    const load = () => void ultron.council.state().then((s) => setFresh(s.helios.on ? s.helios.today : -1)).catch(() => undefined);
    load();
    const t = setInterval(load, 10 * 60_000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (!ref.current) return;
    createScene(null, { reducedMotion: true, built: (id) => built(id), borrows: () => [] }).snapshot(ref.current);
  }, [builtKey]);

  return (
    <div className="council-launch">
      <div className="cl-head"><span className="label-xs">Council</span><span className="cl-intel">{fresh === null ? '' : fresh < 0 ? 'Helios paused' : <><b>{fresh}</b> new from Helios</>}</span></div>
      <button className="cl-mini" aria-label="Open the council" onClick={() => setCouncil({ open: true })}>
        <canvas ref={ref} width={320} height={224} />
      </button>
      <div className="cl-actions">
        <button className="hud-btn hud-btn--active" onClick={() => setCouncil({ open: true })}>Open the council</button>
        <button className="hud-btn" onClick={() => setCouncil({ open: true, convene: true })}>Convene</button>
      </div>
    </div>
  );
}
