// Far landmarks on the map (readability §2): which landmarks the player knows about and their
// names. Derived, no saved state: the home gas giant is always known (it is the sky over home), the
// others once the player has flown within sight of them – an explored chunk within
// LANDMARK_SEEN_RANGE of the anchor (sectors spec 5.1: "seen from flight"). A landmark also belongs to
// the sector its anchor lies in (sectors spec 5.3): it is on the map as soon as that sector is
// Reported or Charted. Nothing moves – the sites stay those of `landmarkSites`.
import { tx } from '../../i18n';
import type { Vec2 } from '../../sim/math/vec2';
import { sectorIdAt } from '../../sim/regions/sectors';
import { CHUNK_SIZE } from '../../sim/world/chunks';
import { landmarkSites, type LandmarkKind, type LandmarkSite } from '../../sim/world/landmarks';

/** An explored chunk this close to a landmark's anchor means the player has seen it (world units). */
export const LANDMARK_SEEN_RANGE = 2500;

/** A landmark on the map. */
export interface MapLandmark {
  id: string;
  kind: LandmarkKind;
  pos: Vec2;
  name: string;
}

const centreOf = (key: string): Vec2 | null => {
  const i = key.indexOf(',');
  if (i < 0) return null;
  const cx = Number(key.slice(0, i));
  const cy = Number(key.slice(i + 1));
  return Number.isFinite(cx) && Number.isFinite(cy) ? { x: (cx + 0.5) * CHUNK_SIZE, y: (cy + 0.5) * CHUNK_SIZE } : null;
};

/** The sites the player has seen (pure): the gas giant always, the rest from the explored chunks. */
export function seenLandmarks(sites: readonly LandmarkSite[], explored: Iterable<string>): LandmarkSite[] {
  const left = sites.filter((s) => s.kind !== 'gas_giant');
  const seen = new Set<string>(sites.filter((s) => s.kind === 'gas_giant').map((s) => s.id));
  const r2 = LANDMARK_SEEN_RANGE * LANDMARK_SEEN_RANGE;
  for (const key of explored) {
    if (seen.size === sites.length) break;
    const c = centreOf(key);
    if (!c) continue;
    for (const s of left) {
      if (seen.has(s.id)) continue;
      const dx = s.pos.x - c.x;
      const dy = s.pos.y - c.y;
      if (dx * dx + dy * dy <= r2) seen.add(s.id);
    }
  }
  return sites.filter((s) => seen.has(s.id));
}

let memo: { seed: number; explored: number; sites: LandmarkSite[] } | null = null;

/** The sector a landmark belongs to: the one its anchor lies in (sectors spec 5.3). */
export const landmarkSector = (seed: number, site: Pick<LandmarkSite, 'pos'>): string => sectorIdAt(seed, site.pos.x, site.pos.y);

/**
 * Map entries for the current game (the sight test is recomputed only when a chunk is explored; names
 * in the current language). `knownSector`: is a sector Reported or Charted – its landmark shows too.
 */
export function mapLandmarks(seed: number, explored: ReadonlySet<string>, knownSector?: (sectorId: string) => boolean): MapLandmark[] {
  if (!memo || memo.seed !== seed || memo.explored !== explored.size) memo = { seed, explored: explored.size, sites: seenLandmarks(landmarkSites(seed), explored) };
  const seen = memo.sites;
  const sites = knownSector ? landmarkSites(seed).filter((s) => seen.includes(s) || knownSector(landmarkSector(seed, s))) : seen;
  const names = tx().landmarks.names;
  return sites.map((s) => ({ id: s.id, kind: s.kind, pos: s.pos, name: names[s.kind] }));
}
