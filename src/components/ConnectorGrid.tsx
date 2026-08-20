import { useEffect, useState } from 'react';
import { connectors } from '../connectors';
import { useStore, type Overlay } from '../state/store';
import { ultron } from '../services/bridge';

/**
 * Real connectors check actual state and route to a dedicated panel; every
 * other card stays honest scaffolding until it gets the same treatment -
 * clicking opens real setup instructions, not a fake connection.
 */
const REAL: Record<string, { overlay: Overlay; check: () => Promise<boolean>; label: string }> = {
  github: { overlay: { kind: 'github' }, check: () => ultron.github.hasToken(), label: 'CONNECT FOR REAL ›' },
  notion: { overlay: { kind: 'notion' }, check: () => ultron.notion.hasToken(), label: 'CONNECT FOR REAL ›' },
  discord: { overlay: { kind: 'discord' }, check: () => ultron.discord.hasWebhook(), label: 'CONNECT FOR REAL ›' },
  obsidian: { overlay: { kind: 'obsidian' }, check: () => ultron.obsidian.hasVault(), label: 'CONNECT FOR REAL ›' },
  // Needs no key at all - genuinely live the moment the app launches.
  'open-meteo': { overlay: { kind: 'connector', id: 'open-meteo' }, check: () => Promise.resolve(true), label: 'CONNECT ›' },
};

export function ConnectorGrid() {
  const setOverlay = useStore((s) => s.setOverlay);
  const [connected, setConnected] = useState<Record<string, boolean>>({});

  useEffect(() => {
    let cancelled = false;
    void Promise.all(
      Object.entries(REAL).map(([id, r]) => r.check().then((ok) => [id, ok] as const)),
    ).then((pairs) => {
      if (!cancelled) setConnected(Object.fromEntries(pairs));
    });
    return () => { cancelled = true; };
  }, []);

  const realCount = Object.keys(REAL).length;

  return (
    <>
      <div className="alert-strip alert-strip--info">
        <span className="dot" />
        {connectors.length} connectors scaffolded - {realCount} are wired up for real, the rest are not yet.
      </div>
      <div className="conn-grid">
        {connectors.map((c) => {
          const real = REAL[c.id];
          const isConnected = Boolean(real && connected[c.id]);
          return (
            <div
              key={c.id}
              className="conn-card"
              onClick={() => setOverlay(real ? real.overlay : { kind: 'connector', id: c.id })}
              style={isConnected ? { borderColor: 'var(--green)', background: 'rgba(0,255,157,0.06)' } : undefined}
            >
              {c.freeTier && !isConnected && <span className="conn-card__free">FREE</span>}
              {isConnected && <span className="conn-card__free" style={{ color: 'var(--green)' }}>● LIVE</span>}
              <div className="conn-card__name">{c.name}</div>
              <div className="conn-card__cat">{c.category}</div>
              <div className="conn-card__status" style={isConnected ? { color: 'var(--green)' } : undefined}>
                {isConnected ? 'CONNECTED ›' : real ? real.label : 'CONNECT ›'}
              </div>
            </div>
          );
        })}
      </div>
      <div className="empty-note" style={{ paddingTop: 4 }}>
        Each connector is one file in <span className="mono" style={{ color: 'var(--cyan)' }}>src/connectors/</span> and
        registers itself automatically. Add a file, get a card.
      </div>
    </>
  );
}
