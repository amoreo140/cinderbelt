// Sector adjacency (§2.5): a pure function of the field. Candidates are the seeds around a sector;
// a pair is adjacent when its radical line (where d² − w is equal for both) has a sample on a fixed
// 50 u grid that no third seed owns. The grid is anchored on the pair's axis, so the result is the
// same from either side, independent of call order and of any map state. Adjacency is decided in
// q-space (the unwarped power diagram); the warp is a smooth displacement, so neighbours stay neighbours.
import type { RegionField, RegionSeed } from './field';

const SAMPLE_STEP = 50;

/** Do seeds a and b share a border (≥ one 50 u sample)? Symmetric. */
export function sharesBorder(field: RegionField, a: RegionSeed, b: RegionSeed): boolean {
  if (a.key === b.key) return false;
  // canonical order so both directions run the very same arithmetic
  const [i, j] = a.key < b.key ? [a, b] : [b, a];
  const dx = j.x - i.x;
  const dy = j.y - i.y;
  const d = Math.hypot(dx, dy);
  if (d < 1e-9) return false;
  const ux = dx / d;
  const uy = dy / d;
  // point on the axis where the power distances are equal
  const t = (d * d + i.weight - j.weight) / (2 * d);
  const bx = i.x + ux * t;
  const by = i.y + uy * t;
  const vx = -uy;
  const vy = ux;
  const reach = d + 3 * Math.max(i.spacing, j.spacing);
  const steps = Math.ceil(reach / SAMPLE_STEP);
  for (let k = 0; k <= steps; k++) {
    for (const sgn of k === 0 ? [1] : [1, -1]) {
      const px = bx + vx * k * SAMPLE_STEP * sgn;
      const py = by + vy * k * SAMPLE_STEP * sgn;
      const owner = field.ownerAtQ(px, py);
      if (owner.key === i.key || owner.key === j.key) return true;
    }
  }
  return false;
}

/** Neighbours of a sector, sorted by key. */
export function neighbours(field: RegionField, seed: RegionSeed): RegionSeed[] {
  const r = Math.hypot(seed.x, seed.y);
  const reach = 3 * Math.max(seed.spacing, field.source.spacingAt(r + 3 * seed.spacing));
  const around = field.source.seedsInBox(seed.x - reach, seed.y - reach, seed.x + reach, seed.y + reach);
  return around.filter((s) => s.key !== seed.key && sharesBorder(field, seed, s)).sort((a, b) => a.key - b.key);
}

/** Adjacency of a set of sectors as id → sorted neighbour ids (neighbours outside the set included). */
export function adjacencyGraph(field: RegionField, seeds: readonly RegionSeed[]): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const s of [...seeds].sort((a, b) => a.key - b.key)) out.set(s.id, neighbours(field, s).map((n) => n.id));
  return out;
}

/** The fixed sample step of the border check (u). */
export const ADJACENCY_SAMPLE_STEP = SAMPLE_STEP;
