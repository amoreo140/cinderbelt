// Security of sectors (§2.4): fixed elements → roll by hash(seed, regionId) → exposure balancing
// of depths 2 and 3. Pure functions over per-region raster statistics (world.ts builds them).
import { fnv1a32 } from '../math/fnv1a';
import { hash3 } from '../world/hash';
import { REGION_GEN, SECURITIES, type Depth, type Security } from './constants';

const ROLL_SALT = 0x5ec0_7a11;

/** A deterministic number in [0, 1) for (world seed, region id, purpose). */
export const regionHash = (seed: number, id: string, purpose = 0): number => hash3(seed ^ ROLL_SALT, fnv1a32(id), purpose) / 4294967296;

/** The rolled security of a sector of this depth (§2.4 table). */
export function rollSecurity(seed: number, id: string, depth: Depth): Security {
  const table = REGION_GEN.roll[depth];
  const u = regionHash(seed, id);
  let acc = 0;
  for (const s of SECURITIES) {
    acc += table[s];
    if (u < acc) return s;
  }
  // rounding of the table: the last security with a non-zero share
  for (let i = SECURITIES.length - 1; i >= 0; i--) if (table[SECURITIES[i]!] > 0) return SECURITIES[i]!;
  return 'contested';
}

/** Group multiplier of a security at a depth (§3.1): depth 1 has no groups at all. */
export const groupMultiplier = (security: Security, depth: Depth): number => (depth === 1 ? 0 : REGION_GEN.groupMult[security]);

/** What the balancing needs to know about one sector. */
export interface BalanceRegion {
  id: string;
  depth: Depth;
  /** Rastered area (u²). */
  area: number;
  /** Of that, inside a Guild Lane corridor. */
  corridorArea: number;
  security: Security;
  /** Fixed by a rule (Origin, fortress, corner) – never swapped. */
  fixed: boolean;
}

export interface ExposureReport {
  /** Area average of the group multiplier (corridor ×0.2). Target [0.95, 1.10]. */
  area: number;
  /** Cautious player: average without Pirate sectors and without corridors. Target [0.85, 1.00]. */
  cautious: number;
}

export interface BalanceReport extends ExposureReport {
  depth: Depth;
  regions: number;
  /** Ids swapped (Contested ↔ Pirate, then Guarded ↔ Contested), in order. */
  swaps: string[];
  /** Both figures inside their ranges. */
  ok: boolean;
  /** Before balancing. */
  before: ExposureReport;
  /** Area shares of the securities after balancing. */
  shares: Record<Security, number>;
}

export function exposure(regions: readonly BalanceRegion[]): ExposureReport {
  const corridor = REGION_GEN.lanes.corridorPirates;
  let areaSum = 0;
  let areaW = 0;
  let cautSum = 0;
  let cautW = 0;
  for (const r of regions) {
    const m = groupMultiplier(r.security, r.depth);
    const open = r.area - r.corridorArea;
    areaSum += open * m + r.corridorArea * m * corridor;
    areaW += r.area;
    if (r.security !== 'pirate') {
      cautSum += open * m;
      cautW += open;
    }
  }
  return { area: areaW > 0 ? areaSum / areaW : 0, cautious: cautW > 0 ? cautSum / cautW : 0 };
}

const outside = (v: number, [lo, hi]: readonly [number, number]): number => (v < lo ? lo - v : v > hi ? v - hi : 0);

const violation = (e: ExposureReport): number =>
  outside(e.area, REGION_GEN.balance.area) + outside(e.cautious, REGION_GEN.balance.cautious);


/**
 * Exposure balancing of one depth (§2.4): swaps Contested ↔ Pirate (non-fixed sectors, smallest
 * first, ties by id) while a swap reduces the distance of both figures from their ranges; when that
 * is not enough, Guarded ↔ Contested the same way. Mutates the `security` of the given regions.
 */
export function balanceDepth(depth: Depth, regions: BalanceRegion[]): BalanceReport {
  const before = exposure(regions);
  const swaps: string[] = [];
  let current = violation(before);
  for (const [a, b] of REGION_GEN.balance.phases) {
    if (current === 0) break;
    const order = regions
      .filter((r) => !r.fixed && (r.security === a || r.security === b))
      .sort((x, y) => x.area - y.area || (x.id < y.id ? -1 : x.id > y.id ? 1 : 0));
    for (let pass = 0; current > 0 && pass < order.length; pass++) {
      let improved = false;
      for (const r of order) {
        const old = r.security;
        r.security = old === a ? b : a;
        const v = violation(exposure(regions));
        if (v < current - 1e-12) {
          current = v;
          swaps.push(r.id);
          improved = true;
          if (current === 0) break;
        } else r.security = old;
      }
      if (!improved) break;
    }
  }
  const after = exposure(regions);
  const shares = { quiet: 0, guarded: 0, contested: 0, pirate: 0 } as Record<Security, number>;
  let total = 0;
  for (const r of regions) {
    shares[r.security] += r.area;
    total += r.area;
  }
  for (const s of SECURITIES) shares[s] = total > 0 ? shares[s] / total : 0;
  return { depth, regions: regions.length, swaps, ok: violation(after) === 0, before, ...after, shares };
}
