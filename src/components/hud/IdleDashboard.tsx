import { useEffect, useState, type CSSProperties } from 'react';
import { useStore } from '../../state/store';

/** One small holographic readout tile - thin cyan border, mono value, label-xs heading. */
function Tile({ label, value, tone, style }: {
  label: string;
  value: string;
  tone?: 'good' | 'bad';
  style?: CSSProperties;
}) {
  return (
    <div
      className="idle-dashboard__tile"
      style={{
        width: 120,
        height: 64,
        padding: '8px 10px',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        gap: 4,
        border: '1px solid var(--cyan-20, rgba(0,217,255,0.2))',
        background: 'rgba(6,16,22,0.55)',
        backdropFilter: 'blur(2px)',
        boxSizing: 'border-box',
        ...style,
      }}
    >
      <span className="label-xs">{label}</span>
      <span
        className="mono"
        style={{
          fontSize: 12,
          lineHeight: 1.2,
          wordBreak: 'break-word',
          color: tone === 'good' ? 'var(--green)' : tone === 'bad' ? 'var(--red)' : 'var(--white)',
        }}
      >
        {value}
      </span>
    </div>
  );
}

function pad(n: number) {
  return String(n).padStart(2, '0');
}

/**
 * Ambient tiles rendered around the core orb while it's idle. Fully real
 * data - clock is live system time, the rest is read straight off the
 * store (same fields SystemPanel/NewsPanel already read). No fabricated
 * fields (no weather - there's no such data source in this app).
 */
export function IdleDashboard() {
  const coreState = useStore((s) => s.coreState);
  const ollama = useStore((s) => s.ollama);
  const folders = useStore((s) => s.folders);
  const articles = useStore((s) => s.articles);

  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  const visible = coreState === 'idle';

  const dateStr = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const timeStr = `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;

  const brainOk = Boolean(ollama?.running && ollama.modelInstalled);
  const brainValue = ollama
    ? brainOk
      ? ollama.activeModel
      : ollama.running
        ? `${ollama.activeModel} not pulled`
        : (ollama.error ?? 'offline')
    : 'unknown';

  return (
    <div
      className="idle-dashboard"
      style={{
        position: 'absolute',
        inset: 0,
        pointerEvents: visible ? 'auto' : 'none',
        opacity: visible ? 1 : 0,
        transition: 'opacity 300ms ease',
      }}
    >
      <Tile
        label="DATE / TIME"
        value={`${dateStr}\n${timeStr}`}
        style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(calc(-50% - 160px), calc(-50% - 110px))', whiteSpace: 'pre-line' }}
      />
      <Tile
        label="BRAIN"
        value={brainValue}
        tone={ollama ? (brainOk ? 'good' : 'bad') : undefined}
        style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(calc(-50% + 160px), calc(-50% - 110px))' }}
      />
      <Tile
        label="FOLDERS"
        value={`${folders.length} INDEXED`}
        style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(calc(-50% - 160px), calc(-50% + 110px))' }}
      />
      <Tile
        label="HEADLINES"
        value={`${articles.length} TRACKED`}
        style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(calc(-50% + 160px), calc(-50% + 110px))' }}
      />
    </div>
  );
}
