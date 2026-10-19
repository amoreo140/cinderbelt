import { describe, expect, it } from 'vitest';
import {
  BED_KEEP_OUT,
  bedRockClear,
  BED_MAX_TILT,
  BED_TOP_CLEARANCE,
  bedRocks,
  beltFields,
  depthPick,
  depthSetIds,
  FIELD_MIN_ROCKS,
  parseSceneryManifest,
  pickShare,
  rubbleIndex,
  type BeltField,
  type FieldRock,
  type SceneryManifest,
} from './scenery';
import { nodeFs } from '../../testing/nodeFs';

const readFileSync = (path: string, enc: 'utf8') => nodeFs().readFileSync(path, enc);

const manifest = parseSceneryManifest(JSON.parse(readFileSync('public/assets/models/scenery/scenery.json', 'utf8'))) as SceneryManifest;

describe('scenery manifest', () => {
  it('parses the shipped manifest with the four depth sets, the bed and the rubble', () => {
    expect(manifest).not.toBeNull();
    expect(depthSetIds(manifest).sort()).toEqual(['crystal', 'obsidian', 'rocks', 'scrap']);
    expect(manifest.sets.rubble!.meshes).toHaveLength(8);
    expect(Object.keys(manifest.bed.meshesByResource)).toEqual(expect.arrayContaining(['iron', 'copper', 'ice', 'titanium']));
    expect(manifest.depth.setScale.rocks).toBeGreaterThan(1);
  });

  it('rejects malformed manifests', () => {
    expect(parseSceneryManifest(null)).toBeNull();
    expect(parseSceneryManifest({ sets: {} })).toBeNull();
    expect(parseSceneryManifest({ ...JSON.parse(readFileSync('public/assets/models/scenery/scenery.json', 'utf8')), bed: { radius: 3 } })).toBeNull();
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

/** A ring of `n` rocks around (x, y) in chunk `chunk`, ids from `first`. */
function cluster(chunk: string, first: number, x: number, y: number, n: number, resource: string, spread = 10): FieldRock[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `${chunk}:${first + i}`,
    pos: { x: x + Math.cos(i * 2.4) * spread * ((i % 3) + 1) / 3, y: y + Math.sin(i * 2.4) * spread * ((i % 3) + 1) / 3 },
    baseRadius: 1 + (i % 4),
    resource,
  }));
}

describe('belt fields', () => {
  const rocks = [...cluster('0,0', 0, 60, 60, 8, 'iron'), ...cluster('0,0', 8, 160, 150, 6, 'ice'), ...cluster('1,0', 0, 260, 40, 5, 'copper')];

  it('joins the asteroids of a chunk by distance', () => {
    const fields = beltFields(rocks);
    expect(fields).toHaveLength(3);
    expect(fields.map((f) => f.id)).toEqual(['0,0:0', '0,0:8', '1,0:0']);
    expect(fields.map((f) => f.resource)).toEqual(['iron', 'ice', 'copper']);
    expect(fields[0]!.rocks).toBe(8);
    expect(fields[0]!.center.x).toBeCloseTo(60, -1);
    expect(fields[0]!.radius).toBeGreaterThan(5);
  });

  it('never joins fields across chunks and ignores the input order', () => {
    const near = [...cluster('0,0', 0, 199, 50, 5, 'iron'), ...cluster('1,0', 0, 201, 50, 5, 'iron')];
    expect(beltFields(near)).toHaveLength(2);
    expect(beltFields([...rocks].reverse())).toEqual(beltFields(rocks));
  });

  it('takes the resource with the most rock mass', () => {
    const mixed: FieldRock[] = [
      { id: '0,0:0', pos: { x: 0, y: 0 }, baseRadius: 4, resource: 'titanium' },
      { id: '0,0:1', pos: { x: 5, y: 0 }, baseRadius: 1, resource: 'iron' },
      { id: '0,0:2', pos: { x: 0, y: 5 }, baseRadius: 1, resource: 'iron' },
    ];
    expect(beltFields(mixed)[0]!.resource).toBe('titanium');
  });
});

describe('bed rocks', () => {
  const field = (id: string, radius: number, resource = 'iron', rocks = 12): BeltField => ({ id, center: { x: 400, y: -250 }, radius, resource, rocks });

  it('places 3–8 rocks of the field resource inside the depth band, tops ≥ 3 below the plane', () => {
    let total = 0;
    for (let i = 0; i < 200; i++) {
      const f = field(`${i},3:0`, 10 + (i % 40), ['iron', 'copper', 'ice', 'titanium'][i % 4]!);
      const bed = bedRocks(f, manifest.bed);
      expect(bed.length).toBeGreaterThanOrEqual(manifest.bed.count[0] - 1); // a crowded spot may be skipped
      expect(bed.length).toBeLessThanOrEqual(manifest.bed.count[1]);
      total += bed.length;
      for (const r of bed) {
        expect(r.mesh.startsWith(`Bed_${f.resource}_`)).toBe(true);
        expect(r.scale).toBeGreaterThanOrEqual(manifest.bed.radius[0]);
        expect(r.scale).toBeLessThanOrEqual(manifest.bed.radius[1]);
        expect(-r.y).toBeGreaterThanOrEqual(manifest.bed.depthBelowPlane[0]);
        expect(-r.y).toBeLessThanOrEqual(manifest.bed.depthBelowPlane[1]);
        expect(r.y + r.scale).toBeLessThanOrEqual(-BED_TOP_CLEARANCE + 1e-9);
        expect(Math.hypot(r.tiltX, r.tiltZ)).toBeLessThanOrEqual(BED_MAX_TILT + 1e-9);
        // north shift: undo it and the rock lies over the field footprint (+30 %)
        const z0 = r.z - manifest.bed.northShiftPerDepth * r.y;
        expect(Math.hypot(r.x - f.center.x, -z0 - f.center.y)).toBeLessThanOrEqual(f.radius * 1.3 + 1e-6);
      }
    }
    expect(total / 200).toBeGreaterThan(4);
  });

  it('is deterministic per field and differs between fields', () => {
    expect(bedRocks(field('2,2:4', 30), manifest.bed)).toEqual(bedRocks(field('2,2:4', 30), manifest.bed));
    expect(bedRocks(field('2,2:4', 30), manifest.bed)).not.toEqual(bedRocks(field('2,2:5', 30), manifest.bed));
  });

  it('puts bigger fields on more rocks and respects the quality density', () => {
    let small = 0;
    let big = 0;
    let low = 0;
    for (let i = 0; i < 100; i++) {
      small += bedRocks(field(`s${i}`, 10), manifest.bed).length;
      big += bedRocks(field(`s${i}`, 50), manifest.bed).length;
      low += bedRocks(field(`s${i}`, 50), manifest.bed, 0.5).length;
    }
    expect(big).toBeGreaterThan(small);
    expect(low).toBeLessThan(big * 0.6);
    expect(bedRocks(field('a', 40), manifest.bed, 0)).toEqual([]);
    expect(bedRocks(field('a', 40, 'iron', FIELD_MIN_ROCKS - 1), manifest.bed)).toEqual([]);
  });

  it('keeps out from under the field asteroids (they would read as one giant rock)', () => {
    const rocks = cluster('5,5', 0, 1000, 1000, 14, 'ice', 16);
    const f = beltFields(rocks)[0]!;
    expect(f.members).toHaveLength(14);
    let placed = 0;
    for (let i = 0; i < 40; i++) {
      for (const r of bedRocks({ ...f, id: `m${i}` }, manifest.bed)) {
        placed++;
        const z0 = r.z - manifest.bed.northShiftPerDepth * r.y;
        for (const m of f.members!) expect(Math.hypot(r.x - m.x, -z0 - m.y)).toBeGreaterThan(m.r + r.scale * BED_KEEP_OUT);
      }
    }
    expect(placed).toBeGreaterThan(40);
  });

  it('tells a bed rock under any asteroid (another field, another chunk) from a clear one', () => {
    const bed = bedRocks(field('c1', 30), manifest.bed);
    const r = bed[0]!;
    const k = manifest.bed.northShiftPerDepth;
    const under = { pos: { x: r.x + 1, y: -(r.z - k * r.y) }, baseRadius: 2 };
    const away = { pos: { x: r.x + 200, y: 0 }, baseRadius: 2 };
    expect(bedRockClear(r, k, [away])).toBe(true);
    expect(bedRockClear(r, k, [away, under])).toBe(false);
  });

  it('keeps the rocks of one bed apart', () => {
    for (let i = 0; i < 50; i++) {
      const bed = bedRocks(field(`k${i}`, 14), manifest.bed);
      for (let a = 0; a < bed.length; a++) {
        for (let b = a + 1; b < bed.length; b++) {
          const p = bed[a]!;
          const q = bed[b]!;
          const k = manifest.bed.northShiftPerDepth;
          const d = Math.hypot(p.x - q.x, p.y - q.y, p.z - k * p.y - (q.z - k * q.y));
          expect(d).toBeGreaterThan((p.scale + q.scale) * 0.85);
        }
      }
    }
  });
});

describe('rubble', () => {
  it('maps 0..1 onto the meshes', () => {
    expect(rubbleIndex(0, 8)).toBe(0);
    expect(rubbleIndex(0.999, 8)).toBe(7);
    expect(rubbleIndex(1, 8)).toBe(7);
  });
});
