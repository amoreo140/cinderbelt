// A canonical digest of a seed's region world – everything a save may refer to (sector ids, shapes,
// security, start knowledge, lanes, survey points). The golden test of the frozen generator compares it.
import { fnv1aHex } from '../math/fnv1a';
import { sectorChunkKeys } from './chunks';
import { sectorInfo } from './sectors';
import { surveyPoints } from './survey';
import { regionWorld } from './world';

const r1 = (x: number): number => Math.round(x * 10) / 10;

/** Digest of a seed's region world and its finite sector count. */
export function regionDigest(seed: number): { sectors: number; digest: string } {
  const world = regionWorld(seed);
  const sectors = world.regions.map((r) => {
    const info = sectorInfo(seed, r.seed.id)!;
    return [
      info.id,
      info.depth,
      info.security,
      info.fixed,
      info.corner,
      info.startKnowledge,
      info.onLane,
      info.biome,
      info.name,
      [...info.landmarks],
      r1(info.anchor.x),
      r1(info.anchor.y),
      r.area,
      sectorChunkKeys(seed, info.id).length,
      surveyPoints(seed, info.id).map((p) => [r1(p.pos.x), r1(p.pos.y), p.anchor]),
    ];
  });
  const lanes = world.lanes.map((l) => [l.id, l.points.map((p) => [r1(p.x), r1(p.y)])]);
  const grid: string[] = [];
  for (let y = -9750; y <= 9750; y += 500) for (let x = -9750; x <= 9750; x += 500) grid.push(world.field.regionAt(x, y).id);
  return { sectors: sectors.length, digest: fnv1aHex(JSON.stringify({ sectors, lanes, corners: world.corners, grid })) };
}
