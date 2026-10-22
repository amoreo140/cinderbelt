import { describe, expect, it } from 'vitest';
import {
  depthPick,
  depthSetIds,
  parseSceneryManifest,
  pickShare,
  rubbleIndex,
  type SceneryManifest,
} from './scenery';
import { nodeFs } from '../../testing/nodeFs';

const readFileSync = (path: string, enc: 'utf8') => nodeFs().readFileSync(path, enc);

const manifest = parseSceneryManifest(JSON.parse(readFileSync('public/assets/models/scenery/scenery.json', 'utf8'))) as SceneryManifest;

describe('scenery manifest', () => {
  it('parses the shipped manifest with the four depth sets and the rubble', () => {
    expect(manifest).not.toBeNull();
    expect(depthSetIds(manifest).sort()).toEqual(['crystal', 'obsidian', 'rocks', 'scrap']);
    expect(manifest.sets.rubble!.meshes).toHaveLength(8);
    expect(manifest.sets.bed).toBeUndefined(); // the belt bed is retired
    expect(manifest.depth.setScale.rocks).toBeGreaterThan(1);
  });

  it('rejects malformed manifests', () => {
    expect(parseSceneryManifest(null)).toBeNull();
    expect(parseSceneryManifest({ sets: {} })).toBeNull();
    expect(parseSceneryManifest({ ...JSON.parse(readFileSync('public/assets/models/scenery/scenery.json', 'utf8')), depth: { mix: 3 } })).toBeNull();
  });
});

describe('depth silhouettes', () => {
  it('picks by cumulative share', () => {
    expect(pickShare({ a: 0.25, b: 0.75 }, 0)).toBe('a');
    expect(pickShare({ a: 0.25, b: 0.75 }, 0.249)).toBe('a');
    expect(pickShare({ a: 0.25, b: 0.75 }, 0.25)).toBe('b');
    expect(pickShare({ a: 0.25, b: 0.75 }, 0.9999)).toBe('b');
    expect(pickShare({}, 0.5)).toBeNull();
  });

  it('follows mix[ring][layer] in proportion and only uses meshes of the picked set', () => {
    const N = 4000;
    for (const ring of [1, 2, 3, 4]) {
      for (let layer = 0; layer < 3; layer++) {
        const counts: Record<string, number> = {};
        for (let i = 0; i < N; i++) {
          const pick = depthPick(manifest, ring, layer, (i + 0.5) / N, ((i * 7919) % N) / N)!;
          counts[pick.set] = (counts[pick.set] ?? 0) + 1;
          expect(manifest.sets[pick.set]!.meshes.some((m) => m.name === pick.mesh)).toBe(true);
        }
        const shares = manifest.depth.mix[String(ring)]![layer]!;
        for (const [set, share] of Object.entries(shares)) expect(counts[set]! / N).toBeCloseTo(share, 2);
      }
    }
  });

  it('keeps ring 1 neutral and gives each outer ring its identity set', () => {
    const sets = (ring: number) => new Set(Array.from({ length: 100 }, (_, i) => depthPick(manifest, ring, 0, i / 100, 0.5)!.set));
    expect([...sets(1)]).toEqual(['rocks']);
    expect(sets(2).has('scrap')).toBe(true);
    expect(sets(3).has('crystal')).toBe(true);
    expect(sets(4).has('obsidian')).toBe(true);
  });

  it('is deterministic and spreads over every mesh of a set', () => {
    expect(depthPick(manifest, 3, 1, 0.8, 0.3)).toEqual(depthPick(manifest, 3, 1, 0.8, 0.3));
    const meshes = new Set(Array.from({ length: 64 }, (_, i) => depthPick(manifest, 1, 0, 0.5, i / 64)!.mesh));
    expect(meshes.size).toBe(manifest.sets.rocks!.meshes.length);
  });
});

describe('rubble', () => {
  it('maps 0..1 onto the meshes', () => {
    expect(rubbleIndex(0, 8)).toBe(0);
    expect(rubbleIndex(0.999, 8)).toBe(7);
    expect(rubbleIndex(1, 8)).toBe(7);
  });
});
