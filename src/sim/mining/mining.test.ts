import { describe, expect, it } from 'vitest';
import { emptyCargo } from '../../data/resources';
import { createBody } from '../physics/body';
import { makeProps } from '../ship/testing';
import type { ChunkGenerator } from '../world/generate';
import { World } from '../world/World';
import { COOL_TICKS, type LaserHeat } from './heat';
import { runMining } from './mining';
import type { MiningMover } from './movers';
import { activeSegment, VEIN_DRIFT_SPEED, veinPointAt, veinsOf, veinWorldLength } from './veins';

const DT = 1 / 60;
const rockAt = (x: number, amount = 100): ChunkGenerator => (_s, cx, cy) => ({
  cx,
  cy,
  asteroids:
    cx === 0 && cy === 0
      ? [{ id: 'rock', pos: { x, y: 0 }, baseRadius: 2, resource: 'ice', initialAmount: amount, variant: 0 }]
      : [],
});
const props = makeProps({
  cargoCapacity: 50,
  lasers: [{ partId: 1, offset: { x: 1, y: 0 }, facing: { x: 1, y: 0 }, range: 14, rate: 3, energyPerSecond: 6, heavy: false }],
});

function setup(rockX = 8, amount = 100) {
  const world = new World(1, rockAt(rockX, amount));
  world.update({ x: 0, y: 0 });
  const body = createBody();
  return { world, cargo: emptyCargo(), body, candidates: world.circlesNear(body.pos, 100) };
}

describe('runMining', () => {
  it('mines the asteroid under the beam into cargo', () => {
    const { world, cargo, body, candidates } = setup();
    const r = runMining({ body, props, cargo, candidates, energy: 10, aim: { x: 8, y: 0 }, world, dt: DT, yieldMultiplier: 1 });
    expect(cargo.ice).toBeCloseTo(3 * DT);
    expect(r.mined).toBeCloseTo(3 * DT);
    expect(r.energyUsed).toBeCloseTo(6 * DT);
    expect(r.beams).toHaveLength(1);
    expect(r.beams[0]!.asteroidId).toBe('rock');
    // cursor on the rock: the beam ends under the cursor (on the rock's surface), not at its rim
    expect(r.beams[0]!.to.x).toBeCloseTo(8);
    expect(r.beams[0]!).toMatchObject({ bonus: 1, vein: null });
  });

  it('ends the beam at the rim when the cursor is beyond the asteroid', () => {
    const { world, cargo, body, candidates } = setup();
    const r = runMining({ body, props, cargo, candidates, energy: 10, aim: { x: 13, y: 0 }, world, dt: DT, yieldMultiplier: 1 });
    expect(r.beams[0]!.to.x).toBeCloseTo(6);
  });

  it('applies the yield multiplier', () => {
    const { world, cargo, body, candidates } = setup();
    runMining({ body, props, cargo, candidates, energy: 10, aim: { x: 8, y: 0 }, world, dt: DT, yieldMultiplier: 2 });
    expect(cargo.ice).toBeCloseTo(6 * DT);
  });

  it('fires into empty space without mining', () => {
    const { world, cargo, body, candidates } = setup(100);
    const r = runMining({ body, props, cargo, candidates, energy: 10, aim: { x: 8, y: 0 }, world, dt: DT, yieldMultiplier: 1 });
    expect(r.beams[0]!.asteroidId).toBeNull();
    expect(r.beams[0]!.to.x).toBeCloseTo(1 + 14);
    expect(r.mined).toBe(0);
  });

  it('needs energy', () => {
    const { world, cargo, body, candidates } = setup();
    const r = runMining({ body, props, cargo, candidates, energy: 0, aim: { x: 8, y: 0 }, world, dt: DT, yieldMultiplier: 1 });
    expect(r.beams).toHaveLength(0);
    expect(r.energyUsed).toBe(0);
  });

  it('does not fire outside the arc', () => {
    const { world, cargo, body, candidates } = setup();
    const r = runMining({ body, props, cargo, candidates, energy: 10, aim: { x: -8, y: 0 }, world, dt: DT, yieldMultiplier: 1 });
    expect(r.beams).toHaveLength(0);
  });

  it('stops at full cargo and reports it once', () => {
    const { world, body, candidates } = setup();
    const cargo = { ...emptyCargo(), iron: 50 - 0.01 };
    const r = runMining({ body, props, cargo, candidates, energy: 10, aim: { x: 8, y: 0 }, world, dt: DT, yieldMultiplier: 1 });
    expect(cargo.ice).toBeCloseTo(0.01);
    expect(r.cargoFilled).toBe(true);
    const again = runMining({ body, props, cargo, candidates, energy: 10, aim: { x: 8, y: 0 }, world, dt: DT, yieldMultiplier: 1 });
    expect(again.mined).toBe(0);
    expect(again.cargoFilled).toBe(false);
  });

  it('reports depleted asteroids', () => {
    const { world, cargo, body, candidates } = setup(8, 0.01);
    const r = runMining({ body, props, cargo, candidates, energy: 10, aim: { x: 8, y: 0 }, world, dt: DT, yieldMultiplier: 1 });
    expect(r.depleted).toEqual(['rock']);
    expect(world.asteroids()).toHaveLength(0);
  });

  it('tells which laser fired each beam', () => {
    const { world, cargo, body, candidates } = setup();
    const twoLasers = makeProps({
      cargoCapacity: 50,
      lasers: [
        { partId: 1, offset: { x: -1, y: 0 }, facing: { x: -1, y: 0 }, range: 14, rate: 3, energyPerSecond: 6, heavy: false },
        { partId: 2, offset: { x: 1, y: 0 }, facing: { x: 1, y: 0 }, range: 14, rate: 3, energyPerSecond: 6, heavy: false },
      ],
    });
    const r = runMining({
      body, props: twoLasers, cargo, candidates, energy: 10, aim: { x: 8, y: 0 }, world, dt: DT, yieldMultiplier: 1,
    });
    expect(r.beams).toHaveLength(1);
    expect(r.beams[0]!.laser).toBe(1);
  });
});

describe('runMining – stations block the beam', () => {
  it('stops at a station in front of the asteroid and mines nothing', () => {
    const { world, cargo, body, candidates } = setup(12);
    const blockers = [{ pos: { x: 6, y: 0 }, radius: 1 }];
    const r = runMining({ body, props, cargo, candidates, blockers, energy: 10, aim: { x: 12, y: 0 }, world, dt: DT, yieldMultiplier: 1 });
    expect(cargo.ice).toBe(0);
    expect(r.mined).toBe(0);
    expect(r.beams).toHaveLength(1);
    expect(r.beams[0]!.asteroidId).toBeNull();
    expect(r.beams[0]!.resource).toBeNull();
    expect(r.beams[0]!.to.x).toBeCloseTo(5);
    // the laser runs (uses energy), only the beam ends at the station
    expect(r.energyUsed).toBeCloseTo(6 * DT);
  });

  it('ignores a station behind the asteroid', () => {
    const { world, cargo, body, candidates } = setup(8);
    const blockers = [{ pos: { x: 12, y: 0 }, radius: 1 }];
    const r = runMining({ body, props, cargo, candidates, blockers, energy: 10, aim: { x: 8, y: 0 }, world, dt: DT, yieldMultiplier: 1 });
    expect(r.beams[0]!.asteroidId).toBe('rock');
    expect(r.beams[0]!.resource).toBe('ice');
    expect(cargo.ice).toBeCloseTo(3 * DT);
  });
});

describe('runMining – veins (spec 2.1.1)', () => {
  const rockGen = (resource: 'iron' | 'titanium' | 'ice', amount = 100): ChunkGenerator => (_s, cx, cy) => ({
    cx,
    cy,
    asteroids:
      cx === 0 && cy === 0
        ? [{ id: '0,0:0', pos: { x: 8, y: 0 }, baseRadius: 2, resource, initialAmount: amount, variant: 0.1 }]
        : [],
  });
  const laser = (partId: number, heavy = false, y = 0) => ({
    partId, offset: { x: 1, y }, facing: { x: 1, y: 0 }, range: 14, rate: 3, energyPerSecond: 6, heavy,
  });

  function veinSetup(resource: 'iron' | 'titanium' | 'ice' = 'iron', amount = 100) {
    const world = new World(1, rockGen(resource, amount));
    world.update({ x: 0, y: 0 });
    const rock = world.asteroids()[0]!;
    return { world, rock, body: createBody(), cargo: emptyCargo() };
  }

  /** The point in the middle of the first vein's active segment (where the player aims). */
  function segmentPoint(world: World, rock: ReturnType<typeof veinSetup>['rock']) {
    const vein = veinsOf(rock)[0]!;
    const r = world.radiusOf(rock);
    const seg = activeSegment(vein, r, world.veinState(rock));
    return veinPointAt(rock, vein, r, 0, seg.center).pos;
  }

  it('mines ×1.5 on the active segment of an iron vein and the segment drifts at 0.3 units/s', () => {
    const { world, rock, body, cargo } = veinSetup();
    const state = world.mutableVeinState(rock);
    state.centers[0] = 0.5;
    state.dirs[0] = 1;
    const p = makeProps({ cargoCapacity: 500, lasers: [laser(1)] });
    let onVein = 0;
    for (let i = 0; i < 60; i++) {
      const candidates = world.circlesNear(body.pos, 100);
      const r = runMining({ body, props: p, cargo, candidates, energy: 100, aim: segmentPoint(world, rock), world, dt: DT, yieldMultiplier: 1, time: 0 });
      expect(r.beams[0]!.bonus).toBe(1.5);
      expect(r.beams[0]!.vein?.index).toBe(0);
      if (r.onVein.includes(1)) onVein++;
    }
    expect(onVein).toBe(60);
    expect(cargo.iron).toBeCloseTo(60 * 3 * DT * 1.5);
    const vein = veinsOf(rock)[0]!;
    const moved = (world.veinState(rock).centers[0]! - 0.5) * veinWorldLength(vein, world.radiusOf(rock));
    expect(moved).toBeCloseTo(VEIN_DRIFT_SPEED * 1, 1);
  });

  it('mines ×1 off the vein; the segment still drifts while the rock is mined', () => {
    const { world, rock, body, cargo } = veinSetup();
    const state = world.mutableVeinState(rock);
    state.centers[0] = 0.5;
    const p = makeProps({ cargoCapacity: 500, lasers: [laser(1)] });
    // cursor beyond the rock – the beam ends at the rim, far from the veins
    const r = runMining({ body, props: p, cargo, candidates: world.circlesNear(body.pos, 100), energy: 100, aim: { x: 30, y: 0 }, world, dt: DT, yieldMultiplier: 1, time: 0 });
    expect(r.beams[0]!).toMatchObject({ bonus: 1, vein: null });
    expect(r.onVein).toEqual([]);
    expect(cargo.iron).toBeCloseTo(3 * DT);
    expect(world.veinState(rock).centers[0]).not.toBe(0.5);
  });

  it('two lasers on one segment push it twice as fast', () => {
    const one = veinSetup();
    const two = veinSetup();
    for (const s of [one, two]) {
      const st = s.world.mutableVeinState(s.rock);
      st.centers[0] = 0.5;
      st.dirs[0] = 1;
    }
    const aim = segmentPoint(one.world, one.rock);
    runMining({ ...one, props: makeProps({ cargoCapacity: 500, lasers: [laser(1)] }), candidates: one.world.circlesNear(one.body.pos, 100), energy: 100, aim, dt: DT, yieldMultiplier: 1, time: 0 });
    runMining({ ...two, props: makeProps({ cargoCapacity: 500, lasers: [laser(1), laser(2, false, 0.2)] }), candidates: two.world.circlesNear(two.body.pos, 100), energy: 100, aim, dt: DT, yieldMultiplier: 1, time: 0 });
    const d1 = one.world.veinState(one.rock).centers[0]! - 0.5;
    const d2 = two.world.veinState(two.rock).centers[0]! - 0.5;
    expect(d2 / d1).toBeCloseTo(2, 1);
  });

  it('titanium has a deep vein: ×1.2 for a mining laser, ×1.8 for a heavy laser, and it does not move', () => {
    const { world, rock, body, cargo } = veinSetup('titanium');
    const aim = segmentPoint(world, rock);
    const before = world.veinState(rock);
    const normal = runMining({ body, props: makeProps({ cargoCapacity: 500, lasers: [laser(1)] }), cargo, candidates: world.circlesNear(body.pos, 100), energy: 100, aim, world, dt: DT, yieldMultiplier: 1, time: 0 });
    expect(normal.beams[0]!.bonus).toBe(1.2);
    const heavy = runMining({ body, props: makeProps({ cargoCapacity: 500, lasers: [laser(1, true)] }), cargo, candidates: world.circlesNear(body.pos, 100), energy: 100, aim, world, dt: DT, yieldMultiplier: 1, time: 0 });
    expect(heavy.beams[0]!.bonus).toBe(1.8);
    expect(world.veinState(rock)).toEqual(before);
  });

  it('a cooling laser does not fire', () => {
    const { world, body, cargo } = veinSetup();
    const heat = new Map<number, LaserHeat>([[1, { heat: 4, cooling: COOL_TICKS }]]);
    const r = runMining({ body, props: makeProps({ cargoCapacity: 500, lasers: [laser(1)] }), cargo, candidates: world.circlesNear(body.pos, 100), energy: 100, aim: { x: 8, y: 0 }, world, dt: DT, yieldMultiplier: 1, time: 0, heat });
    expect(r.beams).toEqual([]);
    expect(r.energyUsed).toBe(0);
  });

  it('ice cracks into 3 fragments at 30 % of its volume instead of being depleted', () => {
    const { world, rock, body, cargo } = veinSetup('ice', 100);
    world.extract(rock, 69.99);
    const r = runMining({ body, props: makeProps({ cargoCapacity: 500, lasers: [laser(1)] }), cargo, candidates: world.circlesNear(body.pos, 100), energy: 100, aim: { x: 8, y: 0 }, world, dt: DT, yieldMultiplier: 1, time: 0 });
    expect(r.cracked).toHaveLength(1);
    expect(r.cracked[0]).toMatchObject({ id: '0,0:0', fragments: ['0,0:0~0', '0,0:0~1', '0,0:0~2'] });
    expect(r.depleted).toEqual([]);
    expect(world.asteroids().map((a) => a.id)).toEqual(['0,0:0~0', '0,0:0~1', '0,0:0~2']);
    expect(r.beams[0]!.bonus).toBe(1);
  });
});

describe('runMining – ore grade (Mining 2.0)', () => {
  it('multiplies the ore that reaches the cargo, the rock loses only its rock units', () => {
    const { world, cargo, body, candidates } = setup();
    const rock = world.asteroids()[0]!;
    const r = runMining({ body, props, cargo, candidates, energy: 10, aim: { x: 8, y: 0 }, world, dt: DT, yieldMultiplier: 1, gradeOf: () => 1.4 });
    expect(cargo.ice).toBeCloseTo(3 * DT * 1.4);
    expect(r.mined).toBeCloseTo(3 * DT * 1.4);
    expect(world.remaining(rock)).toBeCloseTo(100 - 3 * DT);
    expect(r.extractions).toHaveLength(1);
    expect(r.extractions[0]).toMatchObject({ laser: 0, grade: 1.4, before: 100, onVein: false });
    expect(r.extractions[0]!.taken).toBeCloseTo(3 * DT);
    expect(r.extractions[0]!.laserRate).toBeCloseTo(3);
  });

  it('fills the hold exactly with a rich rock', () => {
    const { world, body, candidates } = setup();
    const cargo = { ...emptyCargo(), iron: 50 - 0.014 };
    const r = runMining({ body, props, cargo, candidates, energy: 10, aim: { x: 8, y: 0 }, world, dt: DT, yieldMultiplier: 1, gradeOf: () => 1.4 });
    expect(cargo.ice).toBeCloseTo(0.014);
    expect(r.cargoFilled).toBe(true);
    expect(r.extractions[0]!.taken).toBeCloseTo(0.01);
  });

  it('a poor rock gives less ore per second', () => {
    const { world, cargo, body, candidates } = setup();
    runMining({ body, props, cargo, candidates, energy: 10, aim: { x: 8, y: 0 }, world, dt: DT, yieldMultiplier: 1, gradeOf: () => 0.7 });
    expect(cargo.ice).toBeCloseTo(3 * DT * 0.7);
  });
});

describe('runMining – moving targets (M4b comets, movers.ts)', () => {
  const nucleus = (x: number, left = 100): MiningMover => ({
    id: 'cm:1',
    pos: { x, y: 0 },
    vel: { x: 0, y: 40 },
    radius: 2,
    resource: 'ice',
    mix: { ice: 0.6, titanium: 0.4 },
    left,
    grade: 1.5,
    nuggets: true,
  });

  it('mines a mover into the hold by its mix and grade (no vein bonus) and reports the extraction', () => {
    const { world, cargo, body, candidates } = setup(100);
    const r = runMining({ body, props, cargo, candidates, movers: [nucleus(8)], energy: 10, aim: { x: 8, y: 0 }, world, dt: DT, yieldMultiplier: 1 });
    expect(cargo.ice).toBeCloseTo(3 * DT * 1.5 * 0.6);
    expect(cargo.titanium).toBeCloseTo(3 * DT * 1.5 * 0.4);
    expect(r.mined).toBeCloseTo(3 * DT * 1.5);
    expect(r.beams[0]).toMatchObject({ asteroidId: null, resource: 'ice', bonus: 1, vein: null, grade: 1.5, mover: 'cm:1' });
    expect(r.beams[0]!.to.x).toBeCloseTo(6);
    expect(r.onVein).toEqual([]);
    expect(r.moverExtractions).toHaveLength(1);
    expect(r.moverExtractions[0]).toMatchObject({ laser: 0, mover: 'cm:1', before: 100, grade: 1.5 });
    expect(r.moverExtractions[0]!.taken).toBeCloseTo(3 * DT);
    expect(r.moverExtractions[0]!.ore.titanium).toBeCloseTo(3 * DT * 1.5 * 0.4);
  });

  it('respects what is left of the mover and the free hold', () => {
    const { world, cargo, body, candidates } = setup(100);
    const r = runMining({ body, props, cargo, candidates, movers: [nucleus(8, 0.01)], energy: 10, aim: { x: 8, y: 0 }, world, dt: DT, yieldMultiplier: 1 });
    expect(r.moverExtractions[0]!.taken).toBeCloseTo(0.01);
    const empty = runMining({ body, props, cargo: emptyCargo(), candidates, movers: [nucleus(8, 0)], energy: 10, aim: { x: 8, y: 0 }, world, dt: DT, yieldMultiplier: 1 });
    expect(empty.moverExtractions).toEqual([]);
    // a depleted nucleus still stops the beam
    expect(empty.beams[0]).toMatchObject({ mover: 'cm:1' });
    const full = { ...emptyCargo(), iron: 50 };
    const none = runMining({ body, props, cargo: full, candidates, movers: [nucleus(8)], energy: 10, aim: { x: 8, y: 0 }, world, dt: DT, yieldMultiplier: 1 });
    expect(none.moverExtractions).toEqual([]);
    expect(full.ice).toBe(0);
  });

  it('the nearer of a rock, a mover and a blocker takes the beam', () => {
    const { world, cargo, body, candidates } = setup(12);
    const first = runMining({ body, props, cargo, candidates, movers: [nucleus(7)], energy: 10, aim: { x: 12, y: 0 }, world, dt: DT, yieldMultiplier: 1 });
    expect(first.beams[0]!.mover).toBe('cm:1');
    expect(first.extractions).toEqual([]);
    const behind = runMining({ body, props, cargo, candidates: world.circlesNear(body.pos, 100), movers: [nucleus(13.5)], energy: 10, aim: { x: 12, y: 0 }, world, dt: DT, yieldMultiplier: 1 });
    expect(behind.beams[0]!.asteroidId).toBe('rock');
    expect(behind.moverExtractions).toEqual([]);
    const blocked = runMining({ body, props, cargo, candidates, movers: [nucleus(9)], blockers: [{ pos: { x: 4, y: 0 }, radius: 0.5 }], energy: 10, aim: { x: 9, y: 0 }, world, dt: DT, yieldMultiplier: 1 });
    expect(blocked.beams[0]!.mover).toBeUndefined();
    expect(blocked.moverExtractions).toEqual([]);
  });

  it('several lasers share what is left of one mover', () => {
    const two = makeProps({
      cargoCapacity: 50,
      lasers: [
        { partId: 1, offset: { x: 1, y: 0 }, facing: { x: 1, y: 0 }, range: 14, rate: 3, energyPerSecond: 6, heavy: false },
        { partId: 2, offset: { x: 1, y: 0.5 }, facing: { x: 1, y: 0 }, range: 14, rate: 3, energyPerSecond: 6, heavy: false },
      ],
    });
    const { world, cargo, body, candidates } = setup(100);
    const r = runMining({ body, props: two, cargo, candidates, movers: [nucleus(8, 0.06)], energy: 10, aim: { x: 8, y: 0 }, world, dt: DT, yieldMultiplier: 1 });
    expect(r.moverExtractions).toHaveLength(2);
    expect(r.moverExtractions[1]!.before).toBeCloseTo(0.01);
    expect(r.moverExtractions[0]!.taken + r.moverExtractions[1]!.taken).toBeCloseTo(0.06);
  });

  it('a cursor next to a small moving shard locks the beam onto it (beam tracking)', () => {
    const { world, cargo, body, candidates } = setup(100);
    const shard: MiningMover = { ...nucleus(9), id: 'cm:1#4', pos: { x: 9, y: 1.2 }, radius: 0.8, mix: { ice: 1 }, left: 8, grade: 1, nuggets: false };
    // the cursor misses the shard by 0.9 u – the laser still aims at its centre
    const r = runMining({ body, props, cargo, candidates, movers: [shard], energy: 10, aim: { x: 9, y: 2.9 }, world, dt: DT, yieldMultiplier: 1 });
    expect(r.beams[0]!.mover).toBe('cm:1#4');
    expect(cargo.ice).toBeCloseTo(3 * DT);
    // far from it the beam goes where the cursor is
    const miss = runMining({ body, props, cargo: emptyCargo(), candidates, movers: [shard], energy: 10, aim: { x: 9, y: 6 }, world, dt: DT, yieldMultiplier: 1 });
    expect(miss.beams[0]!.mover).toBeUndefined();
  });
});
