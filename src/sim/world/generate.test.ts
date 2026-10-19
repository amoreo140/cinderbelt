import { describe, expect, it } from 'vitest';
import { createRng } from '../math/rng';
import { length } from '../math/vec2';
import { CHUNK_SIZE, START_CLEAR_RADIUS, chunkCoord, chunkKey, generateChunk, pickWeighted } from './generate';

describe('chunk helpers', () => {
  it('computes chunk coordinates and keys', () => {
    expect(chunkCoord(0)).toBe(0);
    expect(chunkCoord(CHUNK_SIZE - 0.1)).toBe(0);
    expect(chunkCoord(-0.1)).toBe(-1);
    expect(chunkKey(-1, 2)).toBe('-1,2');
  });

  it('pickWeighted respects zero weights', () => {
    const rng = createRng(1);
    for (let i = 0; i < 200; i++) {
      expect(pickWeighted(rng, { iron: 0, copper: 0, ice: 1, titanium: 0 })).toBe('ice');
    }
  });
});

describe('generateChunk', () => {
  it('is deterministic', () => {
    expect(generateChunk(9, 3, -4)).toEqual(generateChunk(9, 3, -4));
  });

  it('differs between chunks and seeds', () => {
    expect(generateChunk(9, 3, -4)).not.toEqual(generateChunk(9, 4, -4));
    expect(generateChunk(9, 3, -4)).not.toEqual(generateChunk(10, 3, -4));
  });

  it('keeps the start area clear', () => {
    for (const [cx, cy] of [[0, 0], [-1, 0], [0, -1], [-1, -1]] as const) {
      for (const a of generateChunk(5, cx, cy).asteroids) {
        expect(length(a.pos)).toBeGreaterThanOrEqual(START_CLEAR_RADIUS + a.baseRadius);
      }
    }
  });

  it('always puts iron near the start', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const iron = generateChunk(seed, 0, 0).asteroids.filter((a) => a.resource === 'iron');
      expect(iron.length).toBeGreaterThanOrEqual(3);
    }
  });

  it('has no titanium in the home belt', () => {
    for (let cx = -3; cx <= 3; cx++) {
      for (const a of generateChunk(1, cx, 2).asteroids) expect(a.resource).not.toBe('titanium');
    }
  });

  it('puts no titanium rock inside ring 1 (< 1500 u), not even next to the border, but titanium beyond it', () => {
    // a band of chunks around the P1/P2 border (1350–1650 u) on several seeds
    let outside = 0;
    for (let seed = 1; seed <= 6; seed++) {
      for (let cx = -9; cx <= 9; cx++) {
        for (let cy = -9; cy <= 9; cy++) {
          const d = Math.hypot((cx + 0.5) * CHUNK_SIZE, (cy + 0.5) * CHUNK_SIZE);
          if (d < 1250 || d > 1750) continue;
          for (const a of generateChunk(seed, cx, cy).asteroids) {
            if (a.resource !== 'titanium') continue;
            expect(length(a.pos), `${seed} ${a.id}`).toBeGreaterThanOrEqual(1500);
            outside++;
          }
        }
      }
    }
    expect(outside).toBeGreaterThan(0);
  });

  it('produces unique ids and sane values', () => {
    const chunk = generateChunk(3, 2, 2);
    const ids = new Set(chunk.asteroids.map((a) => a.id));
    expect(ids.size).toBe(chunk.asteroids.length);
    for (const a of chunk.asteroids) {
      expect(a.id.startsWith('2,2:')).toBe(true);
      expect(a.baseRadius).toBeGreaterThanOrEqual(0.8);
      expect(a.baseRadius).toBeLessThanOrEqual(4);
      expect(a.initialAmount).toBeGreaterThan(0);
    }
  });
});
