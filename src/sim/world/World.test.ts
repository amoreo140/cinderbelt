import { describe, expect, it } from 'vitest';
import type { ChunkGenerator } from './generate';
import { HOME_STATION_ID, homeStation } from './stations';
import { World } from './World';

const oneRock: ChunkGenerator = (_seed, cx, cy) => ({
  cx,
  cy,
  asteroids:
    cx === 0 && cy === 0
      ? [{ id: 'rock', pos: { x: 50, y: 50 }, baseRadius: 2, resource: 'iron', initialAmount: 100, variant: 0 }]
      : [],
});

describe('World', () => {
  it('loads 5x5 chunks around the center', () => {
    const world = new World(1);
    world.update({ x: 0, y: 0 });
    expect(world.activeChunkCount).toBe(25);
  });

  it('unloads far chunks when moving', () => {
    const world = new World(1, oneRock);
    world.update({ x: 10, y: 10 });
    expect(world.asteroids()).toHaveLength(1);
    world.update({ x: 5000, y: 5000 });
    expect(world.activeChunkCount).toBe(25);
    expect(world.asteroids()).toHaveLength(0);
  });

  it('marks chunks around the player as explored', () => {
    const world = new World(1);
    world.update({ x: 10, y: 10 });
    expect(world.explored.has('0,0')).toBe(true);
    expect(world.explored.has('-1,-1')).toBe(true);
    expect(world.explored.has('2,2')).toBe(false);
  });

  it('extracts resources and remembers the delta', () => {
    const world = new World(1, oneRock);
    world.update({ x: 0, y: 0 });
    const rock = world.asteroids()[0]!;
    expect(world.extract(rock, 30)).toBe(30);
    expect(world.remaining(rock)).toBe(70);
    expect(world.radiusOf(rock)).toBeCloseTo(2 * Math.sqrt(0.7));
  });

  it('keeps deltas after unloading and reloading a chunk', () => {
    const world = new World(1, oneRock);
    world.update({ x: 0, y: 0 });
    world.extract(world.asteroids()[0]!, 40);
    world.update({ x: 5000, y: 0 });
    world.update({ x: 0, y: 0 });
    expect(world.remaining(world.asteroids()[0]!)).toBe(60);
  });

  it('removes depleted asteroids', () => {
    const world = new World(1, oneRock);
    world.update({ x: 0, y: 0 });
    const rock = world.asteroids()[0]!;
    expect(world.extract(rock, 500)).toBe(100);
    expect(world.radiusOf(rock)).toBe(0);
    expect(world.asteroids()).toHaveLength(0);
  });

  it('finds an asteroid of the active chunks by id, even when depleted (breakup effect)', () => {
    const world = new World(1, oneRock);
    world.update({ x: 0, y: 0 });
    const rock = world.asteroids()[0]!;
    world.extract(rock, 500);
    expect(world.findAsteroid('rock')).toBe(rock);
    expect(world.findAsteroid('nope')).toBeNull();
  });

  it('never extracts negative amounts', () => {
    const world = new World(1, oneRock);
    world.update({ x: 0, y: 0 });
    expect(world.extract(world.asteroids()[0]!, -5)).toBe(0);
  });
});

const rock = (id: string, x: number, y: number, baseRadius = 2) => ({
  id, pos: { x, y }, baseRadius, resource: 'iron' as const, initialAmount: 100, variant: 0,
});
/** Asteroids on the border of chunks 0,0 and 1,0 and one far away. */
const borderRocks: ChunkGenerator = (_seed, cx, cy) => ({
  cx,
  cy,
  asteroids:
    cx === 0 && cy === 0
      ? [rock('left', 195, 10), rock('far', 60, 150)]
      : cx === 1 && cy === 0
        ? [rock('right', 205, 10), rock('edge', 216, 10)]
        : [],
});
const ids = (list: { asteroid: { id: string } }[]) => list.map((e) => e.asteroid.id).sort();

describe('World.circlesNear', () => {
  it('returns asteroids from several chunks', () => {
    const world = new World(1, borderRocks);
    world.update({ x: 200, y: 0 });
    expect(ids(world.circlesNear({ x: 200, y: 10 }, 8))).toEqual(['left', 'right']);
  });

  it('includes circles that only reach into the square', () => {
    const world = new World(1, borderRocks);
    world.update({ x: 200, y: 0 });
    // the centre of 'edge' is 16 from the query, but radius 2 reaches into a square with half-side 15
    expect(ids(world.circlesNear({ x: 200, y: 10 }, 15))).toEqual(['edge', 'left', 'right']);
  });

  it('skips distant asteroids', () => {
    const world = new World(1, borderRocks);
    world.update({ x: 200, y: 0 });
    expect(ids(world.circlesNear({ x: 200, y: 10 }, 20))).not.toContain('far');
  });

  it('skips depleted asteroids', () => {
    const world = new World(1, borderRocks);
    world.update({ x: 200, y: 0 });
    const left = world.circlesNear({ x: 195, y: 10 }, 1)[0]!.asteroid;
    world.extract(left, 1000);
    expect(ids(world.circlesNear({ x: 200, y: 10 }, 8))).toEqual(['right']);
  });

  it('reports the shrunken radius after extraction', () => {
    const world = new World(1, borderRocks);
    world.update({ x: 200, y: 0 });
    const entry = world.circlesNear({ x: 205, y: 10 }, 1)[0]!;
    world.extract(entry.asteroid, 30);
    const again = world.circlesNear({ x: 205, y: 10 }, 1)[0]!;
    expect(again.circle.radius).toBeCloseTo(2 * Math.sqrt(0.7));
    expect(again.circle.pos).toEqual({ x: 205, y: 10 });
  });

  it('keeps extracted radii after reloading a chunk', () => {
    const world = new World(1, borderRocks);
    world.update({ x: 200, y: 0 });
    world.extract(world.circlesNear({ x: 205, y: 10 }, 1)[0]!.asteroid, 30);
    world.update({ x: 5000, y: 0 });
    expect(world.circlesNear({ x: 205, y: 10 }, 1)).toEqual([]);
    world.update({ x: 200, y: 0 });
    expect(world.circlesNear({ x: 205, y: 10 }, 1)[0]!.circle.radius).toBeCloseTo(2 * Math.sqrt(0.7));
  });
});

const stationGen: ChunkGenerator = (seed, cx, cy) => ({
  cx,
  cy,
  asteroids: [],
  station: cx === 0 && cy === 0 ? homeStation() : cx === 4 && cy === 0 ? { ...homeStation(), id: 'st:4,0', pos: { x: 900, y: 100 }, chunk: { cx: 4, cy: 0 } } : undefined,
});

describe('World – stations', () => {
  it('starts with the home station discovered', () => {
    const world = new World(1, stationGen);
    expect([...world.discovered]).toEqual([HOME_STATION_ID]);
  });

  it('lists stations of active chunks', () => {
    const world = new World(1, stationGen);
    world.update({ x: 0, y: 0 });
    expect(world.stations().map((s) => s.id)).toEqual([HOME_STATION_ID]);
    world.update({ x: 700, y: 0 });
    expect(world.stations().map((s) => s.id)).toEqual(['st:4,0']);
  });

  it('discovers a station when its chunk becomes explored', () => {
    const world = new World(1, stationGen);
    expect(world.update({ x: 0, y: 0 })).toEqual([]);
    // chunk 4,0 is active (reach 2) but not yet explored (reach 1)
    expect(world.update({ x: 500, y: 50 })).toEqual([]);
    expect(world.discovered.has('st:4,0')).toBe(false);
    expect(world.update({ x: 650, y: 50 })).toEqual(['st:4,0']);
    expect(world.discovered.has('st:4,0')).toBe(true);
    world.update({ x: 0, y: 0 });
    expect(world.update({ x: 650, y: 50 })).toEqual([]);
  });

  it('generates real stations with the default generator', () => {
    const world = new World(1);
    world.update({ x: 0, y: 0 });
    expect(world.stations().some((s) => s.id === HOME_STATION_ID)).toBe(true);
  });
});

describe('World.stationCirclesNear', () => {
  const rotated: ChunkGenerator = (_s, cx, cy) => ({
    cx,
    cy,
    asteroids: [],
    station:
      cx === 0 && cy === 0
        ? { ...homeStation(), id: 'st:0,0', pos: { x: 100, y: 100 }, portAngle: Math.PI / 2, colliders: [{ pos: { x: 5, y: 0 }, radius: 2 }] }
        : undefined,
  });

  it('returns station circles in world coordinates (rotated by the port angle)', () => {
    const world = new World(1, rotated);
    world.update({ x: 100, y: 100 });
    const circles = world.stationCirclesNear({ x: 100, y: 110 }, 5);
    expect(circles).toHaveLength(1);
    expect(circles[0]!.pos.x).toBeCloseTo(100);
    expect(circles[0]!.pos.y).toBeCloseTo(105);
    expect(circles[0]!.radius).toBe(2);
  });

  it('skips stations that are far away', () => {
    const world = new World(1, rotated);
    world.update({ x: 100, y: 100 });
    expect(world.stationCirclesNear({ x: 300, y: 100 }, 5)).toEqual([]);
  });
});

describe('World.setStationExtraColliders (M4c home modules)', () => {
  const rotated: ChunkGenerator = (_s, cx, cy) => ({
    cx,
    cy,
    asteroids: [],
    station:
      cx === 0 && cy === 0
        ? { ...homeStation(), id: 'st:0,0', pos: { x: 100, y: 100 }, radius: 10, portAngle: Math.PI / 2, colliders: [{ pos: { x: 5, y: 0 }, radius: 2 }] }
        : undefined,
  });
  // an extra circle beyond the station radius (like a module at the rim)
  const extra = [{ pos: { x: 14, y: 0 }, radius: 3 }];

  it('adds the extras rotated by the port angle and reaches past the station radius', () => {
    const world = new World(1, rotated);
    world.update({ x: 100, y: 100 });
    world.setStationExtraColliders('st:0,0', extra);
    // the extra sits at (100, 114); a query 16 u from the centre (beyond R + 1 + its radius) still finds it
    const circles = world.stationCirclesNear({ x: 100, y: 118 }, 2);
    expect(circles).toHaveLength(2);
    expect(circles[1]!.pos.x).toBeCloseTo(100);
    expect(circles[1]!.pos.y).toBeCloseTo(114);
    expect(circles[1]!.radius).toBe(3);
  });

  it('is idempotent, an empty list removes the extras, and a reload keeps them', () => {
    const world = new World(1, rotated);
    world.update({ x: 100, y: 100 });
    world.setStationExtraColliders('st:0,0', extra);
    world.setStationExtraColliders('st:0,0', extra);
    expect(world.stationCirclesNear({ x: 100, y: 100 }, 5)).toHaveLength(2);
    world.setStationExtraColliders('st:0,0', []);
    expect(world.stationCirclesNear({ x: 100, y: 100 }, 5)).toHaveLength(1);
    // set while the station's chunk is unloaded → present when it loads again
    world.update({ x: 5000, y: 5000 });
    world.setStationExtraColliders('st:0,0', extra);
    world.update({ x: 100, y: 100 });
    expect(world.stationCirclesNear({ x: 100, y: 100 }, 5)).toHaveLength(2);
  });

  it('keeps the caller from mutating the stored circles', () => {
    const world = new World(1, rotated);
    world.update({ x: 100, y: 100 });
    const mine = [{ pos: { x: 14, y: 0 }, radius: 3 }];
    world.setStationExtraColliders('st:0,0', mine);
    mine[0]!.pos.x = 0;
    expect(world.stationCirclesNear({ x: 100, y: 118 }, 2)[1]!.pos.y).toBeCloseTo(114);
  });
});

describe('World – ice cracking (spec 2.1.1)', () => {
  const iceRock: ChunkGenerator = (_seed, cx, cy) => ({
    cx,
    cy,
    asteroids:
      cx === 0 && cy === 0
        ? [
            { id: '0,0:0', pos: { x: 50, y: 50 }, baseRadius: 2, resource: 'ice', initialAmount: 100, variant: 0.3 },
            { id: '0,0:1', pos: { x: 80, y: 50 }, baseRadius: 2, resource: 'ice', initialAmount: 100, variant: 0.6 },
          ]
        : [],
  });

  it('splits into 3 fragments worth 20 % more than what was left', () => {
    const world = new World(1, iceRock);
    world.update({ x: 0, y: 0 });
    const rock = world.findAsteroid('0,0:0')!;
    world.extract(rock, 72);
    const fragments = world.crack(rock);
    expect(fragments.map((f) => f.id)).toEqual(['0,0:0~0', '0,0:0~1', '0,0:0~2']);
    expect(world.remaining(rock)).toBe(0);
    expect(world.cracked.get('0,0:0')).toBe(28);
    const total = fragments.reduce((s, f) => s + world.remaining(f), 0);
    expect(total).toBeCloseTo(28 * 1.2);
    expect(world.asteroids().map((a) => a.id)).toEqual(['0,0:1', '0,0:0~0', '0,0:0~1', '0,0:0~2']);
    // the shards do not overlap and lie around the parent
    for (const f of fragments) expect(Math.hypot(f.pos.x - 50, f.pos.y - 50)).toBeGreaterThan(world.radiusOf(f));
    expect(world.circlesNear({ x: 50, y: 50 }, 5)).toHaveLength(3);
  });

  it('rebuilds the same fragments after the chunk unloads and loads again (save / load)', () => {
    const world = new World(1, iceRock);
    world.update({ x: 0, y: 0 });
    const rock = world.findAsteroid('0,0:0')!;
    world.extract(rock, 75);
    const fragments = world.crack(rock);
    world.extract(fragments[1]!, 2);
    world.update({ x: 5000, y: 0 });
    world.update({ x: 0, y: 0 });
    expect(world.asteroids().map((a) => a.id)).toEqual(['0,0:1', '0,0:0~0', '0,0:0~1', '0,0:0~2']);
    expect(world.findAsteroid('0,0:0~1')).toEqual(fragments[1]);
    expect(world.remaining(world.findAsteroid('0,0:0~1')!)).toBeCloseTo(25 * 0.4 - 2);

    const fresh = new World(1, iceRock);
    for (const [id, left] of world.remainingById) fresh.remainingById.set(id, left);
    for (const [id, amount] of world.cracked) fresh.cracked.set(id, amount);
    fresh.update({ x: 0, y: 0 });
    expect(fresh.asteroids()).toEqual(world.asteroids());
  });

  it('keeps per-asteroid vein states that start from the deterministic default', () => {
    const veined: ChunkGenerator = (_seed, cx, cy) => ({
      cx,
      cy,
      asteroids: cx === 0 && cy === 0 ? [{ id: '0,0:0', pos: { x: 50, y: 50 }, baseRadius: 2, resource: 'iron', initialAmount: 100, variant: 0.1 }] : [],
    });
    const world = new World(1, veined);
    world.update({ x: 0, y: 0 });
    const rock = world.asteroids()[0]!;
    const initial = world.veinState(rock);
    expect(world.veins.size).toBe(0);
    const state = world.mutableVeinState(rock);
    state.centers[0] = 0.77;
    expect(world.veins.get('0,0:0')!.centers[0]).toBe(0.77);
    expect(world.veinState(rock).centers[1]).toBe(initial.centers[1]);
  });
});
