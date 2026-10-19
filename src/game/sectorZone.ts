// The sector zone the player is in, for the look and the sound of space (sectors design §5.2, stage 1a):
// the sky panorama, the zone light (`env`), the dust and fog colours, the depth layers, the music
// and the ambience follow the depth and the environment of the player's SECTOR, not the ring circles.
//
// UI layer, not simulation: the hysteresis only decides when the look switches. A border counts
// once the ship is `ZONE_HYSTERESIS` units past it (no point of the old sector within that radius),
// so wiggling across a border never flickers. On the first update (a new game, a loaded save) the
// zone is set silently from the position.
import type { Vec2 } from '../sim/math/vec2';
import type { Depth } from '../sim/regions/constants';
import type { RegionField } from '../sim/regions/field';
import { sectorInfo, sectorSecurity, type Biome } from '../sim/regions/sectors';
import { NO_SECURITY_OVERRIDES, regionWorld } from '../sim/regions/world';

/** How far past a sector border the zone switches (u, §5.2). */
export const ZONE_HYSTERESIS = 30;
/** Directions sampled on the hysteresis circle. */
const HYSTERESIS_SAMPLES = 8;
/** Panoramas of the depths within this distance are preloaded (u). */
export const ZONE_PRELOAD_RADIUS = 450;
/** The preload probe is recomputed when the ship moves to another cell of this size (u). */
const PRELOAD_CELL = 100;

export interface SectorZone {
  /** Sector id (`rg:<variant>:<cell>`). */
  id: string;
  depth: Depth;
  /** The sector's biome (sectors design §3.2: look and name only). */
  environment: Biome;
}

/** Look key of a zone: two sectors with the same key look and sound the same. */
export const zoneKey = (z: Pick<SectorZone, 'depth' | 'environment'>): string => `${z.depth}:${z.environment}`;

const zoneOf = (seed: number, s: { id: string; depth: Depth }): SectorZone => ({
  id: s.id,
  depth: s.depth,
  environment: sectorInfo(seed, s.id)?.biome ?? 'asteroidField',
});

/**
 * True when the point `p` lies at least `margin` past the border of sector `currentId` – no sample
 * of the circle of radius `margin` around it (nor the point itself) is in that sector.
 */
export function pastBorder(field: Pick<RegionField, 'regionAt'>, currentId: string, p: Vec2, margin = ZONE_HYSTERESIS): boolean {
  if (field.regionAt(p.x, p.y).id === currentId) return false;
  for (let k = 0; k < HYSTERESIS_SAMPLES; k++) {
    const a = (k / HYSTERESIS_SAMPLES) * Math.PI * 2;
    if (field.regionAt(p.x + Math.cos(a) * margin, p.y + Math.sin(a) * margin).id === currentId) return false;
  }
  return true;
}

/** Follows the player's sector with hysteresis; one per consumer (renderer, audio) – same input, same answer. */
export class SectorZoneTracker {
  private seed: number | null = null;
  private field: RegionField | null = null;
  private zone: SectorZone | null = null;
  private frontierOf: { id: string; secured: boolean; frontier: boolean } | null = null;
  private preload: { cell: number; depths: Depth[] } | null = null;

  /** The zone at `pos` for world `seed` (a seed change resets it). */
  update(seed: number, pos: Vec2): SectorZone {
    if (seed !== this.seed || !this.field) {
      this.reset();
      this.seed = seed;
      this.field = regionWorld(seed).field;
    }
    const here = this.field.regionAt(pos.x, pos.y);
    if (!this.zone) this.zone = zoneOf(seed, here);
    else if (here.id !== this.zone.id && pastBorder(this.field, this.zone.id, pos)) this.zone = zoneOf(seed, here);
    return this.zone;
  }

  /** The zone of the last update (null before the first one). */
  get current(): SectorZone | null {
    return this.zone;
  }

  /** Forget the zone (a new game, a loaded save): the next update sets it silently. */
  reset(): void {
    this.seed = null;
    this.field = null;
    this.zone = null;
    this.frontierOf = null;
    this.preload = null;
  }

  /**
   * The frontier music plays in an unguarded sector of depth ≥ 2 (§5.2), by the CURRENT security:
   * `secured` = the Guild-secured sectors (`securedSectors(state)`, M4d §2.1) turn Contested into
   * Guarded. Read once per sector and secured flag (a destroyed fortress turns Pirate into Contested –
   * both unguarded, so it never changes this).
   */
  frontier(secured: ReadonlySet<string> = NO_SECURITY_OVERRIDES.secured): boolean {
    const z = this.zone;
    if (!z || this.seed === null) return false;
    const isSecured = secured.has(z.id);
    if (this.frontierOf?.id === z.id && this.frontierOf.secured === isSecured) return this.frontierOf.frontier;
    const frontier = z.depth >= 2 && sectorSecurity(this.seed, z.id, { ...NO_SECURITY_OVERRIDES, secured }) !== 'guarded';
    this.frontierOf = { id: z.id, secured: isSecured, frontier };
    return frontier;
  }

  /**
   * Depths whose sky panorama should be loaded: the current zone's and those of sectors within
   * `ZONE_PRELOAD_RADIUS` (the neighbours the ship may cross into next).
   */
  depthsNear(pos: Vec2): Depth[] {
    const field = this.field;
    const zone = this.zone;
    if (!field || !zone) return [];
    const cx = Math.floor(pos.x / PRELOAD_CELL);
    const cy = Math.floor(pos.y / PRELOAD_CELL);
    const cell = (cx + 1_048_576) * 2_097_152 + (cy + 1_048_576);
    if (this.preload?.cell === cell && this.preload.depths.includes(zone.depth)) return this.preload.depths;
    const set = new Set<Depth>([zone.depth, field.regionAt(pos.x, pos.y).depth]);
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2;
      set.add(field.regionAt(pos.x + Math.cos(a) * ZONE_PRELOAD_RADIUS, pos.y + Math.sin(a) * ZONE_PRELOAD_RADIUS).depth);
    }
    const depths = [...set].sort((a, b) => a - b);
    this.preload = { cell, depths };
    return depths;
  }
}
