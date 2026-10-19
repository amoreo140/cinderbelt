import { RESOURCE_IDS, type ResourceId } from '../../data/resources';
import { createRng, type Rng } from '../math/rng';
import { length, type Vec2 } from '../math/vec2';
import { CHUNK_SIZE, chunkKey } from './chunks';
import { hash3 } from './hash';
import { resourceAllowedAt, resourceWeightsAt, ringAt, type ResourceWeights } from './rings';
import { HOME_CLEAR_RADIUS, stationAt, type StationDef } from './stations';
import { WORLD_GEN_LEGACY, type WorldGen } from './worldGen';

export { CHUNK_SIZE, chunkCoord, chunkKey } from './chunks';

/** There are no asteroids around the start (the home station). */
export const START_CLEAR_RADIUS = HOME_CLEAR_RADIUS;
/** A guaranteed iron cluster at the start – outside the free circle of the home station. */
const START_IRON_CLUSTER = { x: 75, y: 45 };

export interface Asteroid {
  id: string;
  pos: Vec2;
  baseRadius: number;
  resource: ResourceId;
  initialAmount: number;
  /** 0..1 – visual variation (rotation, shape). */
  variant: number;
}

export interface ChunkData {
  cx: number;
  cy: number;
  asteroids: Asteroid[];
  /** A station in the chunk (at most one). */
  station?: StationDef;
}

/** `gen` = the world generation (worldGen.ts); it picks the station models, nothing else of a chunk. */
export type ChunkGenerator = (seed: number, cx: number, cy: number, gen?: WorldGen) => ChunkData;

export function pickWeighted(rng: Rng, weights: ResourceWeights): ResourceId {
  let total = 0;
  for (const id of RESOURCE_IDS) total += weights[id];
  let r = rng() * total;
  for (const id of RESOURCE_IDS) {
    r -= weights[id];
    if (r < 0 && weights[id] > 0) return id;
  }
  // rounding error – the last resource with a non-zero weight
  for (let i = RESOURCE_IDS.length - 1; i >= 0; i--) {
    const id = RESOURCE_IDS[i]!;
    if (weights[id] > 0) return id;
  }
  return 'iron';
}

/** The most common resource at this distance (a replacement that draws no extra random numbers). */
function dominantAt(distance: number): ResourceId {
  const w = resourceWeightsAt(distance);
  let best: ResourceId = RESOURCE_IDS[0]!;
  for (const id of RESOURCE_IDS) if (w[id] > w[best]) best = id;
  return best;
}

/** An approximately normal distribution with centre 0 and deviation 0.5. */
const gauss = (rng: Rng): number => rng() + rng() + rng() - 1.5;

/** An asteroid cluster of a chunk: its centre and main resource. */
export interface ChunkCluster {
  center: Vec2;
  resource: ResourceId;
}

/**
 * The first draws of a chunk's random stream: its asteroid clusters (the guaranteed iron cluster at
 * the start first). Shared by `generateChunk` and `chunkClusters`, so both see the very same clusters.
 */
function drawClusters(rng: Rng, cx: number, cy: number): ChunkCluster[] {
  const origin = { x: cx * CHUNK_SIZE, y: cy * CHUNK_SIZE };
  const distance = length({ x: origin.x + CHUNK_SIZE / 2, y: origin.y + CHUNK_SIZE / 2 });
  const ring = ringAt(distance);
  const weights = resourceWeightsAt(distance);
  const clusters: ChunkCluster[] = [];
  // always iron at the start
  if (cx === 0 && cy === 0) clusters.push({ center: START_IRON_CLUSTER, resource: 'iron' });
  const count = Math.floor(rng() * (2 * ring.clusterDensity + 1));
  for (let i = 0; i < count; i++) {
    clusters.push({
      center: {
        x: origin.x + 20 + rng() * (CHUNK_SIZE - 40),
        y: origin.y + 20 + rng() * (CHUNK_SIZE - 40),
      },
      resource: pickWeighted(rng, weights),
    });
  }
  return clusters;
}

/**
 * Cluster centres and resources of chunk (cx, cy) without generating its asteroids – the light
 * function of the sectors design §6.8 (map fields, survey points). Same draws as `generateChunk`.
 */
export const chunkClusters = (seed: number, cx: number, cy: number): ChunkCluster[] => drawClusters(createRng(hash3(seed, cx, cy)), cx, cy);

export const generateChunk: ChunkGenerator = (seed, cx, cy, gen = WORLD_GEN_LEGACY) => {
  const rng = createRng(hash3(seed, cx, cy));
  const origin = { x: cx * CHUNK_SIZE, y: cy * CHUNK_SIZE };
  const distance = length({ x: origin.x + CHUNK_SIZE / 2, y: origin.y + CHUNK_SIZE / 2 });
  const weights = resourceWeightsAt(distance);
  // asteroids from neighbouring chunks may overlap the station – the 3×3 stations around are checked
  const stations: StationDef[] = [];
  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      const s = stationAt(seed, cx + dx, cy + dy, gen);
      if (s) stations.push(s);
    }
  }
  const station = stations.find((s) => s.chunk.cx === cx && s.chunk.cy === cy);

  const clusters = drawClusters(rng, cx, cy);

  const asteroids: Asteroid[] = [];
  for (const cluster of clusters) {
    const n = 6 + Math.floor(rng() * 14);
    const spread = 12 + rng() * 18;
    for (let i = 0; i < n; i++) {
      // all random values are always rolled so that skipping does not change the rest of the chunk
      const pos = { x: cluster.center.x + gauss(rng) * spread, y: cluster.center.y + gauss(rng) * spread };
      const size = rng();
      const baseRadius = 0.8 + size * size * 3.2;
      const picked = rng() < 0.85 ? cluster.resource : pickWeighted(rng, weights);
      // a cluster at a ring border must not carry titanium inwards (weights follow the chunk centre)
      const resource = resourceAllowedAt(length(pos), picked) ? picked : dominantAt(length(pos));
      const variant = rng();
      if (stations.some((s) => Math.hypot(pos.x - s.pos.x, pos.y - s.pos.y) < s.clearRadius + baseRadius)) continue;
      asteroids.push({
        id: `${chunkKey(cx, cy)}:${asteroids.length}`,
        pos,
        baseRadius,
        resource,
        initialAmount: Math.round(baseRadius * baseRadius * 25),
        variant,
      });
    }
  }
  return station ? { cx, cy, asteroids, station } : { cx, cy, asteroids };
};
