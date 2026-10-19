import { describe, expect, it } from 'vitest';
import { LOAD_MAX_PARTS } from '../../data/salvage';
import { SCANNER } from '../../data/scanner';
import { createWreck, emptyLoot, wreckLootOwner } from '../combat/wrecks';
import type { Wreck, WreckLoot } from '../combat/types';
import type { ShapeId } from '../../data/shapes';
import type { PlacedPart } from '../ship/types';
import { findPoi, flyingAt, ofType, run, teleport } from '../discovery/testing';
import { gridToWorld } from '../combat/geometry';
import { createGrid, partCenter } from '../ship/grid';
import type { Simulation } from '../Simulation';
import type { Vec2 } from '../math/vec2';
import { createContainer } from './containers';
import { cutJoint, intactInventory, isHulk, jointParts, pieceLoot } from './dismantle';
import { cutRate } from './cutting';

const SEED = 4242;

/** A ship with a grabber (tractor beam up), a laser in front and cargo. */
const salvager = () =>
  createGrid([
    ['cockpit', 0, 0],
    ['miningLaser', 1, 0],
    ['tractorBeam', 0, 1],
    ['reactor', -1, 0],
    ['cargo', 0, -1],
    ['engine', -2, 0],
  ]);

/**
 * A salvageable wreck in a row (x = 0…6): cockpit – armour – fuel tank – armour – cargo –
 * armour – engine, a radar under the cargo. The joints are the inner parts of the row.
 */
function hulkGrid() {
  return createGrid([
    ['cockpit', 0, 0],
    ['armor', 1, 0],
    ['fuelTank', 2, 0],
    ['armor', 3, 0],
    ['cargo', 4, 0],
    ['armor', 5, 0],
    ['engine', 6, 0],
    ['radar', 4, -1],
  ]);
}

/** A quiet place near home: no asteroids, stations or POIs (deterministic for SEED). */
function quietSpot(): Vec2 {
  const probe = flyingAt(SEED, { x: 0, y: 400 });
  for (let r = 320; r < 560; r += 20) {
    for (let a = 0; a < 64; a++) {
      const p = { x: Math.cos(a / 10) * r, y: Math.sin(a / 10) * r };
      probe.state.world.update(p);
      if (probe.state.world.circlesNear(p, 70).length > 0) continue;
      if (probe.state.world.stationCirclesNear(p, 220).length > 0) continue;
      return p;
    }
  }
  throw new Error('no quiet spot');
}
const Q = quietSpot();
const at = (dx: number, dy: number): Vec2 => ({ x: Q.x + dx, y: Q.y + dy });

/** A wreck standing upright (a row of parts along the y axis), centre at `pos`; a piece from a "POI" so that it gives Data. */
function placeHulk(sim: Simulation, pos: Vec2, angle = Math.PI / 2): Wreck {
  const grid = hulkGrid();
  const source = { body: { pos, vel: { x: 0, y: 0 }, angle, angVel: 0 }, props: { centerOfMass: { x: 3, y: 0 } } };
  const w = createWreck(sim.state.combat.nextId++, grid.parts, source, { vel: { x: 0, y: 0 }, angVel: 0 }, emptyLoot(), 'default');
  w.poi = 'wreck:999,999';
  // cargo (5) and radar (8) are intact
  w.dismantle = { intact: [5, 8] };
  w.loot.parts = { 'cargo:1': 1, 'radar:1': 1 };
  sim.state.combat.wrecks.push(w);
  return w;
}

const partWorld = (w: Wreck, id: number): Vec2 => gridToWorld(w.body, w.props.centerOfMass, partCenter(w.grid.parts.find((p) => p.id === id)!));

describe('joints (5.3.1)', () => {
  it('are the parts whose removal splits the wreck', () => {
    const j = jointParts(hulkGrid());
    // inner parts of the row: armour, tank, armour, cargo, armour
    expect([...j].sort((a, b) => a - b)).toEqual([2, 3, 4, 5, 6]);
  });

  it('a laser cuts slower than a heavy laser', () => {
    expect(1 / cutRate(2.5)).toBeCloseTo(3, 5);
    expect(cutRate(6)).toBeGreaterThan(cutRate(3.75));
  });
});

describe('wreck POIs to dismantle', () => {
  it('a medium or large wreck is a hulk with intact parts and containers, too big to load whole', () => {
    const poi = findPoi(SEED, 'wreck', (p) => p.size === 2 && p.cls === 'freighter');
    const sim = flyingAt(SEED, { x: poi.pos.x + 200, y: poi.pos.y }, salvager());
    run(sim, SCANNER.discoverInterval + 1);
    const w = sim.state.combat.wrecks.find((x) => x.poi === poi.id)!;
    expect(w.dismantle!.intact.length).toBeGreaterThanOrEqual(1);
    expect(w.grid.parts.length).toBeGreaterThan(LOAD_MAX_PARTS);
    expect(isHulk(w)).toBe(true);
    expect(sim.state.combat.containers.filter((c) => c.poi?.startsWith(`ct:${poi.id}`))).toHaveLength(2);
    // F at the wreck: too big (the containers stand further away)
    const near = { x: w.body.pos.x, y: w.body.pos.y + w.props.boundingRadius + 3 };
    teleport(sim, near);
    sim.state.combat.containers = [];
    const events = run(sim, 1, { dock: true });
    expect(ofType(events, 'salvageBlocked')).toHaveLength(1);
    expect(ofType(events, 'salvaged')).toHaveLength(0);
  });
});

describe('cutting with the mining laser', () => {
  it('cuts a joint after ~3 s on it and the wreck falls apart into pieces', () => {
    const sim = flyingAt(SEED, Q, salvager());
    const w = placeHulk(sim, at(10, 0));
    // the laser aims at the armour (id 4) behind the fuel tank
    const aim = partWorld(w, 4);
    const t0 = sim.state.tick;
    let cut: ReturnType<typeof ofType<'wreckCut'>> = [];
    for (let i = 0; i < 260 && cut.length === 0; i++) cut = ofType(run(sim, 1, { mining: true, aim }), 'wreckCut');
    expect(cut).toHaveLength(1);
    expect(cut[0]!.partId).toBe(4);
    expect(cut[0]!.blast).toBe(0);
    expect((sim.state.tick - t0) / 60).toBeGreaterThan(2.5);
    expect((sim.state.tick - t0) / 60).toBeLessThan(3.6);
    // the wreck keeps the piece with the cockpit, the rest is a separate piece with intact cargo and radar
    expect(w.grid.parts.map((p) => p.id)).toEqual([1, 2, 3]);
    const piece = sim.state.combat.wrecks.find((x) => x.id === cut[0]!.pieces[0])!;
    expect(piece.grid.parts.map((p) => p.id).sort()).toEqual([5, 6, 7, 8]);
    expect(piece.loot.parts).toEqual({ 'cargo:1': 1, 'radar:1': 1 });
    expect(w.loot.parts).toEqual({});
  });

  it('a laser on a non-joint part only scorches the hull', () => {
    const sim = flyingAt(SEED, Q, salvager());
    // the radar (8) is a loose part – the wreck turned with the radar towards the ship
    const w = placeHulk(sim, at(10, 0), -Math.PI / 2);
    const events = run(sim, 300, { mining: true, aim: partWorld(w, 8) });
    expect(ofType(events, 'wreckCut')).toHaveLength(0);
    expect(w.grid.parts).toHaveLength(8);
    expect(sim.state.player.beams[0]?.wreck).toBe(w.id);
  });

  it('a cut through a fuel tank explodes, destroys the neighbours and hits a ship close by', () => {
    const sim = flyingAt(SEED, Q, salvager());
    const w = placeHulk(sim, at(5.5, 0));
    const shield0 = sim.state.player.shield;
    const hull0 = [...sim.state.player.hp.values()].length;
    const events = run(sim, 260, { mining: true, aim: partWorld(w, 3) });
    const cut = ofType(events, 'wreckCut');
    expect(cut).toHaveLength(1);
    expect(cut[0]!.blast).toBe(30);
    // the tank and both neighbouring armour parts are gone
    const left = sim.state.combat.wrecks.flatMap((x) => x.grid.parts.map((p) => p.id));
    for (const id of [2, 3, 4]) expect(left).not.toContain(id);
    expect(ofType(events, 'cutBlast')).toHaveLength(1);
    expect(sim.state.player.shield < shield0 || sim.state.player.hp.size > hull0).toBe(true);
  });
});

describe('tractor beam', () => {
  it('pulls a container to the ship and F loads it', () => {
    const sim = flyingAt(SEED, Q, salvager());
    const loot = emptyLoot();
    loot.cargo.copper = 20;
    const c = createContainer(sim.state.combat.nextId++, at(0, 18), { x: 0, y: 0 }, loot);
    sim.state.combat.containers.push(c);
    const lock = run(sim, 1, { tractor: true, aim: c.body.pos });
    expect(ofType(lock, 'tractorLocked')).toHaveLength(1);
    const e0 = sim.state.player.energy;
    run(sim, 240);
    expect(sim.state.player.energy).toBeLessThan(e0 + 1);
    const gap = Math.hypot(c.body.pos.x - Q.x, c.body.pos.y - Q.y) - sim.state.player.props.boundingRadius;
    expect(gap).toBeLessThan(4);
    const events = run(sim, 1, { dock: true });
    expect(ofType(events, 'containerLoaded')).toHaveLength(1);
    expect(sim.state.player.cargo.copper).toBe(20);
    expect(sim.state.combat.containers).toHaveLength(0);
    expect(sim.state.player.tractor).toBeNull();
  });

  it('rips a loose part out of a big wreck, tows it and F loads it for parts and Data', () => {
    const sim = flyingAt(SEED, Q, salvager());
    const w = placeHulk(sim, at(12, 0));
    const radar = partWorld(w, 8);
    const lock = run(sim, 1, { tractor: true, aim: radar });
    expect(ofType(lock, 'tractorLocked')[0]).toMatchObject({ rip: true });
    const events = run(sim, 200);
    const ripped = ofType(events, 'partRipped');
    expect(ripped).toHaveLength(1);
    expect(w.grid.parts).toHaveLength(7);
    const piece = sim.state.combat.wrecks.find((x) => x.id === ripped[0]!.piece)!;
    expect(sim.state.player.tractor?.target).toEqual({ kind: 'wreck', id: piece.id });
    run(sim, 300);
    const data0 = sim.state.discovery.dataTotal;
    const load = run(sim, 1, { dock: true });
    expect(ofType(load, 'salvaged')).toHaveLength(1);
    expect(sim.state.player.salvage).toEqual({ 'radar:1': 1 });
    expect(sim.state.discovery.dataTotal).toBeGreaterThan(data0);
    expect(sim.state.combat.wrecks.some((x) => x.id === piece.id)).toBe(false);
  });

  it('refuses joints, heavy pirate wrecks and ships without a beam', () => {
    const sim = flyingAt(SEED, Q, salvager());
    const w = placeHulk(sim, at(12, 0));
    expect(ofType(run(sim, 1, { tractor: true, aim: partWorld(w, 5) }), 'tractorFailed')[0]).toMatchObject({ reason: 'joint' });
    delete w.dismantle;
    expect(ofType(run(sim, 1, { tractor: true, aim: partWorld(w, 8) }), 'tractorFailed')[0]).toMatchObject({ reason: 'tooHeavy' });
    expect(ofType(run(sim, 1, { tractor: true, aim: at(60, 60) }), 'tractorFailed')[0]).toMatchObject({ reason: 'noTarget' });
    const plain = flyingAt(SEED, Q);
    expect(ofType(run(plain, 1, { tractor: true }), 'tractorFailed')[0]).toMatchObject({ reason: 'noTractor' });
  });

  it('lets go when the object drifts out of range or the battery is empty, and on a second T', () => {
    const sim = flyingAt(SEED, Q, salvager());
    const c = createContainer(sim.state.combat.nextId++, at(0, 15), { x: 0, y: 0 }, emptyLoot());
    sim.state.combat.containers.push(c);
    run(sim, 1, { tractor: true, aim: c.body.pos });
    expect(ofType(run(sim, 1, { tractor: true }), 'tractorReleased')[0]).toMatchObject({ reason: 'manual' });
    run(sim, 1, { tractor: true, aim: c.body.pos });
    c.body = { ...c.body, pos: at(0, 60) };
    expect(ofType(run(sim, 1), 'tractorReleased')[0]).toMatchObject({ reason: 'range' });
    c.body = { ...c.body, pos: at(0, 15) };
    run(sim, 1, { tractor: true, aim: c.body.pos });
    sim.state.player.energy = 0;
    sim.state.player.props = { ...sim.state.player.props, energyGen: 0 };
    expect(ofType(run(sim, 1), 'tractorReleased')[0]).toMatchObject({ reason: 'energy' });
  });
});

describe('dismantled POI wrecks are remembered', () => {
  it('a wreck rebuilt from the seed keeps its cut parts', () => {
    const poi = findPoi(SEED, 'wreck', (p) => p.size === 2 && p.cls === 'freighter');
    const sim = flyingAt(SEED, { x: poi.pos.x + 200, y: poi.pos.y }, salvager());
    run(sim, SCANNER.discoverInterval + 1);
    const w = sim.state.combat.wrecks.find((x) => x.poi === poi.id)!;
    const joint = [...jointParts(w.grid)][0]!;
    const before = w.grid.parts.length;
    // cutting directly (a memory test, not the laser)
    cutJoint(sim.state, w, joint, []);
    const kept = w.grid.parts.map((p) => p.id);
    expect(kept.length).toBeLessThan(before);
    expect(sim.state.discovery.cut.get(poi.id)!.length).toBe(before - kept.length);
    teleport(sim, { x: poi.pos.x + 2500, y: poi.pos.y });
    run(sim, SCANNER.discoverInterval + 1);
    teleport(sim, { x: poi.pos.x + 200, y: poi.pos.y });
    run(sim, SCANNER.discoverInterval + 1);
    const again = sim.state.combat.wrecks.find((x) => x.poi === poi.id)!;
    expect(again.grid.parts.map((p) => p.id)).toEqual(kept);
  });
});

describe('second code review – salvage dupes', () => {
  it('C2: a partly loaded POI container is opened – after a despawn it never comes back full', () => {
    const poi = findPoi(SEED, 'wreck', (p) => p.size >= 1);
    const sim = flyingAt(SEED, { x: poi.pos.x + 200, y: poi.pos.y }, salvager());
    run(sim, SCANNER.discoverInterval + 1);
    const c = sim.state.combat.containers.find((x) => x.poi?.startsWith(`ct:${poi.id}`))!;
    // only one unit fits in the hold
    const player = sim.state.player;
    player.cargo.ice = player.props.cargoCapacity - 1;
    teleport(sim, { x: c.body.pos.x, y: c.body.pos.y + player.props.boundingRadius + 2 });
    const loaded = ofType(run(sim, 1, { dock: true }), 'containerLoaded');
    expect(loaded).toHaveLength(1);
    expect(loaded[0]!.cargoFull).toBe(true);
    expect(sim.state.discovery.opened.has(c.poi!)).toBe(true);
    const left = structuredClone(c.loot);
    // fly far away and back: the container is the same one, not a full new copy
    teleport(sim, { x: poi.pos.x + 2500, y: poi.pos.y });
    run(sim, SCANNER.discoverInterval + 1);
    teleport(sim, { x: poi.pos.x + 200, y: poi.pos.y });
    run(sim, SCANNER.discoverInterval + 1);
    const same = sim.state.combat.containers.filter((x) => x.poi === c.poi);
    expect(same).toHaveLength(1);
    expect(same[0]!.loot).toEqual(left);
  });

  it('C3: cutting a POI wreck already loaded with F gives no second copy of its intact parts (nor Data)', () => {
    const sim = flyingAt(SEED, Q, salvager());
    const grid = createGrid([
      ['cockpit', 0, 0],
      ['armor', 1, 0],
      ['cargo', 2, 0],
    ]);
    const source = { body: { pos: at(8, 0), vel: { x: 0, y: 0 }, angle: 0, angVel: 0 }, props: { centerOfMass: { x: 1, y: 0 } } };
    const w = createWreck(sim.state.combat.nextId++, grid.parts, source, { vel: { x: 0, y: 0 }, angVel: 0 }, emptyLoot(), 'default');
    w.poi = 'wreck:998,998';
    w.dismantle = { intact: [3] };
    w.loot.parts = { 'cargo:1': 1 };
    sim.state.combat.wrecks.push(w);
    expect(isHulk(w)).toBe(false);
    teleport(sim, { x: w.body.pos.x, y: w.body.pos.y + w.props.boundingRadius + sim.state.player.props.boundingRadius + 1 });
    const load = run(sim, 1, { dock: true });
    expect(ofType(load, 'salvaged')[0]).toMatchObject({ parts: { 'cargo:1': 1 }, data: 4 });
    expect(sim.state.player.salvage).toEqual({ 'cargo:1': 1 });
    // the wreck stays (a POI wreck) – cutting its joint now frees an empty piece
    expect(sim.state.combat.wrecks).toContain(w);
    cutJoint(sim.state, w, 2, []);
    const pieces = sim.state.combat.wrecks.filter((x) => x !== w);
    expect(pieces.length).toBeGreaterThan(0);
    for (const p of pieces) expect(p.loot).toEqual(emptyLoot());
    expect(w.loot.parts).toEqual({});
  });
});

describe('second code review – tractor on hulks', () => {
  it('I11: a T2 beam (6 parts) rips a part out of a joint-less 6-part hulk instead of towing a wreck F cannot load', () => {
    const grid = createGrid([
      ['cockpit', 0, 0],
      ['miningLaser', 1, 0],
      ['tractorBeam', 0, 1, 0, 2],
      ['reactor', -1, 0],
      ['cargo', 0, -1],
      ['engine', -2, 0],
    ]);
    const sim = flyingAt(SEED, Q, grid);
    const block = createGrid([
      ['armor', 0, 0],
      ['armor', 1, 0],
      ['armor', 2, 0],
      ['cargo', 0, 1],
      ['cargo', 1, 1],
      ['cargo', 2, 1],
    ]);
    const source = { body: { pos: at(12, 0), vel: { x: 0, y: 0 }, angle: 0, angVel: 0 }, props: { centerOfMass: { x: 1, y: 0.5 } } };
    const w = createWreck(sim.state.combat.nextId++, block.parts, source, { vel: { x: 0, y: 0 }, angVel: 0 }, emptyLoot(), 'default');
    w.poi = 'wreck:997,997';
    w.dismantle = { intact: [4] };
    w.loot.parts = { 'cargo:1': 1 };
    sim.state.combat.wrecks.push(w);
    expect(jointParts(w.grid).size).toBe(0);
    expect(isHulk(w)).toBe(true);
    const lock = run(sim, 1, { tractor: true, aim: partWorld(w, 4) });
    expect(ofType(lock, 'tractorLocked')[0]).toMatchObject({ rip: true });
    const ripped = ofType(run(sim, 180), 'partRipped');
    expect(ripped).toHaveLength(1);
    expect(w.grid.parts).toHaveLength(5);
  });
});

describe('pieces of wrecks with shaped armour (SL2 E2 §2.4)', () => {
  const plate = (id: number, shape?: ShapeId): PlacedPart => ({ id, partId: 'armor', tier: 1, x: id, y: 0, rot: 0, ...(shape ? { shape } : {}) });
  const ironOf = (loot: WreckLoot) => loot.cargo.iron;

  it('full parts drop as before: intact as the part, the rest as scrap at PIECE_SCRAP_HP', () => {
    const loot = pieceLoot([plate(1), plate(2)], new Set([1]));
    expect(loot.parts).toEqual({ 'armor:1': 1 });
    // scrapResources('armor:1', 0.5, 1) = floor(15 × 0.5 × 0.5) = 3 Fe
    expect(ironOf(loot)).toBe(3);
    expect(pieceLoot([plate(1), plate(2)], new Set([1]), 'player')).toEqual(loot);
  });

  it('another wreck: an intact chamfer drops as the part, an intact wedge as scrap ∝ area', () => {
    const loot = pieceLoot([plate(1, 'chamfer'), plate(2, 'wedge')], new Set([1, 2]));
    expect(loot.parts).toEqual({ 'armor:1': 1 });
    // wedge: 0.5 × 40 of 40 → floor(15 × 0.5 × 0.5) = 3 Fe
    expect(ironOf(loot)).toBe(3);
    // the part inventory a hulk shows holds only what drops whole
    expect(intactInventory({ grid: createGrid([['armor', 0, 0, 0, 1, 'wedge'], ['armor', 1, 0, 0, 1, 'arc']]), dismantle: { intact: [1, 2] } })).toEqual({ 'armor:1': 1 });
  });

  it('another wreck: a damaged wedge piece scraps at PIECE_SCRAP_HP × area', () => {
    // 0.5 × 40 × 0.5 = 10 of 40 → floor(15 × 0.5 × 0.25) = 1 Fe
    expect(ironOf(pieceLoot([plate(1, 'wedge')], new Set()))).toBe(1);
  });

  it('the player own wreck: an intact wedge drops whole, a damaged one scraps from its full-equivalent HP', () => {
    expect(pieceLoot([plate(1, 'wedge')], new Set([1]), 'player').parts).toEqual({ 'armor:1': 1 });
    // half of 20 HP missing = 10 → 30 of 40 → floor(15 × 0.5 × 0.75) = 5 Fe
    expect(ironOf(pieceLoot([plate(1, 'wedge')], new Set(), 'player'))).toBe(5);
  });

  it('wreckLootOwner: only the player own combat wrecks are "player"', () => {
    const w = (extra: Partial<Wreck>) => ({ livery: 'default' as const, ...extra });
    expect(wreckLootOwner(w({}))).toBe('player');
    expect(wreckLootOwner(w({ livery: 'pirate' }))).toBe('other');
    expect(wreckLootOwner(w({ poi: 'wreck:1,2' }))).toBe('other');
    expect(wreckLootOwner(w({ from: 'wreck:1,2' }))).toBe('other');
  });
});
