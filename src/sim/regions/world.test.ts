import { describe, expect, it } from 'vitest';
import { fnv1aHex } from '../math/fnv1a';
import { fortressSites } from '../pirates/sites';
import { poisNear } from '../discovery/poi';
import { CHUNK_SIZE } from '../world/chunks';
import { landmarkSites } from '../world/landmarks';
import { stationsInArea } from '../world/stations';
import { adjacencyGraph, neighbours } from './adjacency';
import { REGION_GEN, REGION_VARIANTS, type RegionVariant } from './constants';
import { regionField } from './field';
import { polylineDistance } from './lanes';
import { borderOrientation, pickVariant, startMapReport } from './metrics';
import { exposure, type BalanceRegion } from './security';
import { buildRegionWorld, currentSecurity, defaultRegionInputs, pirateGroupRate, regionWorld, securityOf } from './world';

const SEEDS = [1, 7, 42, 1337, 90210];

describe('adjacency graph', () => {
  it.each(REGION_VARIANTS)('variant %s: is symmetric', (variant) => {
    for (const seed of SEEDS) {
      const f = regionField(seed, variant);
      const seeds = f.source.seedsInBox(-4500, -4500, 4500, 4500);
      const graph = adjacencyGraph(f, seeds);
      for (const [id, list] of graph) {
        for (const n of list) {
          const back = graph.get(n) ?? neighbours(f, f.seedById(n)!).map((s) => s.id);
          expect(back, `${n} → ${id} (seed ${seed})`).toContain(id);
        }
      }
    }
  });

  it.each(REGION_VARIANTS)('variant %s: every border seen in the world is an edge of the graph', (variant) => {
    const f = regionField(7, variant);
    const touching = new Map<string, number>();
    const step = 40;
    for (let y = -3000; y < 3000; y += step) {
      for (let x = -3000; x < 3000; x += step) {
        const a = f.regionAt(x, y).id;
        for (const b of [f.regionAt(x + step, y).id, f.regionAt(x, y + step).id]) {
          if (a === b) continue;
          const key = a < b ? `${a}|${b}` : `${b}|${a}`;
          touching.set(key, (touching.get(key) ?? 0) + 1);
        }
      }
    }
    for (const [key, crossings] of touching) {
      if (crossings < 4) continue; // a border shorter than ~100 u may fall between the 50 u samples
      const [a, b] = key.split('|') as [string, string];
      expect(neighbours(f, f.seedById(a)!).map((s) => s.id), key).toContain(b);
    }
  });

  // Golden graph: a fingerprint of the adjacency of all sectors with a seed within 4 000 u.
  // REGION_GEN is still tunable (stage 0–1b): when a constant changes on purpose, update these.
  const GOLDEN: Record<RegionVariant, Record<number, string>> = {
    A: { 1: '34/5434c857', 7: '34/04b7cc93', 42: '34/f1706b24', 1337: '34/8732f904', 90210: '34/fec70af9' },
    B: { 1: '34/e40e3324', 7: '38/17e67f3d', 42: '34/c1ebf0a5', 1337: '39/0d140720', 90210: '35/e3707cfc' },
  };
  it.each(REGION_VARIANTS)('variant %s: matches the golden graph for 5 seeds', (variant) => {
    const actual: Record<number, string> = {};
    for (const seed of SEEDS) {
      const f = regionField(seed, variant);
      const seeds = f.source.seedsInBox(-4000, -4000, 4000, 4000).filter((s) => Math.hypot(s.x, s.y) < 4000);
      const lines = [...adjacencyGraph(f, seeds)].map(([id, list]) => `${id}:${list.join(',')}`);
      actual[seed] = `${seeds.length}/${fnv1aHex(lines.join(';'))}`;
    }
    expect(actual).toEqual(GOLDEN[variant]);
  });
});

describe('Guild Lanes', () => {
  it.each(REGION_VARIANTS)('variant %s: bend around fortresses and start at home', (variant) => {
    for (const seed of [...SEEDS, 2, 3, 4, 5, 6]) {
      const w = regionWorld(seed, variant);
      const forts = fortressSites(seed);
      expect(w.lanes.map((l) => l.id)).toEqual(['A', 'B']);
      for (const lane of w.lanes) {
        expect(lane.points[0]).toEqual({ x: 0, y: 0 });
        for (const f of forts) {
          // pushed points sit on the 900 u circle; long chords between them get an extra point
          expect(polylineDistance(f.pos, lane.points), `${lane.id} vs ${f.id} seed ${seed}`).toBeGreaterThan(REGION_GEN.lanes.fortressClear - 2);
          // the corridor never reaches a fortress's own clearance
          expect(polylineDistance(f.pos, lane.points) - REGION_GEN.lanes.corridor).toBeGreaterThan(600);
        }
      }
    }
  });

  it('lane A never doubles back from G1: the leg to the fortress axis heads away from home (30 seeds)', () => {
    for (let seed = 1; seed <= 30; seed++) {
      const w = regionWorld(seed, 'B');
      const a = w.lanes[0]!;
      const g1 = w.inputs.g1;
      const i = a.vertices.findIndex((v) => v.x === g1.x && v.y === g1.y);
      expect(i, `seed ${seed}`).toBeGreaterThan(0);
      // the axis point (a relay snapped onto the leg may sit in between)
      const axis = a.vertices[a.vertices.length - 2]!;
      expect((axis.x - g1.x) * g1.x + (axis.y - g1.y) * g1.y, `seed ${seed}`).toBeGreaterThan(0);
    }
  });

  it.each(REGION_VARIANTS)('variant %s: lane A ends on the depth 2/3 border, lane B at r = 3 400', (variant) => {
    for (const seed of SEEDS) {
      const w = regionWorld(seed, variant);
      const a = w.lanes[0]!;
      const end = a.vertices[a.vertices.length - 1]!;
      const r = Math.hypot(end.x, end.y);
      expect(w.field.regionAt(end.x, end.y).depth).toBeLessThanOrEqual(2);
      expect(w.field.regionAt((end.x / r) * (r + 10), (end.y / r) * (r + 10)).depth).toBe(3);
      const b = w.lanes[1]!;
      const endB = b.vertices[b.vertices.length - 1]!;
      expect(Math.hypot(endB.x, endB.y)).toBeGreaterThanOrEqual(REGION_GEN.lanes.laneBEnd - 1);
    }
  });

  it('runs through a guild_relay landmark within 400 u', () => {
    const seed = 1;
    const plain = buildRegionWorld(seed, 'B', defaultRegionInputs(seed, []));
    // a relay 300 u beside the middle of lane A's first leg
    const g1 = plain.lanes[0]!.vertices[1]!;
    const len = Math.hypot(g1.x, g1.y);
    const relay = { x: g1.x / 2 + (-g1.y / len) * 300, y: g1.y / 2 + (g1.x / len) * 300 };
    const w = buildRegionWorld(seed, 'B', defaultRegionInputs(seed, [{ id: 'guild_relay:0', kind: 'guild_relay', pos: relay }]));
    expect(w.lanes[0]!.vertices).toContainEqual(relay);
    expect(polylineDistance(relay, w.lanes[0]!.points)).toBeLessThan(1e-6);
    expect(w.landmarkRegions.get('guild_relay:0')).toBe(w.field.regionAt(relay.x, relay.y).id);
    expect(w.info(w.field.regionAt(relay.x, relay.y).id)?.landmarks).toContain('guild_relay:0');
    // a relay far away changes nothing
    const far = buildRegionWorld(seed, 'B', defaultRegionInputs(seed, [{ id: 'guild_relay:0', kind: 'guild_relay', pos: { x: -g1.x, y: -g1.y } }]));
    expect(far.lanes[0]!.vertices).toEqual(plain.lanes[0]!.vertices);
  });

  it('every landmark belongs to the sector of its anchor (landmarkSites)', () => {
    for (const variant of REGION_VARIANTS) {
      const w = regionWorld(5, variant);
      const sites = landmarkSites(5);
      expect(w.landmarkRegions.size).toBe(sites.length);
      for (const site of sites) expect(w.landmarkRegions.get(site.id)).toBe(w.field.regionAt(site.pos.x, site.pos.y).id);
    }
  });

  it('nothing in the world moves: stations, POIs, fortresses and landmarks are only read', () => {
    const seed = 77;
    const before = {
      landmarks: JSON.stringify(landmarkSites(seed)),
      forts: JSON.stringify(fortressSites(seed)),
      stations: JSON.stringify(stationsInArea(seed, -15, 15, -15, 15)),
      pois: JSON.stringify(poisNear(seed, { x: 0, y: 0 }, 3000)),
    };
    for (const variant of REGION_VARIANTS) buildRegionWorld(seed, variant, defaultRegionInputs(seed));
    expect(JSON.stringify(landmarkSites(seed))).toBe(before.landmarks);
    expect(JSON.stringify(fortressSites(seed))).toBe(before.forts);
    expect(JSON.stringify(stationsInArea(seed, -15, 15, -15, 15))).toBe(before.stations);
    expect(JSON.stringify(poisNear(seed, { x: 0, y: 0 }, 3000))).toBe(before.pois);
  });
});

describe('security', () => {
  it.each(REGION_VARIANTS)('variant %s: the world is deterministic', (variant) => {
    const a = buildRegionWorld(3, variant, defaultRegionInputs(3));
    const b = buildRegionWorld(3, variant, defaultRegionInputs(3));
    expect(a.regions.map((r) => `${r.seed.id}:${r.security}`)).toEqual(b.regions.map((r) => `${r.seed.id}:${r.security}`));
    expect(a.lanes).toEqual(b.lanes);
    expect([...a.startKnowledge]).toEqual([...b.startKnowledge]);
  });

  it.each(REGION_VARIANTS)('variant %s: home is the Guarded exception, corners follow their rules', (variant) => {
    for (const seed of SEEDS) {
      const w = regionWorld(seed, variant);
      const origin = w.info(w.field.origin.id)!;
      expect(origin.security).toBe('guarded');
      expect(origin.fixed).toBe('origin');
      expect(origin.hasStation).toBe(true); // the home station
      expect(w.startKnowledge.get(origin.seed.id)).toBe('charted');
      const c1 = w.info(w.corners.depth1!)!;
      expect(c1.seed.origin).toBe(false);
      expect(c1.seed.depth).toBe(1);
      expect(c1.security).toBe('pirate');
      expect(c1.hasStation).toBe(false);
      const c2 = w.info(w.corners.depth2!)!;
      expect(c2.seed.depth).toBe(2);
      expect(Math.hypot(c2.seed.x, c2.seed.y)).toBeLessThan(REGION_GEN.corner.depth2MaxSeedR);
      expect(c2.security).toBe('pirate');
      expect(c2.corridorArea).toBeGreaterThan(0);
      for (const r of w.regions) if (r.seed.depth === 1 && r.fixed === null) expect(['quiet', 'guarded']).toContain(r.security);
      for (const [, rid] of w.fortressRegions) expect(w.info(rid)!.security).toBe('pirate');
    }
  });

  it.each(REGION_VARIANTS)('variant %s: depths 2 and 3 are balanced into the exposure ranges on 20 seeds', (variant) => {
    for (let seed = 1; seed <= 20; seed++) {
      const w = regionWorld(seed, variant);
      for (const depth of [2, 3] as const) {
        const list: BalanceRegion[] = w.regions
          .filter((r) => r.seed.depth === depth)
          .map((r) => ({ id: r.seed.id, depth, area: r.area, corridorArea: r.corridorArea, security: r.security, fixed: r.fixed !== null }));
        const e = exposure(list);
        expect(w.balance[depth]!.ok, `seed ${seed} depth ${depth}`).toBe(true);
        expect(e.area).toBeGreaterThanOrEqual(REGION_GEN.balance.area[0]);
        expect(e.area).toBeLessThanOrEqual(REGION_GEN.balance.area[1]);
        expect(e.cautious).toBeGreaterThanOrEqual(REGION_GEN.balance.cautious[0]);
        expect(e.cautious).toBeLessThanOrEqual(REGION_GEN.balance.cautious[1]);
      }
    }
  });

  it('a destroyed fortress turns its sector Contested', () => {
    const w = regionWorld(1, 'B');
    const [fid, rid] = [...w.fortressRegions][0]!;
    const s = w.field.seedById(rid)!;
    expect(currentSecurity(w, s, { destroyedFortresses: new Set(), secured: new Set() })).toBe('pirate');
    expect(currentSecurity(w, s, { destroyedFortresses: new Set([fid]), secured: new Set() })).toBe(
      // another live fortress in the same sector keeps it Pirate
      [...w.fortressRegions].some(([f, r]) => r === rid && f !== fid) ? 'pirate' : 'contested',
    );
  });

  it('depth 4+ sectors are rolled without balancing', () => {
    const w = regionWorld(1, 'B');
    const far = w.field.regionAt(12000, 3000);
    expect(far.depth).toBe(4);
    expect(['contested', 'pirate']).toContain(securityOf(w, far));
  });
});

describe('pirate spawns (stage 1a contract)', () => {
  const ctx = (training: boolean, epoch: number) => ({ training, epoch, destroyedFortresses: new Set<string>(), secured: new Set<string>() });

  it.each(REGION_VARIANTS)('variant %s: no pirates within 1 000 u of home, ever', (variant) => {
    for (const seed of SEEDS) {
      const w = regionWorld(seed, variant);
      for (let cx = -6; cx <= 5; cx++) {
        for (let cy = -6; cy <= 5; cy++) {
          const x = (cx + 0.5) * CHUNK_SIZE;
          const y = (cy + 0.5) * CHUNK_SIZE;
          if (Math.hypot(x, y) >= REGION_GEN.corner.pirateFreeRadius) continue;
          for (const c of [ctx(false, 5), ctx(true, 0), ctx(false, 0)]) expect(pirateGroupRate(w, x, y, c)).toBe(0);
        }
      }
    }
  });

  it.each(REGION_VARIANTS)('variant %s: the depth-1 corner is quiet during training and in epoch 0', (variant) => {
    for (const seed of SEEDS) {
      const w = regionWorld(seed, variant);
      let cornerChunks = 0;
      for (let cx = -12; cx <= 12; cx++) {
        for (let cy = -12; cy <= 12; cy++) {
          const x = (cx + 0.5) * CHUNK_SIZE;
          const y = (cy + 0.5) * CHUNK_SIZE;
          if (w.field.regionAt(x, y).id !== w.corners.depth1 || Math.hypot(x, y) < REGION_GEN.corner.pirateFreeRadius) continue;
          cornerChunks++;
          expect(pirateGroupRate(w, x, y, ctx(true, 3))).toBe(0);
          expect(pirateGroupRate(w, x, y, ctx(false, 0))).toBe(0);
          expect(pirateGroupRate(w, x, y, ctx(false, 1))).toBeGreaterThan(0);
        }
      }
      expect(cornerChunks, `seed ${seed}`).toBeGreaterThan(0);
    }
  });

  it('other depth-1 sectors stay pirate-free; the corridor cuts the rate to 0.2×', () => {
    const w = regionWorld(42, 'B');
    for (let cx = -10; cx <= 10; cx++) {
      for (let cy = -10; cy <= 10; cy++) {
        const s = w.field.regionOfChunk(cx, cy);
        if (s.depth === 1 && s.id !== w.corners.depth1) expect(pirateGroupRate(w, (cx + 0.5) * 200, (cy + 0.5) * 200, ctx(false, 2))).toBe(0);
      }
    }
    const lane = w.lanes[1]!;
    const p = lane.points[lane.points.length - 3]!;
    const s = w.field.regionAt(p.x, p.y);
    if (s.depth >= 2 && securityOf(w, s) !== 'quiet' && securityOf(w, s) !== 'guarded') {
      expect(pirateGroupRate(w, p.x, p.y, ctx(false, 2))).toBeCloseTo(0.08 * REGION_GEN.groupMult[securityOf(w, s)] * 0.2, 6);
    }
  });
});

describe('"not a target" metric (§2.6)', () => {
  it('both variants keep tangential borders under 25 % (seed 1)', () => {
    for (const variant of REGION_VARIANTS) {
      const o = borderOrientation(regionField(1, variant), { step: 100, rMax: 6000 });
      expect(o.tangentialShare).toBeLessThan(0.25);
      expect(o.histogram.reduce((s, v) => s + v, 0)).toBeCloseTo(1, 6);
    }
  });

  it.each(REGION_VARIANTS)('variant %s: the start map leaves ≥ 60° unknown and ≤ 60 % known near home (20 seeds)', (variant) => {
    for (let seed = 1; seed <= 20; seed++) {
      const r = startMapReport(regionWorld(seed, variant), 1600, 50);
      expect(r.knownShare, `seed ${seed}`).toBeLessThanOrEqual(0.6);
      expect(r.largestGapDeg, `seed ${seed}`).toBeGreaterThanOrEqual(60);
    }
  });

  it('variant B: the out-of-sample seeds that failed in stage 0 now pass (start knowledge within budget)', () => {
    for (const seed of [28, 53, 76, 88, 95]) {
      const r = startMapReport(regionWorld(seed, 'B'), 1600, 50);
      expect(r.pass, `seed ${seed}: ${r.knownShare} ${r.largestGapDeg}`).toBe(true);
    }
  });

  it('picks the lower tangential share, B on a tie', () => {
    expect(pickVariant(0.15, 0.2)).toBe('A');
    expect(pickVariant(0.2, 0.15)).toBe('B');
    expect(pickVariant(0.18, 0.185)).toBe('B');
    expect(pickVariant(0.185, 0.18)).toBe('B');
  });
});
