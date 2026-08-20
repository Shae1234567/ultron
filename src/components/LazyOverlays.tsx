import React, { Suspense } from 'react';

// Lazy-loaded overlay panels. Each is only ever rendered when
// `overlay?.kind` matches, so there's no reason to ship them in the main
// bundle — this splits every one of them into its own chunk, fetched only
// on the click that opens it. See proposals/perf.md for the rationale.

export const OllamaSetup = React.lazy(() =>
  import('./OllamaSetup').then((m) => ({ default: m.OllamaSetup })),
);

export const SettingsPanel = React.lazy(() =>
  import('./SettingsPanel').then((m) => ({ default: m.SettingsPanel })),
);

export const ConnectorSetup = React.lazy(() =>
  import('./ConnectorSetup').then((m) => ({ default: m.ConnectorSetup })),
);

export const MemoryPanel = React.lazy(() =>
  import('./MemoryPanel').then((m) => ({ default: m.MemoryPanel })),
);

export const AgentSetup = React.lazy(() =>
  import('./AgentSetup').then((m) => ({ default: m.AgentSetup })),
);

export const GitHubPanel = React.lazy(() =>
  import('./GitHubPanel').then((m) => ({ default: m.GitHubPanel })),
);

export const NotionPanel = React.lazy(() =>
  import('./NotionPanel').then((m) => ({ default: m.NotionPanel })),
);

export const DiscordPanel = React.lazy(() =>
  import('./DiscordPanel').then((m) => ({ default: m.DiscordPanel })),
);

export const ObsidianPanel = React.lazy(() =>
  import('./ObsidianPanel').then((m) => ({ default: m.ObsidianPanel })),
);

export const Cm8Panel = React.lazy(() =>
  import('./cm8/Cm8Panel').then((m) => ({ default: m.Cm8Panel })),
);

export const BrowserPanel = React.lazy(() =>
  import('./BrowserPanel').then((m) => ({ default: m.BrowserPanel })),
);

export const WorldMapHologram = React.lazy(() =>
  import('./hud/WorldMapHologram').then((m) => ({ default: m.WorldMapHologram })),
);

export const GooglePanel = React.lazy(() =>
  import('./GooglePanel').then((m) => ({ default: m.GooglePanel })),
);

/**
 * Suspense boundary for lazy overlay panels. Fallback is deliberately
 * minimal — on the app's normal chunk-cache-warm path this is barely ever
 * visible, so it just reuses the existing HUD mono/cyan styling rather than
 * inventing new UI.
 */
export function OverlaySuspense({ children }: { children: React.ReactNode }) {
  return (
    <Suspense
      fallback={
        <div
          className="mono"
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: '100%',
            height: '100%',
            minHeight: '120px',
            color: 'var(--cyan)',
            letterSpacing: '0.15em',
            fontSize: '13px',
            textShadow: 'var(--text-glow)',
          }}
        >
          LOADING MODULE...
        </div>
      }
    >
      {children}
    </Suspense>
  );
}
