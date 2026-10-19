import { describe, expect, it } from 'vitest';
import { distressAt } from '../discovery/events';
import { poisInChunk } from '../discovery/poi';
import { ChunkMemo, chunkKey, nearChunkKey, packedChunkKey } from './chunkMemo';
import { seedKey, stationAt } from './stations';
import { WORLD_GEN_LATEST, WORLD_GEN_LEGACY } from './worldGen';

describe('ChunkMemo', () => {
  it('keys chunks by a unique number', () => {
    const keys = new Set<number>();
    for (let cx = -40; cx <= 40; cx++) for (let cy = -40; cy <= 40; cy++) keys.add(chunkKey(cx, cy));
    expect(keys.size).toBe(81 * 81);
    expect(chunkKey(-1_000_000, 999_999)).not.toBe(chunkKey(999_999, -1_000_000));
  });

  it('remembers answers per key and chunk, null included, and starts over for another key', () => {
    const memo = new ChunkMemo<string | null>(8);
    expect(memo.get(1, 0, 0)).toBeUndefined();
    memo.set(1, 0, 0, 'a');
    memo.set(1, 1, 0, null);
    expect(memo.get(1, 0, 0)).toBe('a');
    expect(memo.get(1, 1, 0)).toBeNull();
    expect(memo.get(2, 0, 0)).toBeUndefined();
    expect(memo.get(1, 0, 0)).toBeUndefined();
  });

  it('keys near chunks by a small integer and the rest apart from them (perf audit P4)', () => {
    expect(nearChunkKey(0, 0)).toBe(16_384 * 32_768 + 16_384);
    expect(nearChunkKey(-16_384, -16_384)).toBe(0);
    expect(nearChunkKey(16_383, 16_383)).toBe(2 ** 30 - 1);
    expect(nearChunkKey(16_384, 0)).toBe(-1);
    expect(nearChunkKey(0.5, 0)).toBe(-1);
    const keys = new Set<number>();
    for (const cx of [-16_385, -16_384, -3, 0, 7, 16_383, 16_384, 1_000_000]) {
      for (const cy of [-16_385, -16_384, -1, 0, 5, 16_383, 16_384, -1_000_000]) keys.add(packedChunkKey(cx, cy));
    }
    expect(keys.size).toBe(64);
    // a far chunk is remembered like a near one
    const memo = new ChunkMemo<string>(8);
    memo.set(3, 20_000, -20_000, 'far');
    memo.set(3, 1, -1, 'near');
    expect(memo.get(3, 20_000, -20_000)).toBe('far');
    expect(memo.get(3, 1, -1)).toBe('near');
    expect(memo.get(3, -20_000, 20_000)).toBeUndefined();
    expect(memo.size).toBe(2);
  });

  it('stays bounded', () => {
    const memo = new ChunkMemo<number>(16);
    for (let i = 0; i < 100; i++) memo.set(7, i, 0, i);
    expect(memo.size).toBeLessThanOrEqual(16);
  });

  it('packs a seed and an extra number only when both fit', () => {
    expect(seedKey(1337, 2, 3)).toBe(1337 * 8 + 2);
    expect(seedKey(4_294_967_295, 7, 3)).toBe(4_294_967_295 * 8 + 7);
    expect(seedKey(-1, 0, 3)).toBeNull();
    expect(seedKey(1.5, 0, 3)).toBeNull();
    expect(seedKey(1, 8, 3)).toBeNull();
  });
});

describe('memoised world generators stay pure', () => {
  it('answer exactly what a fresh computation answers, whatever the order of the questions', () => {
    const seeds = [1337, 42, 1337];
    for (const seed of seeds) {
      for (let cx = -4; cx <= 4; cx++) {
        for (let cy = -4; cy <= 4; cy++) {
          const s1 = stationAt(seed, cx, cy);
          const s2 = stationAt(seed, cx, cy, WORLD_GEN_LATEST);
          // another seed in between must not leak into the answers
          stationAt(seed + 1, cx, cy);
          expect(stationAt(seed, cx, cy)).toEqual(s1);
          expect(stationAt(seed, cx, cy, WORLD_GEN_LATEST)).toEqual(s2);
          expect(stationAt(seed, cx, cy, WORLD_GEN_LEGACY)).toEqual(s1);
          const d = distressAt(seed, cx, cy, 3);
          distressAt(seed, cx, cy, 4);
          expect(distressAt(seed, cx, cy, 3)).toEqual(d);
          const p = poisInChunk(seed, cx, cy);
          poisInChunk(seed + 7, cx, cy);
          expect(poisInChunk(seed, cx, cy)).toEqual(p);
        }
      }
    }
  });

  it('hands out the same object while it is remembered (no garbage per frame)', () => {
    expect(stationAt(1337, 0, 0)).toBe(stationAt(1337, 0, 0));
    expect(poisInChunk(1337, 5, 5)).toBe(poisInChunk(1337, 5, 5));
  });
});
