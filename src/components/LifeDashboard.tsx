import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { HexPanel } from './hud/HexPanel';
import { ultron } from '../services/bridge';
import { isRenderActive } from '../services/visibility';
import { useStore } from '../state/store';
import type { DashItem, DashSection, DashSnapshot, SectionId, SpotifyNow } from '../types';

/**
 * The Life dashboard (left panel): email, school, YouTube, Discord, Spotify
 * and Drive at a glance. The main process (electron/dashboard.ts) fetches it
 * every hour; Spotify is polled every 30 s here because songs change.
 */

const HOUR = 60 * 60_000;
const ORDER: SectionId[] = ['gmail', 'd2l', 'youtube', 'discord', 'spotify', 'drive'];

const Icon = ({ children }: { children: ReactNode }) => (
  <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{children}</svg>
);

const META: Record<SectionId, { label: string; short: string; icon: ReactNode }> = {
  gmail: { label: 'Mail', short: 'MAIL', icon: <Icon><rect x="3" y="5" width="18" height="14" rx="1" /><path d="m3 7 9 6 9-6" /></Icon> },
  d2l: { label: 'School', short: 'SCHOOL', icon: <Icon><path d="m2 9 10-5 10 5-10 5z" /><path d="M6 11v5c0 1.5 2.7 3 6 3s6-1.5 6-3v-5" /><path d="M22 9v6" /></Icon> },
  youtube: { label: 'YouTube', short: 'VIDEO', icon: <Icon><rect x="2.5" y="5.5" width="19" height="13" rx="3" /><path d="m10 9 5 3-5 3z" fill="currentColor" stroke="none" /></Icon> },
  discord: { label: 'Discord', short: 'DISCORD', icon: <Icon><path d="M4 5h16v11H9l-5 4z" /><path d="M8.5 10h.01M12 10h.01M15.5 10h.01" strokeWidth="2.4" /></Icon> },
  spotify: { label: 'Spotify', short: 'MUSIC', icon: <Icon><circle cx="12" cy="12" r="9" /><path d="M7.5 9.5c3-1 6.5-.7 9 .8M8 12.6c2.5-.7 5.2-.4 7.3.8M8.6 15.4c1.9-.5 3.8-.3 5.4.6" /></Icon> },
  drive: { label: 'Drive', short: 'DRIVE', icon: <Icon><path d="M8 3h8l6 10-4 7H6l-4-7z" /><path d="M8 3l6 10h8M2 13h12l-4 7" /></Icon> },
};

/* ------------------------------------------------------------- formatting */

function clock(ms: number): string {
  return new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

/** Past times as "5m", "3h", "Tue"; future (due dates) as "in 3h", "tomorrow 11:59 PM", "Fri". */
function when(iso: string | null | undefined): string {
  if (!iso) return '';
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '';
  const diff = t - Date.now();
  const abs = Math.abs(diff);
  const d = new Date(t);
  if (diff > 0) {
    if (abs < HOUR) return `in ${Math.max(1, Math.round(abs / 60_000))}m`;
    const today = new Date();
    const tomorrow = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1);
    if (d.toDateString() === today.toDateString()) return `today ${clock(t)}`;
    if (d.toDateString() === tomorrow.toDateString()) return `tmrw ${clock(t)}`;
    if (abs < 7 * 24 * HOUR) return d.toLocaleDateString([], { weekday: 'short' });
    return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
  }
  if (abs < 60_000) return 'now';
  if (abs < HOUR) return `${Math.round(abs / 60_000)}m`;
  if (abs < 24 * HOUR) return `${Math.round(abs / HOUR)}h`;
  if (abs < 7 * 24 * HOUR) return d.toLocaleDateString([], { weekday: 'short' });
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

/** Numbers roll up to their new value instead of jumping. */
function useCountUp(value: number, ms = 900): number {
  const [shown, setShown] = useState(value);
  const from = useRef(value);
  useEffect(() => {
    let raf = 0;
    const start = performance.now();
    const a = from.current;
    const tick = (t: number) => {
      const p = Math.min(1, (t - start) / ms);
      const eased = 1 - (1 - p) ** 3;
      setShown(Math.round(a + (value - a) * eased));
      if (p < 1) raf = requestAnimationFrame(tick);
      else from.current = value;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, ms]);
  return shown;
}

const open = (url?: string) => { if (url) void ultron.dashboard.open(url); };

/* ------------------------------------------------------------- pieces */

function Tile({ section, id, index, onPick }: { section?: DashSection; id: SectionId; index: number; onPick: (id: SectionId) => void }) {
  const m = META[id];
  const count = useCountUp(section?.state === 'ok' ? section.count ?? 0 : 0);
  const state = section?.state ?? 'loading';
  return (
    <button className={`life-tile life-tile--${state}`} style={{ '--i': index } as CSSProperties} onClick={() => onPick(id)} title={section?.headline ?? section?.note ?? m.label}>
      <span className="life-tile__icon">{m.icon}</span>
      <span className="life-tile__count">{state === 'ok' && id !== 'spotify' ? count : state === 'off' ? '--' : state === 'error' ? '!' : id === 'spotify' ? '♪' : '··'}</span>
      <span className="life-tile__label">{m.short}</span>
    </button>
  );
}

function Item({ item, index }: { item: DashItem; index: number }) {
  const [loaded, setLoaded] = useState(false);
  return (
    <button
      className={`life-item ${item.unread ? 'life-item--unread' : ''} ${item.urgent ? 'life-item--urgent' : ''}`}
      style={{ '--i': index } as CSSProperties}
      onClick={() => open(item.url)}
      title={[item.title, item.sub].filter(Boolean).join('\n')}
    >
      {item.thumb && (
        <span className={`life-item__thumb ${loaded ? 'is-loaded' : ''}`}>
          <img src={item.thumb} alt="" loading="lazy" onLoad={() => setLoaded(true)} />
        </span>
      )}
      <span className="life-item__body">
        <span className="life-item__title">{item.title}</span>
        {item.sub && <span className="life-item__sub">{item.sub}</span>}
      </span>
      {item.time && <span className="life-item__time">{when(item.time)}</span>}
    </button>
  );
}

function Equalizer({ on }: { on: boolean }) {
  return (
    <span className={`life-eq ${on ? 'life-eq--on' : ''}`} aria-hidden="true">
      {[0, 1, 2, 3, 4].map((i) => <span key={i} style={{ '--b': i } as CSSProperties} />)}
    </span>
  );
}

function SpotifyNowPlaying({ now, onAction }: { now: SpotifyNow; onAction: (a: 'toggle' | 'next' | 'previous') => void }) {
  return (
    <div className={`life-np ${now.playing ? 'life-np--playing' : ''}`}>
      <Equalizer on={now.playing} />
      <div className="life-np__text">
        <div className="life-np__title">{now.title ?? (now.open ? 'Nothing loaded' : 'Spotify is closed')}</div>
        <div className="life-np__artist">{now.title ? now.artist ?? '' : now.open ? 'Pick something in Spotify' : 'Press play to open it'}</div>
      </div>
      <div className="life-np__controls">
        <button className="life-ctl" onClick={() => onAction('previous')} title="Previous" aria-label="Previous song">
          <svg viewBox="0 0 24 24" width="13" height="13"><path d="M6 5v14M19 5 9 12l10 7z" fill="currentColor" stroke="currentColor" strokeWidth="1.5" /></svg>
        </button>
        <button className="life-ctl life-ctl--main" onClick={() => onAction('toggle')} title={now.playing ? 'Pause' : 'Play'} aria-label={now.playing ? 'Pause' : 'Play'}>
          {now.playing
            ? <svg viewBox="0 0 24 24" width="14" height="14"><path d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z" fill="currentColor" /></svg>
            : <svg viewBox="0 0 24 24" width="14" height="14"><path d="m7 4 13 8-13 8z" fill="currentColor" /></svg>}
        </button>
        <button className="life-ctl" onClick={() => onAction('next')} title="Next" aria-label="Next song">
          <svg viewBox="0 0 24 24" width="13" height="13"><path d="M18 5v14M5 5l10 7-10 7z" fill="currentColor" stroke="currentColor" strokeWidth="1.5" /></svg>
        </button>
      </div>
    </div>
  );
}

function Card({ id, section, index, flash, spotifyNow, onSpotify }: {
  id: SectionId; section?: DashSection; index: number; flash: boolean; spotifyNow: SpotifyNow; onSpotify: (a: 'toggle' | 'next' | 'previous') => void;
}) {
  const setOverlay = useStore((s) => s.setOverlay);
  const key = `ultron.life.collapsed.${id}`;
  const [collapsed, setCollapsed] = useState(() => { try { return localStorage.getItem(key) === '1'; } catch { return false; } });
  const toggle = () => setCollapsed((c) => { try { localStorage.setItem(key, c ? '0' : '1'); } catch { /* fine */ } return !c; });
  const m = META[id];
  const state = section?.state ?? 'loading';
  let n = 0;
  return (
    <section id={`life-${id}`} className={`life-card life-card--${state} ${flash ? 'life-card--flash' : ''}`} style={{ '--i': index } as CSSProperties}>
      <button className="life-card__head" onClick={toggle} aria-expanded={!collapsed}>
        <span className="life-card__icon">{m.icon}</span>
        <span className="life-card__name">{m.label}</span>
        <span className="life-card__headline">{id === 'spotify' ? (spotifyNow.playing ? 'NOW PLAYING' : spotifyNow.title ? 'PAUSED' : '') : section?.headline ?? ''}</span>
        <span className={`life-card__chev ${collapsed ? 'is-collapsed' : ''}`} aria-hidden="true">▾</span>
      </button>
      {!collapsed && (
        <div className="life-card__body">
          {id === 'spotify' && state !== 'off' && <SpotifyNowPlaying now={spotifyNow} onAction={onSpotify} />}
          {state === 'loading' && [0, 1, 2].map((i) => <div key={i} className="life-skel" style={{ '--i': i } as CSSProperties} />)}
          {(state === 'off' || state === 'error') && (
            <div className={`life-note life-note--${state}`}>
              <span>{section?.note}</span>
              {state === 'off' && id !== 'spotify' && <button className="mini-btn" onClick={() => setOverlay({ kind: 'apps' })}>OPEN APPS</button>}
            </div>
          )}
          {state === 'ok' && section?.note && <div className="life-note life-note--warn">{section.note}</div>}
          {state === 'ok' && section?.groups.map((g) => (
            <div key={g.label} className="life-group">
              <div className="life-group__label">{g.label}</div>
              {g.items.map((it) => <Item key={it.id} item={it} index={n++} />)}
            </div>
          ))}
          {state === 'ok' && !section?.groups.length && id !== 'spotify' && <div className="life-empty">{section?.headline}</div>}
        </div>
      )}
    </section>
  );
}

/* ------------------------------------------------------------- panel */

export function LifeDashboard() {
  const [snap, setSnap] = useState<DashSnapshot | null>(null);
  const [spotifyNow, setSpotifyNow] = useState<SpotifyNow>({ playing: false, open: false, recent: [] });
  const [flash, setFlash] = useState<SectionId | null>(null);
  const [, setTick] = useState(0);
  const scroller = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void ultron.dashboard.get().then((s) => { setSnap(s); setSpotifyNow(s.spotify); });
    const off = ultron.dashboard.onUpdate((s) => { setSnap(s); setSpotifyNow(s.spotify); });
    // Relative times and the refresh bar move on their own.
    const t = setInterval(() => setTick((x) => x + 1), 30_000);
    return () => { off(); clearInterval(t); };
  }, []);

  // Songs change between hourly refreshes - ask Windows what's playing every 30 s while the HUD is in view.
  useEffect(() => {
    const poll = () => { if (isRenderActive()) void ultron.dashboard.spotify().then(setSpotifyNow).catch(() => {}); };
    poll();
    const t = setInterval(poll, 30_000);
    return () => clearInterval(t);
  }, []);

  const spotifyAction = (a: 'toggle' | 'next' | 'previous') => {
    void ultron.dashboard.spotify(a).then((s) => {
      setSpotifyNow(s);
      // Spotify needs a moment to load the next song before Windows reports it.
      setTimeout(() => void ultron.dashboard.spotify().then(setSpotifyNow).catch(() => {}), 1200);
    }).catch(() => {});
  };

  const pick = (id: SectionId) => {
    // Scroll only the list: scrollIntoView would also scroll the panel itself (its overflow is hidden, not fixed)
    // and push the header and tiles out of sight.
    const card = document.getElementById(`life-${id}`);
    if (card && scroller.current) scroller.current.scrollTo({ top: card.offsetTop - 6, behavior: 'smooth' });
    setFlash(id);
    setTimeout(() => setFlash((f) => (f === id ? null : f)), 1100);
  };

  const byId = new Map((snap?.sections ?? []).map((s) => [s.id, s]));
  const refreshing = snap?.refreshing ?? false;
  const progress = snap?.updatedAt ? Math.min(1, (Date.now() - snap.updatedAt) / HOUR) : 0;
  const meta = refreshing ? 'SYNCING' : snap?.updatedAt ? `UPDATED ${clock(snap.updatedAt)}` : 'FIRST SYNC SOON';

  return (
    <HexPanel
      title="Life"
      meta={meta}
      className="life-panel"
      actions={(
        <button className={`life-refresh ${refreshing ? 'is-spinning' : ''}`} onClick={() => void ultron.dashboard.refresh()} disabled={refreshing} title="Refresh now (it also refreshes every hour)" aria-label="Refresh the dashboard">
          <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M20 12a8 8 0 1 1-2.3-5.6M20 4v4h-4" /></svg>
        </button>
      )}
      scroll={false}
    >
      <div className="life-progress" title={snap?.nextAt ? `Next refresh at ${clock(snap.nextAt)}` : ''}><span style={{ transform: `scaleX(${progress})` }} /></div>
      <div className="life-tiles">
        {ORDER.map((id, i) => <Tile key={id} id={id} index={i} section={snap ? byId.get(id) : undefined} onPick={pick} />)}
      </div>
      <div className={`life-scroll ${refreshing ? 'is-syncing' : ''}`} ref={scroller}>
        {ORDER.map((id, i) => (
          <Card key={id} id={id} index={i} section={snap?.updatedAt || snap?.sections.length ? byId.get(id) : undefined} flash={flash === id} spotifyNow={spotifyNow} onSpotify={spotifyAction} />
        ))}
        <div className="life-foot">Read-only · refreshes every hour · click anything to open it</div>
      </div>
    </HexPanel>
  );
}
