import { useMemo, useState } from 'react';
import { geoNaturalEarth1, geoPath, geoGraticule } from 'd3-geo';
import { feature } from 'topojson-client';
import worldTopologyJson from 'world-atlas/countries-110m.json';
import { HexPanel } from './HexPanel';
import { MAJOR_CITIES, REGION_BEACON_CITY } from './majorCities';
import { useStore } from '../../state/store';
import { ALL_REGIONS } from '../../types';
import type { Region } from '../../types';

/**
 * Holographic world map, now built from real geographic data instead of
 * hand-drawn blobs:
 *
 *  - Country outlines come from `world-atlas`'s countries-110m topology
 *    (a real, if simplified, boundary dataset), converted to GeoJSON with
 *    `topojson-client` and drawn with a `d3-geo` path generator - so every
 *    country is its own individually-outlined, recognizable shape.
 *  - A curated list of ~200 major world cities (majorCities.ts) is
 *    projected with the *same* d3-geo projection and rendered as small
 *    ambient dots - real cities in their real positions, independent of
 *    whether the news feed has an article touching that place yet.
 *  - The interactive region beacons (the actual click-to-filter behavior)
 *    are unchanged in spirit from the previous version: one pulsing,
 *    clickable beacon per `Region` with at least one article, positioned
 *    at a real representative city's coordinates rather than an abstract
 *    centroid, opening a small card of that region's most recent articles.
 *
 * All topology parsing, the projection, country path strings, and city
 * projections are computed once at module load (not per render / per
 * store update) since none of it depends on component state.
 */

const VIEW_W = 1000;
const VIEW_H = 500;

// world-atlas ships a plain JSON TopoJSON topology; topojson-client and
// d3-geo don't ship types that line up perfectly with a raw JSON import,
// so we cross the untyped boundary once here (via `any`) and work with a
// well-typed local shape (CountryPath / ProjectedCity) from this point on.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const worldTopology: any = worldTopologyJson;

const countriesGeoJson = feature(worldTopology, worldTopology.objects.countries) as unknown as {
  type: 'FeatureCollection';
  features: Array<{ id?: string; properties?: { name?: string }; geometry: unknown }>;
};

// Natural Earth reads as more "planet-like" than a flat equirectangular
// grid for a HUD globe schematic, and its curvature makes the graticule
// lines below feel like a real projection rather than a plain grid.
const projection = geoNaturalEarth1().fitSize([VIEW_W, VIEW_H], countriesGeoJson as any);
const pathGenerator = geoPath(projection);

interface CountryPath { id: string; name: string; d: string }

const COUNTRY_PATHS: CountryPath[] = countriesGeoJson.features
  .map((f) => ({
    id: String(f.id ?? ''),
    name: f.properties?.name ?? 'Unknown territory',
    d: pathGenerator(f as any) ?? '',
  }))
  .filter((c) => c.d.length > 0);

// Sparse decorative graticule (30° spacing) - just enough curvature to read
// as "real projection", not so dense it fights the country outlines.
const GRATICULE_D = pathGenerator(geoGraticule().step([30, 30])() as any) ?? '';

interface ProjectedCity { name: string; country: string; region: Exclude<Region, 'GLOBAL'>; x: number; y: number }

const CITY_POINTS: ProjectedCity[] = MAJOR_CITIES.map((c) => {
  const p = projection([c.lon, c.lat]);
  return p ? { name: c.name, country: c.country, region: c.region, x: p[0], y: p[1] } : null;
}).filter((c): c is ProjectedCity => c !== null);

const REGION_BEACON_POINT: Record<Exclude<Region, 'GLOBAL'>, { x: number; y: number }> = Object.fromEntries(
  (Object.entries(REGION_BEACON_CITY) as [Exclude<Region, 'GLOBAL'>, (typeof REGION_BEACON_CITY)[Exclude<Region, 'GLOBAL'>]][]).map(
    ([region, city]) => {
      const p = projection([city.lon, city.lat]) ?? [VIEW_W / 2, VIEW_H / 2];
      return [region, { x: p[0], y: p[1] }];
    },
  ),
) as Record<Exclude<Region, 'GLOBAL'>, { x: number; y: number }>;

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
        const { x, y } = REGION_BEACON_POINT[r];
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
          .wmh-graticule { fill: none; stroke: var(--cyan-20); stroke-width: 0.5; }
          .wmh-countries { filter: url(#wmh-country-glow); }
          .wmh-country {
            fill: rgba(0,217,255,0.06);
            stroke: var(--cyan);
            stroke-width: 0.6;
            vector-effect: non-scaling-stroke;
            animation: wmh-continent-pulse 6s ease-in-out infinite;
          }
          @keyframes wmh-continent-pulse {
            0%, 100% { stroke-opacity: 0.5; fill-opacity: 1; }
            50%      { stroke-opacity: 0.95; fill-opacity: 1.6; }
          }
          .wmh-city {
            fill: var(--cyan-soft);
            opacity: 0.55;
            filter: drop-shadow(0 0 1.5px var(--cyan-55));
          }
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
          .wmh-compass {
            transform-origin: center;
            animation: wmh-compass-spin 40s linear infinite;
            opacity: 0.5;
          }
          @keyframes wmh-compass-spin {
            to { transform: rotate(360deg); }
          }
          .wmh-compass-ring { fill: none; stroke: var(--cyan-35); stroke-width: 0.8; }
          .wmh-compass-tick { stroke: var(--cyan-55); stroke-width: 1; }
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
          .wmh-readout {
            position: absolute;
            z-index: 2;
            font-family: var(--font-mono);
            font-size: 8.5px;
            letter-spacing: 0.08em;
            color: var(--dim);
            pointer-events: none;
            text-shadow: 0 0 6px rgba(0,217,255,0.25);
          }
          .wmh-readout--tl { left: 10px; top: 8px; }
          .wmh-readout--tr { right: 10px; top: 8px; text-align: right; }
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
            <filter id="wmh-country-glow" x="-20%" y="-20%" width="140%" height="140%">
              <feGaussianBlur stdDeviation="1.1" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>

          {/* decorative projection graticule */}
          <path className="wmh-graticule" d={GRATICULE_D} />

          {/* real country borders */}
          <g className="wmh-countries">
            {COUNTRY_PATHS.map((c) => (
              <path key={c.id} className="wmh-country" d={c.d}>
                <title>{c.name}</title>
              </path>
            ))}
          </g>

          {/* ambient major-city dots */}
          <g className="wmh-cities">
            {CITY_POINTS.map((c) => (
              <circle key={`${c.name}-${c.country}`} className="wmh-city" cx={c.x} cy={c.y} r={0.9}>
                <title>{c.name}, {c.country}</title>
              </circle>
            ))}
          </g>

          {/* animated scan sweep */}
          <rect className="wmh-sweep" x={0} y={0} width={VIEW_W * 0.28} height={VIEW_H} />

          {/* outer frame */}
          <rect className="wmh-frame" x={2} y={2} width={VIEW_W - 4} height={VIEW_H - 4} />

          {/* slow-rotating corner compass, purely decorative */}
          <g className="wmh-compass" transform={`translate(${VIEW_W - 34},34)`}>
            <circle className="wmh-compass-ring" r={16} />
            <line className="wmh-compass-tick" x1={0} y1={-16} x2={0} y2={-11} />
            <line className="wmh-compass-tick" x1={0} y1={16} x2={0} y2={11} />
            <line className="wmh-compass-tick" x1={-16} y1={0} x2={-11} y2={0} />
            <line className="wmh-compass-tick" x1={16} y1={0} x2={11} y2={0} />
          </g>

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

        <div className="wmh-readout wmh-readout--tl">NATURAL EARTH PROJECTION</div>
        <div className="wmh-readout wmh-readout--tr">
          TRACKING {pins.length} BEACON{pins.length === 1 ? '' : 'S'}<br />
          {CITY_POINTS.length} CITIES CHARTED
        </div>

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
