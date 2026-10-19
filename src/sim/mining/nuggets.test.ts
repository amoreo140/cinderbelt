import { describe, expect, it } from 'vitest';
import { NUGGET } from '../../data/ore';
import { cargoUsed } from '../../data/resources';
import { IDLE_COMMAND } from '../commands';
import { ofType, run, tapScan } from '../discovery/testing';
import { createBody } from '../physics/body';
import { createGrid } from '../ship/grid';
import { Simulation, SIM_DT, type SimEvent } from '../Simulation';
import type { ChunkGenerator } from '../world/generate';
import { radarRangeOf } from '../discovery/scanner';
import { assayChunksAround, chunkOfAsteroid, oreGrade } from './grade';
import type { Extraction } from './mining';
import { assayOre, assayRange, gradeKnown, nuggetChance, spawnNuggets, stepNuggets, type Nugget } from './nuggets';

const bigRock = (amount = 10000): ChunkGenerator => (_s, cx, cy) => ({
  cx,
  cy,
  asteroids: cx === 0 && cy === 0 ? [{ id: '0,0:0', pos: { x: 12, y: 0 }, baseRadius: 3, resource: 'iron', initialAmount: amount, variant: 0.1 }] : [],
});

const miner = () =>
  createGrid([
    ['cockpit', 0, 0],
    ['miningLaser', 1, 0],
    ['tractorBeam', 0, 1],
    ['reactor', -1, 0],
    ['cargo', 0, -1],
    ['engine', -2, 0],
  ]);

function sim(amount?: number): Simulation {
  return new Simulation({ seed: 3, generator: bigRock(amount), startDocked: false, grid: miner() });
}

const extraction = (s: Simulation, taken: number, patch: Partial<Extraction> = {}): Extraction => {
  const rock = s.state.world.asteroids()[0]!;
  const before = s.state.world.remaining(rock);
  s.state.world.extract(rock, taken);
  return { laser: 0, asteroid: rock, before, taken, grade: 1, bonus: 1.5, onVein: true, to: { x: 9, y: 0 }, laserRate: 2.5, ...patch };
};

const nuggetAt = (s: Simulation, pos: { x: number; y: number }, amount = 10): Nugget => {
  const body = createBody(pos);
  const n: Nugget = { id: s.state.mining.nextId++, resource: 'copper', amount, grade: 1.2, source: '0,0:0', body, prevBody: body, ttl: 600 };
  s.state.mining.nuggets.push(n);
  return n;
};

describe('nugget chance', () => {
  it('is per second of mining: on the vein ~1 per 40 s, elsewhere ~1 per 160 s, scaled by grade', () => {
    const vein = nuggetChance({ onVein: true, grade: 1, laserRate: 2.5, bonus: 1.5 });
    const rock = nuggetChance({ onVein: false, grade: 1, laserRate: 2.5, bonus: 1 });
    // rolls per second = rock units per second / step
    expect(vein * ((2.5 * 1.5) / NUGGET.stepUnits)).toBeCloseTo(1 / 40, 6);
    expect(rock * (2.5 / NUGGET.stepUnits)).toBeCloseTo(1 / 160, 6);
    expect(nuggetChance({ onVein: true, grade: 1.4, laserRate: 2.5, bonus: 1.5 })).toBeCloseTo(vein * 1.4, 9);
    // a heavy laser rolls more often, so each roll is less likely – the same nuggets per second
    expect(nuggetChance({ onVein: false, grade: 1, laserRate: 6, bonus: 1 }) * (6 / NUGGET.stepUnits)).toBeCloseTo(1 / 160, 6);
  });
});

describe('spawnNuggets', () => {
  it('breaks nuggets off deterministically, takes their ore out of the rock and keeps at most the cap', () => {
    const results = [sim(), sim()].map((s) => {
      const events: SimEvent[] = [];
      const x = extraction(s, 2000);
      const left = s.state.world.remaining(x.asteroid);
      spawnNuggets(s.state, [x], events);
      return { s, events, left };
    });
    const [a, b] = results;
    expect(a!.events).toEqual(b!.events);
    const spawned = ofType(a!.events, 'nuggetSpawned');
    expect(spawned.length).toBeGreaterThan(NUGGET.cap);
    expect(ofType(a!.events, 'nuggetLost').every((e) => e.reason === 'cap')).toBe(true);
    expect(a!.s.state.mining.nuggets).toHaveLength(NUGGET.cap);
    // each nugget = 5 s of the laser's mining at grade 1, taken from the rock
    for (const e of spawned) expect(e.amount).toBeCloseTo(NUGGET.seconds * 2.5, 6);
    expect(a!.left - a!.s.state.world.remaining(a!.s.state.world.asteroids()[0]!)).toBeCloseTo(spawned.length * NUGGET.seconds * 2.5, 6);
    // they drift away from the rock, outside its surface
    for (const n of a!.s.state.mining.nuggets) {
      const d = Math.hypot(n.body.pos.x - 12, n.body.pos.y);
      expect(d).toBeGreaterThan(a!.s.state.world.radiusOf(a!.s.state.world.asteroids()[0]!));
      expect(Math.hypot(n.body.vel.x, n.body.vel.y)).toBeGreaterThanOrEqual(NUGGET.speed[0] - 1e-9);
    }
  });

  it('rolls once per step of mined rock – nothing between two steps', () => {
    const s = sim();
    const events: SimEvent[] = [];
    spawnNuggets(s.state, [extraction(s, 0.5)], events);
    spawnNuggets(s.state, [extraction(s, 0.5)], events);
    spawnNuggets(s.state, [extraction(s, 0.5)], events);
    expect(ofType(events, 'nuggetSpawned').length).toBeLessThanOrEqual(1);
  });

  it('never depletes a rock (it keeps its last units for the laser)', () => {
    const s = sim(40);
    const events: SimEvent[] = [];
    spawnNuggets(s.state, [extraction(s, 36)], events);
    const rock = s.state.world.findAsteroid('0,0:0')!;
    expect(s.state.world.remaining(rock)).toBeGreaterThanOrEqual(NUGGET.keepRock - 1e-9);
  });
});

describe('stepNuggets', () => {
  it('the magnet pulls a nugget next to the hull and puts its ore into the hold', () => {
    const s = sim();
    const n = nuggetAt(s, { x: 2.6, y: 0.3 }, 7);
    const events: SimEvent[] = [];
    for (let i = 0; i < 120 && s.state.mining.nuggets.length > 0; i++) stepNuggets(s.state, SIM_DT, events);
    expect(s.state.mining.nuggets).toEqual([]);
    expect(s.state.player.cargo.copper).toBeCloseTo(7);
    expect(s.state.stats.mined.copper).toBeCloseTo(7);
    expect(ofType(events, 'nuggetCollected')).toEqual([expect.objectContaining({ id: n.id, resource: 'copper', amount: 7 })]);
  });

  it('a nugget far from the ship drifts on and is gone after its lifetime', () => {
    const s = sim();
    const n = nuggetAt(s, { x: -40, y: 30 });
    n.body = { ...n.body, vel: { x: -1, y: 0 } };
    n.ttl = 30;
    const events: SimEvent[] = [];
    for (let i = 0; i < 29; i++) stepNuggets(s.state, SIM_DT, events);
    expect(s.state.mining.nuggets).toHaveLength(1);
    expect(s.state.mining.nuggets[0]!.body.pos.x).toBeLessThan(-40);
    stepNuggets(s.state, SIM_DT, events);
    expect(s.state.mining.nuggets).toEqual([]);
    expect(ofType(events, 'nuggetLost')).toEqual([expect.objectContaining({ id: n.id, reason: 'expired' })]);
  });

  it('a full hold takes only what fits – the rest of the nugget stays', () => {
    const s = sim();
    const p = s.state.player;
    p.cargo.iron = p.props.cargoCapacity - 2;
    nuggetAt(s, { x: 1.5, y: 0 }, 5);
    const events: SimEvent[] = [];
    stepNuggets(s.state, SIM_DT, events);
    expect(cargoUsed(p.cargo)).toBeCloseTo(p.props.cargoCapacity);
    expect(s.state.mining.nuggets[0]!.amount).toBeCloseTo(3);
    expect(ofType(events, 'cargoFull')).toHaveLength(1);
  });

  it('the tractor beam (T) catches a nugget and pulls it in – the magnet collects it', () => {
    const s = sim();
    const n = nuggetAt(s, { x: 0, y: 14 }, 9);
    const events = run(s, 1, { tractor: true, aim: { x: 0, y: 14 } });
    expect(ofType(events, 'tractorLocked')).toEqual([expect.objectContaining({ target: { kind: 'nugget', id: n.id } })]);
    const after = run(s, 600, { aim: { x: 0, y: 14 } });
    expect(ofType(after, 'nuggetCollected')).toHaveLength(1);
    expect(ofType(after, 'tractorReleased')).toEqual([expect.objectContaining({ reason: 'loaded' })]);
    expect(s.state.player.tractor).toBeNull();
    expect(s.state.player.cargo.copper).toBeCloseTo(9);
  });
});

describe('ore assay', () => {
  it('a scanner pulse reveals the grades of the rocks in radar range', () => {
    const s = new Simulation({ seed: 11, startDocked: false });
    s.state.player.body = createBody({ x: 75, y: 45 });
    s.state.world.update(s.state.player.body.pos);
    const rock = [...s.state.world.asteroids()].sort((p, q) => Math.hypot(p.pos.x - 75, p.pos.y - 45) - Math.hypot(q.pos.x - 75, q.pos.y - 45))[0]!;
    expect(gradeKnown(s.state, rock)).toBe(false);
    const events = tapScan(s);
    const assay = ofType(events, 'oreAssayed');
    expect(assay).toHaveLength(1);
    expect(assay[0]!.rocks).toBeGreaterThan(5);
    expect(gradeKnown(s.state, rock)).toBe(true);
    expect(s.state.mining.assayed.has(chunkOfAsteroid(rock))).toBe(true);
    const best = Math.max(...s.state.world.asteroids().filter((a) => gradeKnown(s.state, a)).map((a) => oreGrade(11, a)));
    expect(assay[0]!.best).toBeCloseTo(best);
  });

  it('the Archive "Vein analyser" (veinAnalyzer) doubles the assay reach (M4b)', () => {
    const pulse = (s: Simulation): SimEvent[] => [{ type: 'scanPulse', pos: { ...s.state.player.body.pos }, range: 1, found: 0 }];
    const plain = new Simulation({ seed: 11, startDocked: false });
    plain.state.player.body = createBody({ x: 75, y: 45 });
    assayOre(plain.state, pulse(plain));
    const analyser = new Simulation({ seed: 11, startDocked: false });
    analyser.state.player.body = createBody({ x: 75, y: 45 });
    analyser.state.discovery.archive.add('veinAnalyzer');
    assayOre(analyser.state, pulse(analyser));
    const range = radarRangeOf(plain.state);
    expect(assayRange(analyser.state)).toBeCloseTo(2 * range);
    expect([...plain.state.mining.assayed].sort()).toEqual([...assayChunksAround({ x: 75, y: 45 }, range)].sort());
    expect([...analyser.state.mining.assayed].sort()).toEqual([...assayChunksAround({ x: 75, y: 45 }, 2 * range)].sort());
    for (const k of plain.state.mining.assayed) expect(analyser.state.mining.assayed.has(k)).toBe(true);
    expect(analyser.state.mining.assayed.size).toBeGreaterThan(plain.state.mining.assayed.size * 2);
  });

  it('nothing happens without a pulse', () => {
    const s = sim();
    const events: SimEvent[] = [];
    assayOre(s.state, events);
    s.step(IDLE_COMMAND);
    expect(events).toEqual([]);
    expect(s.state.mining.assayed.size).toBe(0);
  });
});

describe('mining in the simulation', () => {
  it('a long mining run on one rock breaks off nuggets of the grade of the rock', () => {
    const s = sim();
    const events: SimEvent[] = [];
    for (let i = 0; i < 90; i++) {
      // an empty hold every 10 s (the test does not fly home to sell)
      s.state.player.cargo.iron = 0;
      events.push(...run(s, 600, { mining: true, aim: { x: 10, y: 0 } }));
    }
    const spawned = ofType(events, 'nuggetSpawned');
    expect(spawned.length).toBeGreaterThan(0);
    const grade = oreGrade(3, s.state.world.findAsteroid('0,0:0')!);
    for (const e of spawned) expect(e.grade).toBe(grade);
  }, 15_000);
});
