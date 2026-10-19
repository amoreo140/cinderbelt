// The far-band LOD1 of graveyard wreck batches (perf audit 2026-10-17, P2.2): meshopt simplification of
// a frozen wreck's merged meshes, in world units. Runs in the worker (wreckLodWorker.ts); the unit tests
// call it directly. Only the index changes – the LOD1 triangles reuse the LOD0 vertices, so the palette
// atlas UVs, normals and shade colours stay exactly as they are; the simplifier keeps attribute seams
// (UV islands, hard edges) and open borders, and moves no vertex. The normals weigh in: plain positional
// simplification folded the hulls' small greebles into triangles whose corners carry normals of other
// faces, and the rim light and speculars made the far wrecks visibly brighter at the band switch.
import { MeshoptSimplifier } from 'three/examples/jsm/libs/meshopt_simplifier.module.js';

/**
 * Largest geometric error of LOD1 (world units). It only draws past the far-tier switch (view distance
 * > 95, env/ShadowRig.ts), where a pixel of a 1080p view (vertical FOV 50°) is ≥ 0.084 u: 0.04 u is under
 * half a pixel – no visible pop at the switch.
 */
export const LOD1_ERROR = 0.04;
/** Weight of a normal's deviation against the positional error (per unit of the normal's components). */
export const LOD1_NORMAL_WEIGHT = 0.5;
/** A LOD1 that keeps more than this share of the triangles is not worth an index range of its own. */
export const LOD1_KEEP = 0.9;

export interface LodJob {
  /** Triangle indices of the mesh. */
  index: Uint32Array;
  /** xyz per vertex, world units. */
  positions: Float32Array;
  /** Unit normal per vertex (xyz), or none (positions only). */
  normals?: Float32Array;
}

/** LOD1 index per job (null = keep LOD0: too small a gain, or nothing to simplify). */
export async function simplifyLod(jobs: readonly LodJob[], error = LOD1_ERROR, normalWeight = LOD1_NORMAL_WEIGHT): Promise<(Uint32Array | null)[]> {
  await MeshoptSimplifier.ready;
  const weights = [normalWeight, normalWeight, normalWeight];
  return jobs.map(({ index, positions, normals }) => {
    if (index.length < 3) return null;
    const [lod] = normals
      ? MeshoptSimplifier.simplifyWithAttributes(index, positions, 3, normals, 3, weights, null, 0, error, ['ErrorAbsolute'])
      : MeshoptSimplifier.simplify(index, positions, 3, 0, error, ['ErrorAbsolute']);
    return lod.length > 0 && lod.length <= index.length * LOD1_KEEP ? lod : null;
  });
}
