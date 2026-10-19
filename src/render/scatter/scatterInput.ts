// What the scatter planner needs to know about a world chunk, straight from the deterministic world
// generators (asteroids, stations, places of interest, the M4b world sites) – no simulation state, so the
// scenery of a chunk is the same in every session and before the simulation loads the chunk.
//
// The M4b sites come in as POIs (appended after the chunk's own POIs, so the wreck POIs keep their
// stream keys): a ship graveyard's 200 u field (kind 'graveyard' – the planner dresses the ones the chunk
// owns and keeps the rest clear), a derelict station's clear disc and its relays' discs ('derelict',
// 'relay' – kept clear). Every site whose discs can reach into the chunk is listed.
import { DERELICT_LAYOUTS, GRAVEYARD, RELAY_LAYOUT } from '../../data/sites';
import { poiRadius, poisInChunk } from '../../sim/discovery/poi';
import { DERELICT_EXTENT, forSitesNear } from '../../sim/sites/placement';
import { length } from '../../sim/math/vec2';
import { CHUNK_SIZE } from '../../sim/world/chunks';
import { generateChunk } from '../../sim/world/generate';
import { sectorInfoOfChunk } from '../../sim/regions/sectors';
import { ringIndexAt } from '../../sim/world/rings';
import { stationAt, type StationDef } from '../../sim/world/stations';
import { guildPickets, PICKET_CLEAR } from '../borders/borderPlan';
import { securityForRing, type ScatterChunkInput, type ScatterPoi, type ScatterSecurity } from './scatterPlan';

/** Security of a chunk (the scenery's danger input). */
export type SecurityOf = (seed: number, cx: number, cy: number, ring: number) => ScatterSecurity;
/** The old ring rule (tests, comparisons). */
export const ringSecurity: SecurityOf = (_seed, _cx, _cy, ring) => securityForRing(ring);
/**
 * The security of the chunk's sector (sectors design §3.1) – the static one of the seed, so a chunk's
 * scenery never changes once planned (a fallen fortress does not clean up its debris).
 */
export const sectorSecurityOf: SecurityOf = (seed, cx, cy) => sectorInfoOfChunk(seed, cx, cy).security;

const toStation = (s: StationDef) => ({ id: s.id, pos: s.pos, radius: s.radius, portAngle: s.portAngle });

/** Half the diagonal of a chunk: how far its centre is from its corners. */
const HALF_DIAGONAL = (CHUNK_SIZE * Math.SQRT2) / 2;

/**
 * The M4b sites whose discs can reach into chunk (cx, cy), as POIs: graveyard fields, derelict discs and
 * their relays' discs (in a fixed order: by site, the station before its relays).
 */
export function sitePois(seed: number, cx: number, cy: number): ScatterPoi[] {
  const centre = { x: (cx + 0.5) * CHUNK_SIZE, y: (cy + 0.5) * CHUNK_SIZE };
  const out: ScatterPoi[] = [];
  forSitesNear(seed, centre, HALF_DIAGONAL + Math.max(GRAVEYARD.radius, DERELICT_EXTENT), (site) => {
    if (site.kind === 'graveyard') {
      out.push({ id: site.id, kind: 'graveyard', pos: site.pos, radius: GRAVEYARD.radius });
      return;
    }
    out.push({ id: site.id, kind: 'derelict', pos: site.pos, radius: DERELICT_LAYOUTS[site.model].clearRadius });
    for (const r of site.relays) out.push({ id: r.id, kind: 'relay', pos: r.pos, radius: RELAY_LAYOUT.clearRadius });
  });
  return out;
}

export function chunkScatterInput(seed: number, cx: number, cy: number, securityOf: SecurityOf = sectorSecurityOf): ScatterChunkInput {
  const ring = ringIndexAt(length({ x: (cx + 0.5) * CHUNK_SIZE, y: (cy + 0.5) * CHUNK_SIZE }));
  const stations: ScatterChunkInput['stations'][number][] = [];
  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      const s = stationAt(seed, cx + dx, cy + dy);
      if (s) stations.push(toStation(s));
    }
  }
  const chunk = generateChunk(seed, cx, cy);
  return {
    seed,
    cx,
    cy,
    ring,
    security: securityOf(seed, cx, cy, ring),
    stations,
    rocks: chunk.asteroids.map((a) => ({ id: a.id, pos: a.pos, baseRadius: a.baseRadius, resource: a.resource })),
    pois: [...poisInChunk(seed, cx, cy).map((p) => ({ id: p.id, kind: p.kind, pos: p.pos, radius: poiRadius(p) })), ...sitePois(seed, cx, cy)],
    // the Guild pickets (sector border scenery) keep their clear radius free of clutter
    keepClear: guildPickets(seed)
      .filter((p) => Math.abs(p.pos.x - (cx + 0.5) * CHUNK_SIZE) < CHUNK_SIZE && Math.abs(p.pos.y - (cy + 0.5) * CHUNK_SIZE) < CHUNK_SIZE)
      .map((p) => ({ pos: p.pos, radius: PICKET_CLEAR })),
  };
}
