import { useMemo, useState } from 'react';
import { HexPanel } from './HexPanel';
import { REGION_COORDS } from './regionCoords';
import { useStore } from '../../state/store';
import { ALL_REGIONS } from '../../types';
import type { Region } from '../../types';

/**
 * Holographic world map: a stylized wireframe globe with a pulsing beacon
 * for every Region that currently has at least one article in the store.
 * Continents are hand-drawn low-poly SVG silhouettes (not a real basemap -
 * this is a HUD schematic, not a map service). Coordinates are projected
 * with a plain equirectangular transform against a 1000x500 viewBox:
 *   x = (lon + 180) / 360 * 1000,  y = (90 - lat) / 180 * 500
 * GLOBAL has no single coordinate (see regionCoords.ts) and is surfaced as
 * a small unmapped counter instead of a beacon. Clicking a beacon narrows
 * the shared region filter and opens a floating detail card sourced only
 * from articles already in the store - no fetching happens here.
 */

const VIEW_W = 1000;
const VIEW_H = 500;

function project(lat: number, lon: number): { x: number; y: number } {
  return { x: ((lon + 180) / 360) * VIEW_W, y: ((90 - lat) / 180) * VIEW_H };
}

// Hand-drawn low-poly continent silhouettes against the 1000x500 viewBox.
const CONTINENTS: string[] = [
  // North America
  'M150,68 L232,58 L272,92 L262,142 L232,160 L242,190 L200,232 L160,220 L120,190 L88,158 L70,110 Z',
  // South America
  'M262,270 L302,258 L322,300 L312,362 L292,422 L260,432 L240,380 L230,320 Z',
  // Europe
  'M470,80 L522,68 L562,90 L552,120 L530,142 L500,152 L474,130 L458,100 Z',
  // Africa
  'M492,160 L552,150 L582,190 L572,252 L550,312 L520,352 L500,320 L480,262 L468,200 Z',
  // Asia
  'M562,90 L622,48 L702,54 L782,70 L852,90 L882,132 L860,172 L800,192 L750,222 L700,252 L648,230 L598,200 L570,150 Z',
  // Australia
  'M790,330 L852,320 L900,342 L890,382 L840,402 L800,380 L780,352 Z',
];

// Latitude/longitude wireframe guide lines, purely decorative.
const GRID_LINES_LAT = [-60, -30, 0, 30, 60];
const GRID_LINES_LON = [-150, -120, -90, -60, -30, 0, 30, 60, 90, 120, 150];

interface Pin {
  region: Exclude<Region, 'GLOBAL'>;
  x: number;
  y: number;
  count: number;
}

export function WorldMapHologram() {
  const articles = useStore((s) => s.articles);
  const setRegionFilter = useStore((s) => s.setRegionFilter);
  const [openRegion, setOpenRegion] = useState<Region | null>(null);

  const { pins, globalCount } = useMemo(() => {
    const counts = new Map<Region, number>();
    for (const a of articles) counts.set(a.region, (counts.get(a.region) ?? 0) + 1);

    const list: Pin[] = ALL_REGIONS
      .filter((r): r is Exclude<Region, 'GLOBAL'> => r !== 'GLOBAL')
      .filter((r) => (counts.get(r) ?? 0) > 0)
      .map((r) => {
        const { lat, lon } = REGION_COORDS[r];
        const { x, y } = project(lat, lon);
        return { region: r, x, y, count: counts.get(r) ?? 0 };
      });

    return { pins: list, globalCount: counts.get('GLOBAL') ?? 0 };
  }, [articles]);

  const detailArticles = useMemo(() => {
    if (!openRegion) return [];
    return [...articles]
      .filter((a) => a.region === openRegion)
      .sort((a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime())
      .slice(0, 4);
  }, [articles, openRegion]);

  const openPin = pins.find((p) => p.region === openRegion) ?? null;

  const handlePinClick = (region: Region) => {
    setRegionFilter(region);
    setOpenRegion((cur) => (cur === region ? null : region));
  };

  return (
    <HexPanel title="Global Theater" meta={`${pins.length} ACTIVE`} scroll={false}>
      <div className="wmh-root" onClick={() => setOpenRegion(null)}>
        <style>{`
          .wmh-root {
            position: relative;
            width: 100%;
            height: 100%;
            min-height: 260px;
            flex: 1 1 auto;
            overflow: hidden;
            background:
              radial-gradient(ellipse 70% 60% at 50% 45%, rgba(0,217,255,0.08), transparent 70%),
              var(--panel-solid);
          }
          .wmh-svg { position: relative; width: 100%; height: 100%; display: block; z-index: 1; }
          .wmh-continent {
            fill: rgba(0,217,255,0.08);
            stroke: var(--cyan);
            stroke-width: 1.1;
            filter: drop-shadow(0 0 4px var(--cyan-35));
            animation: wmh-continent-pulse 5s ease-in-out infinite;
          }
          @keyframes wmh-continent-pulse {
            0%, 100% { stroke-opacity: 0.55; fill-opacity: 1; }
            50%      { stroke-opacity: 1;    fill-opacity: 1.6; }
          }
          .wmh-grid { stroke: var(--cyan-20); stroke-width: 0.6; }
          .wmh-frame { fill: none; stroke: var(--cyan-35); stroke-width: 1; }
          .wmh-sweep {
            fill: url(#wmh-sweep-gradient);
            transform: translateX(-120%);
            animation: wmh-sweep-move 6s linear infinite;
          }
          @keyframes wmh-sweep-move {
            from { transform: translateX(-120%); }
            to   { transform: translateX(120%); }
          }
          .wmh-pin { cursor: pointer; opacity: 0; animation: wmh-pin-in 0.5s ease-out forwards; }
          @keyframes wmh-pin-in {
            from { opacity: 0; transform: scale(0.3); }
            to   { opacity: 1; transform: scale(1); }
          }
          .wmh-pin-ring {
            fill: none;
            stroke: var(--cyan);
            stroke-width: 1.4;
            transform-origin: center;
            transform-box: fill-box;
            animation: wmh-ring-pulse 2.2s ease-out infinite;
          }
          @keyframes wmh-ring-pulse {
            0%   { transform: scale(0.4); opacity: 0.9; }
            75%  { transform: scale(2.4); opacity: 0; }
            100% { transform: scale(2.4); opacity: 0; }
          }
          .wmh-pin-dot {
            fill: var(--cyan);
            filter: drop-shadow(0 0 6px var(--cyan)) drop-shadow(0 0 2px var(--white));
          }
          .wmh-pin:hover .wmh-pin-dot { fill: var(--white); }
          .wmh-pin-badge-bg { fill: var(--void); stroke: var(--cyan-55); stroke-width: 0.8; }
          .wmh-pin-badge-text {
            fill: var(--cyan);
            font-family: var(--font-mono);
            font-size: 9px;
            text-anchor: middle;
            dominant-baseline: middle;
          }
          .wmh-global-note {
            position: absolute;
            left: 10px;
            bottom: 8px;
            z-index: 2;
            font-family: var(--font-mono);
            font-size: 9.5px;
            letter-spacing: 0.06em;
            color: var(--dim);
            pointer-events: none;
          }
          .wmh-card {
            position: absolute;
            z-index: 3;
            width: 208px;
            max-width: 60vw;
            transform: translate(-50%, calc(-100% - 14px)) scale(0.85);
            opacity: 0;
            animation: wmh-card-in 0.22s cubic-bezier(0.2, 0.8, 0.3, 1.2) forwards;
            background: linear-gradient(180deg, rgba(0,217,255,0.10), rgba(0,0,0,0) 40%), var(--panel);
            border: 1px solid var(--cyan-55);
            box-shadow: var(--glow-md);
            padding: 8px 10px 9px;
            clip-path: polygon(0 8px, 8px 0, 100% 0, 100% calc(100% - 8px), calc(100% - 8px) 100%, 0 100%);
          }
          @keyframes wmh-card-in {
            from { opacity: 0; transform: translate(-50%, calc(-100% - 14px)) scale(0.85); }
            to   { opacity: 1; transform: translate(-50%, calc(-100% - 20px)) scale(1); }
          }
          .wmh-card__title {
            font-family: var(--font-display);
            font-size: 9px;
            font-weight: 700;
            letter-spacing: 0.16em;
            text-transform: uppercase;
            color: var(--cyan);
            text-shadow: var(--text-glow);
            margin-bottom: 6px;
          }
          .wmh-card__item {
            font-family: var(--font-ui);
            font-size: 11px;
            line-height: 1.35;
            color: var(--white);
            padding: 4px 0;
            border-top: 1px solid var(--cyan-20);
          }
          .wmh-card__item:first-of-type { border-top: none; }
        `}</style>

        <svg className="wmh-svg" viewBox={`0 0 ${VIEW_W} ${VIEW_H}`} preserveAspectRatio="xMidYMid meet">
          <defs>
            <linearGradient id="wmh-sweep-gradient" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor="rgba(0,217,255,0)" />
              <stop offset="50%" stopColor="rgba(0,217,255,0.16)" />
              <stop offset="100%" stopColor="rgba(0,217,255,0)" />
            </linearGradient>
          </defs>

          {/* lat/lon wireframe */}
          {GRID_LINES_LAT.map((lat) => {
            const { y } = project(lat, 0);
            return <line key={`lat${lat}`} className="wmh-grid" x1={0} y1={y} x2={VIEW_W} y2={y} />;
          })}
          {GRID_LINES_LON.map((lon) => {
            const { x } = project(0, lon);
            return <line key={`lon${lon}`} className="wmh-grid" x1={x} y1={0} x2={x} y2={VIEW_H} />;
          })}

          {/* continents */}
          {CONTINENTS.map((d, i) => (
            <path key={i} className="wmh-continent" d={d} style={{ animationDelay: `${i * 260}ms` }} />
          ))}

          {/* animated scan sweep */}
          <rect className="wmh-sweep" x={0} y={0} width={VIEW_W * 0.28} height={VIEW_H} />

          {/* outer frame */}
          <rect className="wmh-frame" x={2} y={2} width={VIEW_W - 4} height={VIEW_H - 4} />

          {/* region beacons */}
          {pins.map((p, i) => (
            <g
              key={p.region}
              className="wmh-pin"
              transform={`translate(${p.x},${p.y})`}
              style={{ animationDelay: `${i * 90}ms` }}
              onClick={(e) => { e.stopPropagation(); handlePinClick(p.region); }}
            >
              <circle className="wmh-pin-ring" r={7} />
              <circle className="wmh-pin-dot" r={3.4} />
              <circle className="wmh-pin-badge-bg" cx={12} cy={-10} r={8} />
              <text className="wmh-pin-badge-text" x={12} y={-9.5}>{p.count}</text>
            </g>
          ))}
        </svg>

        {globalCount > 0 && (
          <div className="wmh-global-note">GLOBAL {globalCount} - not regionally mapped</div>
        )}

        {openPin && (
          <div
            className="wmh-card"
            style={{ left: `${(openPin.x / VIEW_W) * 100}%`, top: `${(openPin.y / VIEW_H) * 100}%` }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="wmh-card__title">{openPin.region}</div>
            {detailArticles.length === 0 ? (
              <div className="wmh-card__item" style={{ color: 'var(--dim)' }}>No articles.</div>
            ) : (
              detailArticles.map((a) => (
                <div key={a.id} className="wmh-card__item">{a.title}</div>
              ))
            )}
          </div>
        )}
      </div>
    </HexPanel>
  );
}
