import { useEffect, useState } from 'react';
import { HexPanel } from './hud/HexPanel';
import { ArcMeter } from './hud/ArcMeter';
import { BarSpectrum } from './hud/BarSpectrum';
import { FilePanel } from './FilePanel';
import { ConnectorGrid } from './ConnectorGrid';
import { AgentGrid } from './AgentGrid';
import { useStore, type RightTab } from '../state/store';
import { connectors } from '../connectors';
import { specialists } from '../agents';
import { ultron } from '../services/bridge';

const TABS: { id: RightTab; label: string }[] = [
  { id: 'system', label: 'System' },
  { id: 'agents', label: 'Agents' },
  { id: 'files', label: 'Files' },
  { id: 'connectors', label: 'Connectors' },
];

// Module scope, not component state: SystemStatus unmounts on every tab
// switch (conditional render below), so a component-local start time would
// reset "Uptime" to 0 every time the operator glances at another tab.
const APP_STARTED = Date.now();

function Row({ label, value, tone }: { label: string; value: string; tone?: 'good' | 'bad' }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'baseline', gap: 10, padding: '5px 14px',
      borderBottom: '1px solid rgba(0,217,255,0.07)',
    }}>
      <span className="label-xs" style={{ minWidth: 78 }}>{label}</span>
      <span
        className="mono"
        style={{
          fontSize: 11, wordBreak: 'break-all',
          color: tone === 'good' ? 'var(--green)' : tone === 'bad' ? 'var(--red)' : 'var(--white)',
        }}
      >
        {value}
      </span>
    </div>
  );
}

function SystemStatus() {
  const ollama = useStore((s) => s.ollama);
  const quota = useStore((s) => s.quota);
  const folders = useStore((s) => s.folders);
  const setOverlay = useStore((s) => s.setOverlay);
  const [versions, setVersions] = useState<{ electron: string; chrome: string; node: string; platform: string } | null>(null);
  const [envPath, setEnvPath] = useState('');
  const [uptime, setUptime] = useState(0);

  useEffect(() => {
    void ultron.app.versions().then(setVersions);
    void ultron.settings.envPath().then(setEnvPath);
    const id = setInterval(() => setUptime(Math.floor((Date.now() - APP_STARTED) / 1000)), 1000);
    return () => clearInterval(id);
  }, []);

  const brainOk = Boolean(ollama?.running && ollama.modelInstalled);
  const hh = String(Math.floor(uptime / 3600)).padStart(2, '0');
  const mm = String(Math.floor((uptime % 3600) / 60)).padStart(2, '0');
  const ss = String(uptime % 60).padStart(2, '0');

  return (
    <>
      <div style={{
        display: 'flex', gap: 8, padding: '12px 10px', justifyContent: 'space-around',
        borderBottom: '1px solid var(--cyan-20)', flex: '0 0 auto',
      }}>
        <ArcMeter value={brainOk ? 1 : 0} size={68} readout={brainOk ? 'OK' : 'X'} label="BRAIN"
                  color={brainOk ? 'var(--green)' : 'var(--red)'} />
        <ArcMeter value={quota ? quota.used / quota.cap : 0} size={68}
                  readout={`${quota?.used ?? 0}`} label="API/DAY" />
        <ArcMeter value={Math.min(1, folders.length / 5)} size={68}
                  readout={`${folders.length}`} label="FOLDERS" />
      </div>

      <div style={{ padding: '8px 12px 2px', flex: '0 0 auto' }}>
        <div className="label-xs" style={{ marginBottom: 4 }}>SIGNAL</div>
        <BarSpectrum bars={40} height={40} live seed={3} />
      </div>

      <div className="panel-body" style={{ flex: '1 1 auto' }}>
        <Row
          label="Brain"
          value={
            brainOk
              ? `${ollama?.activeModel} @ ${ollama?.host}`
              : ollama?.running
                ? `daemon up, model "${ollama.activeModel}" not pulled`
                : (ollama?.error ?? 'offline')
          }
          tone={brainOk ? 'good' : 'bad'}
        />
        <Row label="Models" value={ollama?.models.length ? ollama.models.join(', ') : 'none detected'} />
        <Row label="News" value={quota ? `${quota.used}/${quota.cap} requests today` : 'not initialised'} />
        <Row label="Connectors" value={`${connectors.length} scaffolded, 0 connected`} />
        <Row label="Specialists" value={`${specialists.length} available`} />
        <Row label="Uptime" value={`${hh}:${mm}:${ss}`} />
        {versions && <Row label="Runtime" value={`Electron ${versions.electron} / Chromium ${versions.chrome} / Node ${versions.node}`} />}
        <Row label="Env file" value={envPath || 'resolving...'} />
        <div style={{ padding: '10px 12px', display: 'flex', gap: 6 }}>
          <button className="hud-btn" onClick={() => setOverlay({ kind: 'ollama' })}>Brain setup</button>
          <button className="hud-btn" onClick={() => setOverlay({ kind: 'settings' })}>Settings</button>
        </div>
      </div>
    </>
  );
}

export function SystemPanel() {
  const tab = useStore((s) => s.rightTab);
  const setTab = useStore((s) => s.setRightTab);

  return (
    <HexPanel title="Systems" meta={tab.toUpperCase()} scroll={false}>
      <div className="tabs">
        {TABS.map((t) => (
          <button
            key={t.id}
            className={`tab ${tab === t.id ? 'tab--active' : ''}`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>
      {tab === 'system' && <SystemStatus />}
      {tab === 'agents' && <div className="panel-body" style={{ flex: '1 1 auto' }}><AgentGrid /></div>}
      {tab === 'files' && <FilePanel />}
      {tab === 'connectors' && <div className="panel-body" style={{ flex: '1 1 auto' }}><ConnectorGrid /></div>}
    </HexPanel>
  );
}
