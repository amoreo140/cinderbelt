import { nearChunkKey } from './chunkMemo';

/** Side of a square world chunk. */
export const CHUNK_SIZE = 200;

/** The key strings handed out so far by near chunk (bounded): no new string per lookup. */
const keyStrings = new Map<number, string>();

/**
 * The string key of a chunk (`"cx,cy"`). Memoised for near chunks – the world's per-step queries ask for
 * the same few keys hundreds of times a step (perf audit 2026-10-17, P4); the string is the same either way.
 */
export function chunkKey(cx: number, cy: number): string {
  const k = nearChunkKey(cx, cy);
  if (k < 0) return `${cx},${cy}`;
  let s = keyStrings.get(k);
  if (s === undefined) {
    if (keyStrings.size >= 16_384) keyStrings.clear();
    s = `${cx},${cy}`;
    keyStrings.set(k, s);
  }
  return s;
}
export const chunkCoord = (v: number): number => Math.floor(v / CHUNK_SIZE);
