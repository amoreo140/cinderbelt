// Ore grade (purity) of asteroids – Mining 2.0 (plan). Every rock has a grade
// (60–160 %) that multiplies the ore it yields; it is a pure function of the world seed and the
// rock's id (the ring comes from the chunk in the id), so nothing about it is saved. What the
// player knows about grades – which chunks the scanner assayed – lives in MiningState.assayed.
import { GRADE_TABLES, ORE } from '../../data/ore';
import type { RingIndex } from '../../data/economy';
import { fnv1a32 } from '../math/fnv1a';
import { length, type Vec2 } from '../math/vec2';
import { CHUNK_SIZE, chunkCoord, chunkKey } from '../world/chunks';
import { FRAGMENT_MARK } from '../world/fragments';
import { hash3 } from '../world/hash';
import { ringIndexAt } from '../world/rings';

const GRADE_SALT = 0x6a7d_e011;

type RockRef = { id: string; pos: Vec2 };

/** Id of the generated rock (an ice fragment `id~k` keeps its parent's id). */
const baseId = (id: string): string => {
  const i = id.indexOf(FRAGMENT_MARK);
  return i < 0 ? id : id.slice(0, i);
};

/** Chunk coordinates from a generated id `cx,cy:n`, or null (ids of test generators). */
function chunkOfId(id: string): { cx: number; cy: number } | null {
  const m = /^(-?\d+),(-?\d+):/.exec(id);
  return m ? { cx: Number(m[1]), cy: Number(m[2]) } : null;
}

/** Key of the chunk the rock was generated in (by its id, else by its position). */
export function chunkOfAsteroid(a: RockRef): string {
  const c = chunkOfId(baseId(a.id));
  return c ? chunkKey(c.cx, c.cy) : chunkKey(chunkCoord(a.pos.x), chunkCoord(a.pos.y));
}

/** Ring of the rock's chunk centre (by its id, else by its position). */
export function ringOfAsteroid(a: RockRef): RingIndex {
  const c = chunkOfId(baseId(a.id));
  const centre = c ? { x: (c.cx + 0.5) * CHUNK_SIZE, y: (c.cy + 0.5) * CHUNK_SIZE } : a.pos;
  return ringIndexAt(length(centre));
}

/** Grade of the rock (yield multiplier, 1 = 100 %). */
export function oreGrade(seed: number, a: RockRef): number {
  const id = baseId(a.id);
  const ring = ringOfAsteroid(a);
  const table = GRADE_TABLES[ring];
  let pick = (hash3(seed ^ GRADE_SALT, fnv1a32(id), ring) / 4294967296) * 1000;
  for (const step of table) {
    pick -= step.weight;
    if (pick < 0) return step.grade;
  }
  return table[table.length - 1]!.grade;
}

export const isRich = (grade: number): boolean => grade >= ORE.richGrade - 1e-9;
export const isPoor = (grade: number): boolean => grade < ORE.poorGrade - 1e-9;

/** Keys of the chunks a circle (scanner reach) touches – their rocks get assayed. */
export function assayChunksAround(pos: Vec2, radius: number): string[] {
  const out: string[] = [];
  const x0 = chunkCoord(pos.x - radius);
  const x1 = chunkCoord(pos.x + radius);
  const y0 = chunkCoord(pos.y - radius);
  const y1 = chunkCoord(pos.y + radius);
  for (let cx = x0; cx <= x1; cx++) {
    for (let cy = y0; cy <= y1; cy++) {
      // nearest point of the chunk square to the centre
      const nx = Math.max(cx * CHUNK_SIZE, Math.min(pos.x, (cx + 1) * CHUNK_SIZE));
      const ny = Math.max(cy * CHUNK_SIZE, Math.min(pos.y, (cy + 1) * CHUNK_SIZE));
      if (Math.hypot(nx - pos.x, ny - pos.y) <= radius) out.push(chunkKey(cx, cy));
    }
  }
  return out;
}
