import type { Region } from '../../types';

/**
 * Approximate lat/lon centroid for each Region, used to place beacons on
 * WorldMapHologram's equirectangular projection. These are rough "pick a
 * point inside the region" coordinates, not precise geographic centroids -
 * good enough for a schematic hologram map, not for anything cartographic.
 * GLOBAL has no single point and is intentionally omitted - callers should
 * handle it separately (no pin, or a distinct indicator).
 */
export const REGION_COORDS: Record<Exclude<Region, 'GLOBAL'>, { lat: number; lon: number }> = {
  'NORTH AMERICA': { lat: 45, lon: -100 },
  EUROPE: { lat: 50, lon: 10 },
  'MIDDLE EAST': { lat: 27, lon: 45 },
  'ASIA-PACIFIC': { lat: 15, lon: 115 },
  AFRICA: { lat: 5, lon: 20 },
  'LATIN AMERICA': { lat: -15, lon: -60 },
};
