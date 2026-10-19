import { describe, expect, it } from 'vitest';
import { REGION_GEN, REGION_VARIANTS } from './constants';
import { freshRegionField, regionAt, regionField } from './field';
import { buildLabelTile, MAP_TILE, pointInPolygon, polygonArea, regionMask, regionPolygon } from './grid';

const SEEDS = [1, 7, 42, 1337, 90210];

/** A deterministic scatter of points over a disc. */
function scatter(n: number, radius: number, salt = 1): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = [];
  let s = salt;
  const rnd = () => {
    s = (Math.imul(s, 1103515245) + 12345) >>> 0;
    return s / 4294967296;
  };
  for (let i = 0; i < n; i++) {
    const r = Math.sqrt(rnd()) * radius;
    const a = rnd() * Math.PI * 2;
    out.push({ x: Math.cos(a) * r, y: Math.sin(a) * r });
  }
  return out;
}

describe('regionAt', () => {
  it.each(REGION_VARIANTS)('variant %s: the same seed gives the same sectors, whatever the query order', (variant) => {
    for (const seed of SEEDS.slice(0, 3)) {
      const pts = scatter(800, 12000, seed);
      const a = freshRegionField(seed, variant);
      const b = freshRegionField(seed, variant);
      const forward = pts.map((p) => a.regionAt(p.x, p.y).id);
      const backward = [...pts].reverse().map((p) => b.regionAt(p.x, p.y).id).reverse();
      expect(backward).toEqual(forward);
      // the module-level cached field agrees with fresh ones
      expect(pts.map((p) => regionAt(seed, p.x, p.y, variant).id)).toEqual(forward);
    }
  });

  it.each(REGION_VARIANTS)('variant %s: different seeds give different layouts', (variant) => {
    const pts = scatter(200, 6000);
    const a = pts.map((p) => regionAt(1, p.x, p.y, variant).id);
    const b = pts.map((p) => regionAt(2, p.x, p.y, variant).id);
    expect(a).not.toEqual(b);
  });

  it.each(REGION_VARIANTS)('variant %s: home is the Origin sector of depth 1', (variant) => {
    for (const seed of SEEDS) {
      const f = regionField(seed, variant);
      expect(f.regionAt(0, 0)).toBe(f.origin);
      expect(f.origin.origin).toBe(true);
      expect(f.origin.depth).toBe(1);
      expect(f.origin.id).toBe(`rg:${variant}:0`);
    }
  });

  it.each(REGION_VARIANTS)('variant %s: the candidate tiles never drop the true owner', (variant) => {
    // brute force over every seed in a wide box against the tile-pruned answer
    const f = freshRegionField(5, variant);
    const all = f.source.seedsInBox(-15000, -15000, 15000, 15000);
    const q = { x: 0, y: 0 };
    for (const p of scatter(400, 9000, 3)) {
      f.warp(p.x, p.y, q);
      let best = all[0]!;
      let bestP = Infinity;
      for (const s of all) {
        const d = (q.x - s.x) ** 2 + (q.y - s.y) ** 2 - s.weight;
        if (d < bestP || (d === bestP && s.key < best.key)) {
          best = s;
          bestP = d;
        }
      }
      expect(f.regionAt(p.x, p.y).id).toBe(best.id);
    }
  });

  it.each(REGION_VARIANTS)('variant %s: depth follows the seed ring (§2.2)', (variant) => {
    const f = regionField(11, variant);
    for (const s of f.source.seedsInBox(-12000, -12000, 12000, 12000)) {
      if (s.origin) continue;
      const r = Math.hypot(s.x, s.y);
      if (variant === 'B') expect(s.depth).toBe(r < 1500 ? 1 : r < 4000 ? 2 : r < 8000 ? 3 : 4);
      else expect([1, 2, 3, 4]).toContain(s.depth);
    }
  });

  it('seeds stay apart (blue noise exclusion, layered separation pass)', () => {
    for (const variant of REGION_VARIANTS) {
      const f = regionField(3, variant);
      const seeds = f.source.seedsInBox(-6000, -6000, 6000, 6000);
      let min = Infinity;
      for (let i = 0; i < seeds.length; i++)
        for (let j = i + 1; j < seeds.length; j++) min = Math.min(min, Math.hypot(seeds[i]!.x - seeds[j]!.x, seeds[i]!.y - seeds[j]!.y));
      expect(min).toBeGreaterThan(variant === 'B' ? REGION_GEN.blueNoise.exclusion * 820 - 1 : 250);
    }
  });

  it('regionOfChunk is the sector of the chunk centre and is cached', () => {
    const f = freshRegionField(9, 'B');
    for (let cx = -12; cx <= 12; cx += 3) {
      for (let cy = -12; cy <= 12; cy += 3) {
        const first = f.regionOfChunk(cx, cy);
        expect(first).toBe(f.regionAt((cx + 0.5) * 200, (cy + 0.5) * 200));
        expect(f.regionOfChunk(cx, cy)).toBe(first);
      }
    }
  });
});

describe('sector shape', () => {
  it.each(REGION_VARIANTS)('variant %s: sectors of depth 1–2 are connected (flood fill, 50 u)', (variant) => {
    for (const seed of SEEDS.slice(0, 3)) {
      const f = regionField(seed, variant);
      for (const s of f.source.seedsInBox(-4500, -4500, 4500, 4500)) {
        if (s.depth > 2) continue;
        const m = regionMask(f, s, 50);
        expect(m.filled, `${s.id} of seed ${seed}`).toBe(m.total);
        expect(m.total).toBeGreaterThan(50);
      }
    }
  });

  it.each(REGION_VARIANTS)('variant %s: regionAt agrees with the sector polygons away from borders', (variant) => {
    const seed = 21;
    const f = regionField(seed, variant);
    const seeds = f.source.seedsInBox(-3000, -3000, 3000, 3000);
    const polys = new Map(seeds.map((s) => [s.id, regionPolygon(f, s, 50)]));
    for (const poly of polys.values()) expect(polygonArea(poly)).toBeGreaterThan(0);
    let checked = 0;
    for (let y = -2400; y <= 2400; y += 70) {
      for (let x = -2400; x <= 2400; x += 70) {
        const id = f.regionAt(x, y).id;
        // interior points only: all neighbours 80 u away are in the same sector
        let interior = true;
        for (let k = 0; k < 8 && interior; k++) {
          const a = (k * Math.PI) / 4;
          if (f.regionAt(x + Math.cos(a) * 80, y + Math.sin(a) * 80).id !== id) interior = false;
        }
        if (!interior || !polys.has(id)) continue;
        checked++;
        const p = { x, y };
        expect(pointInPolygon(p, polys.get(id)!), `${id} at ${x},${y}`).toBe(true);
        for (const [other, poly] of polys) if (other !== id) expect(pointInPolygon(p, poly)).toBe(false);
      }
    }
    expect(checked).toBeGreaterThan(2000);
  });

  it('label tiles match regionAt sample by sample', () => {
    const f = regionField(4, 'B');
    for (const [tx, ty, step] of [
      [0, 0, 100],
      [-3, 2, 200],
      [1, -1, 50],
    ] as const) {
      const t = buildLabelTile(f, tx, ty, step);
      expect(t.size).toBe(MAP_TILE / step);
      for (let j = 0; j < t.size; j += 3) {
        for (let i = 0; i < t.size; i += 3) {
          const s = f.regionAt(tx * MAP_TILE + (i + 0.5) * step, ty * MAP_TILE + (j + 0.5) * step);
          expect(t.ids[t.labels[j * t.size + i]!]).toBe(s.id);
          expect(t.depths[t.labels[j * t.size + i]!]).toBe(s.depth);
        }
      }
    }
  });
});
