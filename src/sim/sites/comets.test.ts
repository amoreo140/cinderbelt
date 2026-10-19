// Comets (M4b T2, plan §2.3): generation per depth band, pass arcs and their clearance rules, pose as a
// pure function of the tick, tail shards, the "next pass near you" search and the sectors a pass crosses.
import { describe, expect, it } from 'vitest';
import { COMET } from '../../data/sites';
import { SECTOR_EPOCH_TICKS } from '../../data/sector';
import { FORTRESS_LAYOUT, fortressSites } from '../pirates/sites';
import { guildCorridorAt, sectorIdAt, sectorInfoAt } from '../regions/sectors';
import { chunkCoord } from '../world/chunks';
import { RINGS } from '../world/rings';
import { stationAt } from '../world/stations';
import { cometArc, cometAt, cometById, cometDefs, cometSectorsInEpoch, cometShards, cometsNear, nextPassNear, cometSignals } from './comets';
import type { CometDef } from './types';

const SEEDS = [1, 2, 3, 42, 1337] as const;
const dist = (a: { x: number; y: number }, b: { x: number; y: number }): number => Math.hypot(a.x - b.x, a.y - b.y);

/** The first tick ≥ from at which the comet is in its pass (brute force, 1 s steps then per tick). */
function nextPassStart(seed: number, def: CometDef, from: number): number {
  let t = from;
  if (cometAt(seed, def.id, t)) {
    while (cometAt(seed, def.id, t - 1)) t--;
    return t;
  }
  while (!cometAt(seed, def.id, t)) t += 60;
  while (cometAt(seed, def.id, t - 1)) t--;
  return t;
}

describe('comet generation', () => {
  it('has COMET.count comets per depth band with ids cm:<n> in order', () => {
    for (const seed of SEEDS) {
      const defs = cometDefs(seed);
      const counts = { 1: 0, 2: 0, 3: 0, 4: 0 };
      defs.forEach((d, n) => {
        expect(d.id).toBe(`cm:${n}`);
        expect(d.n).toBe(n);
        expect(cometById(seed, d.id)).toBe(d);
        counts[d.depth]++;
      });
      expect(counts).toEqual(COMET.count);
    }
    expect(cometById(1, 'cm:999')).toBeNull();
    expect(cometById(1, 'dl:1,2')).toBeNull();
  });

  it('speeds 30–55 u/s, passes 2–5 min, periods 40–120 game min', () => {
    for (const seed of SEEDS) {
      for (const d of cometDefs(seed)) {
        expect(d.speed).toBeGreaterThanOrEqual(30);
        expect(d.speed).toBeLessThanOrEqual(55);
        expect(d.passTicks).toBeGreaterThanOrEqual(120 * 60);
        expect(d.passTicks).toBeLessThanOrEqual(300 * 60);
        expect(d.periodTicks).toBeGreaterThanOrEqual(40 * 3600);
        expect(d.periodTicks).toBeLessThanOrEqual(120 * 3600);
      }
    }
  });

  it('puts the perihelion (the arc point closest to home) in its depth band and the ends farther out', () => {
    let sameDepth = 0;
    let all = 0;
    for (const seed of SEEDS) {
      for (const d of cometDefs(seed)) {
        const arc = cometArc(seed, d.id, 65);
        const mid = arc[32]!;
        const r = Math.hypot(mid.x, mid.y);
        const minR = Math.min(...arc.map((p) => Math.hypot(p.x, p.y)));
        expect(minR).toBeCloseTo(r, 6);
        // the ring band of its depth (ring 4 is open: 3 000 u wide)
        const ring = RINGS[d.depth - 1]!;
        expect(r).toBeGreaterThanOrEqual(Math.max(ring.inner, 1_000));
        expect(r).toBeLessThanOrEqual(Number.isFinite(ring.outer) ? ring.outer : ring.inner + 3_000);
        all++;
        if (sectorInfoAt(seed, mid.x, mid.y).depth === d.depth) sameDepth++;
        expect(Math.hypot(arc[0]!.x, arc[0]!.y)).toBeGreaterThan(r + 100);
        expect(Math.hypot(arc[64]!.x, arc[64]!.y)).toBeGreaterThan(r + 100);
      }
    }
    // the sector at the perihelion has the comet's depth (an arc that fits nowhere else may keep a border one)
    expect(sameDepth / all).toBeGreaterThan(0.95);
  });

  it('prefers cometPath sectors for depth-3 perihelia', () => {
    let path = 0;
    let all = 0;
    for (const seed of [...SEEDS, 7, 99, 2024, 31337, 5]) {
      for (const d of cometDefs(seed)) {
        if (d.depth !== 3) continue;
        const mid = cometArc(seed, d.id, 3)[1]!;
        all++;
        if (sectorInfoAt(seed, mid.x, mid.y).biome === 'cometPath') path++;
      }
    }
    // two depth-3 biomes: without the ×3 weight about half would lie in cometPath sectors
    expect(path / all).toBeGreaterThan(0.6);
  });

  it('keeps every arc ≥ 300 u from stations and fortresses and its middle third outside Guild corridors', () => {
    for (const seed of SEEDS) {
      const forts = fortressSites(seed);
      for (const d of cometDefs(seed)) {
        const length = (d.speed * d.passTicks) / 60;
        const samples = Math.ceil(length / 10) + 1;
        const arc = cometArc(seed, d.id, samples);
        arc.forEach((p, i) => {
          const s = (i / (samples - 1) - 0.5) * length;
          if (Math.abs(s) <= length / 6 - 10) expect(guildCorridorAt(seed, p.x, p.y)).toBe(false);
          for (const f of forts) expect(dist(p, f.pos)).toBeGreaterThanOrEqual(COMET.clear + FORTRESS_LAYOUT.clearRadius - 1e-6);
          for (let cx = chunkCoord(p.x - 400); cx <= chunkCoord(p.x + 400); cx++) {
            for (let cy = chunkCoord(p.y - 400); cy <= chunkCoord(p.y + 400); cy++) {
              const st = stationAt(seed, cx, cy);
              if (st) expect(dist(p, st.pos)).toBeGreaterThanOrEqual(COMET.clear);
            }
          }
        });
      }
    }
  });
});

describe('cometAt (pure in the tick)', () => {
  it('is continuous inside a pass at the comet speed and null outside', () => {
    const seed = 42;
    for (const d of cometDefs(seed).slice(0, 6)) {
      const start = nextPassStart(seed, d, 0);
      expect(cometAt(seed, d.id, start - 1)).toBeNull();
      expect(cometAt(seed, d.id, start + d.passTicks)).toBeNull();
      const first = cometAt(seed, d.id, start)!;
      expect(first.t).toBe(0);
      let prev = first;
      for (let t = start + 1; t < start + d.passTicks; t += 97) {
        const p = cometAt(seed, d.id, t)!;
        expect(p.pass).toBe(first.pass);
        expect(Math.hypot(p.vel.x, p.vel.y)).toBeCloseTo(d.speed, 6);
        expect(p.t).toBeGreaterThan(prev.t);
        expect(p.t).toBeLessThan(1);
        prev = p;
      }
      // one tick moves the nucleus speed / 60
      const a = cometAt(seed, d.id, start + 500)!;
      const b = cometAt(seed, d.id, start + 501)!;
      expect(dist(a.pos, b.pos)).toBeCloseTo(d.speed / 60, 3);
      // the next pass runs along the same arc with the next index
      const again = cometAt(seed, d.id, start + d.periodTicks + 500)!;
      expect(again.pass).toBe(first.pass + 1);
      expect(again.pos.x).toBeCloseTo(a.pos.x, 6);
      expect(again.pos.y).toBeCloseTo(a.pos.y, 6);
    }
  });

  it('gives the same pose for the same tick, whatever was asked before', () => {
    const ticks = [0, 12_345, 400_000, 1_234_567, 9_000_000];
    const first = ticks.map((t) => cometDefs(3).map((d) => cometAt(3, d.id, t)));
    cometsNear(3, { x: 0, y: 0 }, 1e9, 777);
    cometDefs(1);
    const again = [...ticks].reverse().map((t) => cometDefs(3).map((d) => cometAt(3, d.id, t))).reverse();
    expect(again).toEqual(first);
  });

  it('finds comets near a point and as scanner signals', () => {
    const seed = 2;
    const d = cometDefs(seed)[5]!;
    const t = nextPassStart(seed, d, 0) + 1_000;
    const pose = cometAt(seed, d.id, t)!;
    const at = { x: pose.pos.x + 200, y: pose.pos.y };
    expect(cometsNear(seed, at, 201, t).map((c) => c.id)).toContain(d.id);
    expect(cometsNear(seed, at, 150, t).map((c) => c.id)).not.toContain(d.id);
    expect(cometSignals(seed, at, 200, t)).toContainEqual({ id: d.id, pos: pose.pos });
  });
});

describe('tail shards', () => {
  it('24 shards of radius 0.8–1.5 within the 30 u tail behind the nucleus, away from home', () => {
    const d = cometDefs(1)[3]!;
    const pose = cometAt(1, d.id, nextPassStart(1, d, 0) + 2_000)!;
    const shards = cometShards(pose);
    expect(shards).toHaveLength(COMET.tail.shards);
    const out = { x: pose.pos.x / Math.hypot(pose.pos.x, pose.pos.y), y: pose.pos.y / Math.hypot(pose.pos.x, pose.pos.y) };
    shards.forEach((s, i) => {
      expect(s.index).toBe(i);
      expect(s.radius).toBeGreaterThanOrEqual(COMET.tail.radius[0]);
      expect(s.radius).toBeLessThanOrEqual(COMET.tail.radius[1]);
      const along = (s.pos.x - pose.pos.x) * out.x + (s.pos.y - pose.pos.y) * out.y;
      expect(along).toBeGreaterThan(COMET.nucleusRadius);
      expect(along).toBeLessThanOrEqual(COMET.tail.length);
      expect(Math.hypot(s.pos.x, s.pos.y)).toBeGreaterThan(Math.hypot(pose.pos.x, pose.pos.y));
    });
    // the layout is fixed per comet
    expect(cometShards(pose)).toEqual(shards);
  });
});

describe('nextPassNear', () => {
  /** Brute force: every tick of the search window. */
  function brute(seed: number, d: CometDef, pos: { x: number; y: number }, tick: number): number | null {
    const end = tick + COMET.nearSearchPeriods * d.periodTicks;
    for (let t = tick; t <= end; t++) {
      const p = cometAt(seed, d.id, t);
      if (p && dist(p.pos, pos) <= COMET.nearRange) return t;
    }
    return null;
  }

  it('matches a brute-force scan (grazing, crossing, far, inside, behind)', () => {
    const seed = 1337;
    for (const [n, offset, from] of [
      [0, 900, 0],
      [2, 999.5, 50_000],
      [5, 400, 0],
      [9, 3_000, 0],
      [13, 0, 123_456],
    ] as const) {
      const d = cometDefs(seed)[n]!;
      const start = nextPassStart(seed, d, from);
      const mid = cometAt(seed, d.id, start + Math.floor(d.passTicks / 3))!;
      const r = Math.hypot(mid.pos.x, mid.pos.y);
      const pos = { x: mid.pos.x + (mid.pos.x / r) * offset, y: mid.pos.y + (mid.pos.y / r) * offset };
      for (const tick of [from, start + Math.floor(d.passTicks / 2)]) {
        expect(nextPassNear(seed, d.id, pos, tick)).toBe(brute(seed, d, pos, tick));
      }
    }
  });
});

describe('sectors a comet pass crosses (derived local condition)', () => {
  it('matches a per-tick scan of every pass in the epoch', () => {
    for (const seed of [1, 42]) {
      for (let epoch = 1; epoch <= 8; epoch++) {
        const from = epoch * SECTOR_EPOCH_TICKS;
        const to = from + SECTOR_EPOCH_TICKS;
        const expected = new Set<string>();
        for (const d of cometDefs(seed)) {
          for (let t = from; t < to; t++) {
            const p = cometAt(seed, d.id, t);
            if (!p) {
              // jump to the next pass (or the end of the epoch)
              const rel = t - nextPassStart(seed, d, t);
              if (rel < 0) t = Math.min(to, nextPassStart(seed, d, t)) - 1;
              continue;
            }
            expected.add(sectorIdAt(seed, p.pos.x, p.pos.y));
          }
        }
        expect(new Set(cometSectorsInEpoch(seed, epoch))).toEqual(expected);
      }
    }
  });
});
