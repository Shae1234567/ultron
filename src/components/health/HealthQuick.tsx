import { useEffect, useState } from 'react';
import { ultron } from '../../services/bridge';
import { useStore } from '../../state/store';
import type { HealthView } from '../../types';
import './health.css';

/**
 * Health in the Systems sidebar, under the council: today's read in one line and a button for
 * each thing worth logging. One tap opens the Health app on that page; water logs right here.
 */
export function HealthQuick() {
  const setHealth = useStore((s) => s.setHealth);
  const [v, setV] = useState<HealthView | null>(null);
  const [poured, setPoured] = useState(false);

  useEffect(() => {
    let live = true;
    const load = () => void ultron.health.view().then((x) => { if (live) setV(x); }).catch(() => undefined);
    load();
    const off = ultron.health.onChanged(load);
    // The date rolls over at midnight; refresh now and then so "today" stays today.
    const t = setInterval(load, 10 * 60_000);
    return () => { live = false; off(); clearInterval(t); };
  }, []);

  const water = async () => {
    const r = await ultron.health.log('water', { ml: 250 });
    if (r.ok) { setPoured(true); setTimeout(() => setPoured(false), 1600); }
  };

  const level = v?.readiness.level ?? 'unknown';
  const word = { good: 'good to go', easy: 'go easier', rest: 'rest day', unknown: 'no read yet' }[level];
  return (
    <div className="health-quick">
      <div className="hq-head">
        <button className="label-xs hq-open" onClick={() => setHealth({ open: true, tab: 'today' })}>Health</button>
        <span className="hq-read">
          <b className={level}>{word}</b>
          {v?.sleep.entry ? ` | ${v.sleep.entry.hours} h sleep` : v?.sleep.guess ? ' | sleep guess ready' : ''}
          {v ? ` | ${(v.water.ml / 1000).toFixed(1)} L` : ''}
        </span>
      </div>
      <div className="hq-btns">
        <button className="hl-mini" onClick={() => setHealth({ open: true, tab: v?.sleep.entry ? 'today' : 'sleep' })}>Sleep</button>
        <button className="hl-mini" onClick={() => setHealth({ open: true, tab: 'train' })}>Train</button>
        <button className="hl-mini" onClick={() => setHealth({ open: true, tab: 'food' })}>Food</button>
        <button className="hl-mini" onClick={() => void water()} aria-label="Log a glass of water">{poured ? 'Logged' : '+ Water'}</button>
      </div>
    </div>
  );
}
