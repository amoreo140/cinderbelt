import { describe, expect, it } from 'vitest';
import { generateChunk } from '../../sim/world/generate';
import { asteroidFields, chunkClusters } from './fields';
import { oreGrade } from '../../sim/mining/grade';

describe('asteroid fields on the map', () => {
  it('groups the asteroids of explored chunks into coarse fields by dominant resource', () => {
    const seed = 1337;
    const fields = asteroidFields(seed, ['0,0', '1,0', '0,1'], () => undefined);
    expect(fields.length).toBeGreaterThan(0);
    // an iron cluster is guaranteed at the start
    const start = chunkClusters(seed, '0,0');
    expect(start.some((c) => c.resource === 'iron' && Math.hypot(c.pos.x - 75, c.pos.y - 45) < 40)).toBe(true);
    for (const f of fields) {
      expect(f.radius).toBeGreaterThan(0);
      expect(f.depleted).toBe(false);
    }
  });

  it('marks a fully mined field as depleted', () => {
    const seed = 1337;
    const ids = new Set(generateChunk(seed, 0, 0).asteroids.map((a) => a.id));
    const fields = asteroidFields(seed, ['0,0'], (id) => (ids.has(id) ? 0 : undefined));
    expect(fields.every((f) => f.depleted)).toBe(true);
  });

  it('shows the best grade of an assayed field (Mining 2.0) – mined-out rocks do not count', () => {
    const seed = 1337;
    const plain = asteroidFields(seed, ['0,0'], () => undefined);
    expect(plain.every((f) => f.grade === undefined)).toBe(true);
    const fields = asteroidFields(seed, ['0,0'], () => undefined, new Set(['0,0']));
    const clusters = chunkClusters(seed, '0,0');
    fields.forEach((f, i) => {
      const best = Math.max(...clusters[i]!.ids.map((id) => oreGrade(seed, { id, pos: f.pos })));
      expect(f.grade).toBe(best);
    });
    const ids = new Set(generateChunk(seed, 0, 0).asteroids.map((a) => a.id));
    const mined = asteroidFields(seed, ['0,0'], (id) => (ids.has(id) ? 0 : undefined), new Set(['0,0']));
    expect(mined.every((f) => f.grade === undefined)).toBe(true);
  });
});
