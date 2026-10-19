import type { RingIndex } from '../../data/economy';
import { RESOURCE_IDS, type ResourceId } from '../../data/resources';

export type ResourceWeights = Record<ResourceId, number>;

export interface RingDef {
  index: RingIndex;
  inner: number;
  outer: number;
  /** Average number of asteroid clusters per chunk. */
  clusterDensity: number;
  weights: Partial<ResourceWeights>;
}

/** The rings. Crystals and exotic matter arrive in M5/M6. */
export const RINGS: readonly RingDef[] = [
  { index: 1, inner: 0, outer: 1500, clusterDensity: 1.2, weights: { iron: 0.5, copper: 0.3, ice: 0.2 } },
  { index: 2, inner: 1500, outer: 4000, clusterDensity: 1.6, weights: { iron: 0.25, copper: 0.15, ice: 0.3, titanium: 0.3 } },
  { index: 3, inner: 4000, outer: 8000, clusterDensity: 1.6, weights: { iron: 0.3, ice: 0.3, titanium: 0.4 } },
  { index: 4, inner: 8000, outer: Infinity, clusterDensity: 1.6, weights: { iron: 0.3, ice: 0.3, titanium: 0.4 } },
];

/** Width of the smooth transition around the border (±10% of its radius). */
const BLEND = 0.1;

/**
 * Distance from which a resource may appear: the inner edge of the first ring that has it. A
 * resource of an outer ring (titanium) never reaches inwards – ring 1 has no titanium, not even in
 * the blend zone (bot report: the "pirate-free titanium belt" at 1350–1500 u).
 */
export function resourceMinDistance(resource: ResourceId): number {
  for (const ring of RINGS) if ((ring.weights[resource] ?? 0) > 0) return ring.inner;
  return Infinity;
}

/** May an asteroid of this resource lie at this distance from the centre? */
export const resourceAllowedAt = (distance: number, resource: ResourceId): boolean => distance >= resourceMinDistance(resource);

export function ringIndexAt(distance: number): RingIndex {
  for (const ring of RINGS) if (distance < ring.outer) return ring.index;
  return RINGS[RINGS.length - 1]!.index;
}

export function ringAt(distance: number): RingDef {
  return RINGS[ringIndexAt(distance) - 1]!;
}

function complete(w: Partial<ResourceWeights>): ResourceWeights {
  const out = {} as ResourceWeights;
  for (const id of RESOURCE_IDS) out[id] = w[id] ?? 0;
  return out;
}

function normalize(w: ResourceWeights): ResourceWeights {
  let total = 0;
  for (const id of RESOURCE_IDS) total += w[id];
  const out = {} as ResourceWeights;
  for (const id of RESOURCE_IDS) out[id] = total > 0 ? w[id] / total : 0;
  return out;
}

export function resourceWeightsAt(distance: number): ResourceWeights {
  for (let i = 0; i < RINGS.length - 1; i++) {
    const boundary = RINGS[i]!.outer;
    const lo = boundary * (1 - BLEND);
    const hi = boundary * (1 + BLEND);
    if (distance < lo) return normalize(complete(RINGS[i]!.weights));
    if (distance < hi) {
      const t = (distance - lo) / (hi - lo);
      // a resource new in the outer ring only fades in from the border (0 at the border, full weight at hi)
      const tNew = Math.max(0, (distance - boundary) / (hi - boundary));
      const a = complete(RINGS[i]!.weights);
      const b = complete(RINGS[i + 1]!.weights);
      const mix = {} as ResourceWeights;
      for (const id of RESOURCE_IDS) mix[id] = a[id] === 0 && b[id] > 0 ? b[id] * tNew : a[id] * (1 - t) + b[id] * t;
      return normalize(mix);
    }
  }
  return normalize(complete(RINGS[RINGS.length - 1]!.weights));
}
