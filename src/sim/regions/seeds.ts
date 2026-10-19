// Region seeds (§2.2): the two layout variants. Both are pure functions of the world seed and
// independent of the call order – a seed is found the same way wherever the query starts.
//   A – concentric seed layers: one seed per angular cell of each layer, one deterministic
//       separation pass (only the raw positions of the same and both adjacent layers matter).
//   B – blue noise: one candidate per fine grid cell, it survives when no stronger candidate lies
//       within exclusion × spacing(r) (Matern II, like `candidateAt` + `survives` in stations.ts).
// `atan2`, `sin` and `cos` only place seeds; the cell decision compares d² − w (field.ts).
import { TAU } from '../math/angle';
import { createRng } from '../math/rng';
import { hash3 } from '../world/hash';
import { ringIndexAt } from '../world/rings';
import { REGION_GEN, regionId, type Depth, type RegionVariant, type SeedLayer } from './constants';

/** One sector seed – the "centre" of a power-diagram cell. */
export interface RegionSeed {
  /** `rg:<variant>:<cell>` */
  id: string;
  /** Unique numeric key within the field: the tie-break of equal power distances (smaller wins). */
  key: number;
  x: number;
  y: number;
  depth: Depth;
  /** Power weight w (u²): the cell decision is min(d² − w). */
  weight: number;
  /** Local average seed spacing (u). */
  spacing: number;
  /** Origin (home sector). */
  origin: boolean;
}

/** A seed layout: seeds by area plus the local spacing figures the field needs. */
export interface SeedSource {
  readonly variant: RegionVariant;
  readonly origin: RegionSeed;
  /** Every seed whose position lies in the box (inclusive), in a deterministic order. */
  seedsInBox(x0: number, y0: number, x1: number, y1: number): RegionSeed[];
  /** Local average spacing at distance r from home (non-decreasing in r). */
  spacingAt(r: number): number;
  /** Guaranteed (approximate) minimum distance between seeds near r – sets the warp amplitude. */
  minDistanceAt(r: number): number;
  /** Seed by id, or null. */
  seedById(id: string): RegionSeed | null;
}

const SALT_A = 0x5e_ed_a1_17;
const SALT_B = 0x0b_1e_57_33;

/** Piecewise-linear lookup over [x, y] knots (clamped at both ends). */
export function interpolate(knots: readonly (readonly [number, number])[], x: number): number {
  if (x <= knots[0]![0]) return knots[0]![1];
  for (let i = 1; i < knots.length; i++) {
    const [x1, y1] = knots[i]!;
    if (x <= x1) {
      const [x0, y0] = knots[i - 1]!;
      return y0 + ((y1 - y0) * (x - x0)) / (x1 - x0);
    }
  }
  return knots[knots.length - 1]![1];
}

const weightOf = (u: number, spacing: number): number => (u * 2 - 1) * REGION_GEN.weight * spacing * spacing;

// ---------------------------------------------------------------------------------------------
// Variant A – layers

interface LayerDef extends SeedLayer {
  index: number;
  /** Average spacing √(area / count). */
  spacing: number;
}

const ORIGIN_KEY = -1;

function layerDef(index: number): LayerDef {
  const g = REGION_GEN.layered;
  let l: SeedLayer;
  if (index >= 1 && index <= g.layers.length) l = g.layers[index - 1]!;
  else {
    const k = index - g.layers.length - 1;
    const inner = g.outerStart + g.outerWidth * k;
    const outer = inner + g.outerWidth;
    l = { inner, outer, count: Math.max(3, Math.round((TAU * (inner + outer)) / 2 / g.outerArc)), depth: 4 };
  }
  return { ...l, index, spacing: Math.sqrt((Math.PI * (l.outer * l.outer - l.inner * l.inner)) / l.count) };
}

/** Layer index of distance r (0 = inside layer 1, i.e. the Origin's area). */
function layerIndexAt(r: number): number {
  const g = REGION_GEN.layered;
  if (r < g.layers[0]!.inner) return 0;
  for (let i = 0; i < g.layers.length; i++) if (r < g.layers[i]!.outer) return i + 1;
  return g.layers.length + 1 + Math.floor((r - g.outerStart) / g.outerWidth);
}

interface RawSeed {
  x: number;
  y: number;
  u: number;
}

class LayeredSource implements SeedSource {
  readonly variant = 'A' as const;
  readonly origin: RegionSeed;
  private readonly raw = new Map<number, RawSeed[]>();
  private readonly final = new Map<number, RegionSeed[]>();
  private readonly spacingKnots: [number, number][];

  constructor(private readonly seed: number) {
    const l1 = layerDef(1);
    this.origin = { id: regionId('A', '0'), key: ORIGIN_KEY, x: 0, y: 0, depth: 1, weight: 0, spacing: l1.spacing, origin: true };
    // spacing knots at the layer middles (enough layers to cover any practical distance)
    this.spacingKnots = [[0, l1.spacing]];
    for (let i = 1; i <= REGION_GEN.layered.layers.length + 40; i++) {
      const d = layerDef(i);
      this.spacingKnots.push([(d.inner + d.outer) / 2, d.spacing]);
    }
  }

  spacingAt(r: number): number {
    return interpolate(this.spacingKnots, r);
  }

  minDistanceAt(r: number): number {
    return REGION_GEN.layered.minSeparation * this.spacingAt(r);
  }

  private rawLayer(index: number): RawSeed[] {
    if (index < 1) return [];
    const hit = this.raw.get(index);
    if (hit) return hit;
    const g = REGION_GEN.layered;
    const d = layerDef(index);
    const rot = createRng(hash3(this.seed ^ SALT_A, index, -1))() * TAU;
    const cellAngle = TAU / d.count;
    const out: RawSeed[] = [];
    for (let i = 0; i < d.count; i++) {
      const rng = createRng(hash3(this.seed ^ SALT_A, index, i));
      const radial = g.radial[0] + rng() * (g.radial[1] - g.radial[0]);
      const r = d.inner + radial * (d.outer - d.inner);
      const jitter = (rng() * 2 - 1) * g.angularJitter;
      const a = rot + (i + 0.5 + jitter) * cellAngle;
      out.push({ x: Math.cos(a) * r, y: Math.sin(a) * r, u: rng() });
    }
    this.raw.set(index, out);
    return out;
  }

  /** Final seeds of a layer: one Jacobi separation pass over raw positions of layers index−1..index+1. */
  layer(index: number): RegionSeed[] {
    if (index < 1) return [this.origin];
    const hit = this.final.get(index);
    if (hit) return hit;
    const d = layerDef(index);
    const own = this.rawLayer(index);
    const neighbours: { x: number; y: number; spacing: number; fixed: boolean }[] = [];
    for (const j of [index - 1, index, index + 1]) {
      if (j < 1) {
        neighbours.push({ x: 0, y: 0, spacing: layerDef(1).spacing, fixed: true });
        continue;
      }
      const sj = layerDef(j).spacing;
      for (const s of this.rawLayer(j)) neighbours.push({ x: s.x, y: s.y, spacing: sj, fixed: false });
    }
    const out = own.map((s, i): RegionSeed => {
      let px = s.x;
      let py = s.y;
      for (const n of neighbours) {
        const dx = s.x - n.x;
        const dy = s.y - n.y;
        const dist = Math.hypot(dx, dy);
        if (dist < 1e-9) continue; // itself
        const theta = REGION_GEN.layered.minSeparation * Math.min(d.spacing, n.spacing);
        if (dist >= theta) continue;
        // each seed of the pair moves half the deficit (all of it against the fixed Origin)
        const push = (theta - dist) * (n.fixed ? 1 : 0.5);
        px += (dx / dist) * push;
        py += (dy / dist) * push;
      }
      return {
        id: regionId('A', `${index}.${i}`),
        key: index * 65536 + i,
        x: px,
        y: py,
        depth: d.depth,
        weight: weightOf(s.u, d.spacing),
        spacing: d.spacing,
        origin: false,
      };
    });
    this.final.set(index, out);
    return out;
  }

  seedsInBox(x0: number, y0: number, x1: number, y1: number): RegionSeed[] {
    const cx = Math.max(x0, Math.min(0, x1));
    const cy = Math.max(y0, Math.min(0, y1));
    const rMin = Math.hypot(cx, cy);
    const rMax = Math.max(Math.hypot(x0, y0), Math.hypot(x1, y0), Math.hypot(x0, y1), Math.hypot(x1, y1));
    // pushes move a seed by less than one spacing – widen the layer search by that much
    const pad = this.spacingAt(rMax);
    const lo = layerIndexAt(Math.max(0, rMin - pad));
    const hi = layerIndexAt(rMax + pad);
    const out: RegionSeed[] = [];
    for (let l = lo; l <= hi; l++) {
      for (const s of this.layer(l)) if (s.x >= x0 && s.x <= x1 && s.y >= y0 && s.y <= y1) out.push(s);
    }
    return out;
  }

  seedById(id: string): RegionSeed | null {
    if (id === this.origin.id) return this.origin;
    const m = /^rg:A:(\d+)\.(\d+)$/.exec(id);
    if (!m) return null;
    return this.layer(Number(m[1]))[Number(m[2])] ?? null;
  }
}

// ---------------------------------------------------------------------------------------------
// Variant B – blue noise

interface Candidate {
  cx: number;
  cy: number;
  x: number;
  y: number;
  priority: number;
  u: number;
}

class BlueNoiseSource implements SeedSource {
  readonly variant = 'B' as const;
  readonly origin: RegionSeed;
  private readonly candidates = new Map<number, Candidate | null>();
  private readonly survivors = new Map<number, RegionSeed | null>();

  constructor(private readonly seed: number) {
    this.origin = { id: regionId('B', '0'), key: ORIGIN_KEY, x: 0, y: 0, depth: 1, weight: 0, spacing: this.spacingAt(0), origin: true };
  }

  spacingAt(r: number): number {
    return interpolate(REGION_GEN.blueNoise.spacing, r);
  }

  minDistanceAt(r: number): number {
    return REGION_GEN.blueNoise.exclusion * this.spacingAt(r);
  }

  private cellKey = (cx: number, cy: number): number => (cx + 32768) * 65536 + (cy + 32768);

  private candidate(cx: number, cy: number): Candidate | null {
    const k = this.cellKey(cx, cy);
    const hit = this.candidates.get(k);
    if (hit !== undefined) return hit;
    const cell = REGION_GEN.blueNoise.cell;
    const rng = createRng(hash3(this.seed ^ SALT_B, cx, cy));
    const priority = rng();
    const x = (cx + rng()) * cell;
    const y = (cy + rng()) * cell;
    const u = rng();
    const c = Math.hypot(x, y) < REGION_GEN.blueNoise.originClear ? null : { cx, cy, x, y, priority, u };
    if (this.candidates.size > 200_000) this.candidates.clear();
    this.candidates.set(k, c);
    return c;
  }

  /** The surviving seed of a grid cell, or null. */
  private survivor(cx: number, cy: number): RegionSeed | null {
    const k = this.cellKey(cx, cy);
    const hit = this.survivors.get(k);
    if (hit !== undefined) return hit;
    const c = this.candidate(cx, cy);
    let result: RegionSeed | null = null;
    if (c) {
      const r = Math.hypot(c.x, c.y);
      const spacing = this.spacingAt(r);
      const excl = REGION_GEN.blueNoise.exclusion * spacing;
      const reach = Math.ceil(excl / REGION_GEN.blueNoise.cell);
      let alive = true;
      for (let dx = -reach; dx <= reach && alive; dx++) {
        for (let dy = -reach; dy <= reach; dy++) {
          if (dx === 0 && dy === 0) continue;
          const o = this.candidate(cx + dx, cy + dy);
          if (!o || o.priority > c.priority || (o.priority === c.priority && this.cellKey(o.cx, o.cy) > k)) continue;
          if (Math.hypot(o.x - c.x, o.y - c.y) < excl) {
            alive = false;
            break;
          }
        }
      }
      if (alive) {
        result = {
          id: regionId('B', `${cx},${cy}`),
          key: k,
          x: c.x,
          y: c.y,
          depth: ringIndexAt(r) as Depth,
          weight: weightOf(c.u, spacing),
          spacing,
          origin: false,
        };
      }
    }
    if (this.survivors.size > 200_000) this.survivors.clear();
    this.survivors.set(k, result);
    return result;
  }

  seedsInBox(x0: number, y0: number, x1: number, y1: number): RegionSeed[] {
    const cell = REGION_GEN.blueNoise.cell;
    const out: RegionSeed[] = [];
    if (x0 <= 0 && x1 >= 0 && y0 <= 0 && y1 >= 0) out.push(this.origin);
    const cx0 = Math.floor(x0 / cell);
    const cx1 = Math.floor(x1 / cell);
    const cy0 = Math.floor(y0 / cell);
    const cy1 = Math.floor(y1 / cell);
    for (let cx = cx0; cx <= cx1; cx++) {
      for (let cy = cy0; cy <= cy1; cy++) {
        const s = this.survivor(cx, cy);
        if (s && s.x >= x0 && s.x <= x1 && s.y >= y0 && s.y <= y1) out.push(s);
      }
    }
    return out;
  }

  seedById(id: string): RegionSeed | null {
    if (id === this.origin.id) return this.origin;
    const m = /^rg:B:(-?\d+),(-?\d+)$/.exec(id);
    return m ? this.survivor(Number(m[1]), Number(m[2])) : null;
  }
}

/** A fresh seed source of the variant (callers cache it – see field.ts). */
export function createSeedSource(seed: number, variant: RegionVariant): SeedSource {
  return variant === 'A' ? new LayeredSource(seed) : new BlueNoiseSource(seed);
}
