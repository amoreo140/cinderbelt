import { describe, expect, it } from 'vitest';
import { emptyLoot, lootEmpty } from '../combat/wrecks';
import { flyingAt, ofType, run, findPoi } from '../discovery/testing';
import type { Simulation } from '../Simulation';
import { createGrid } from '../ship/grid';
import type { Vec2 } from '../math/vec2';
import { createContainer } from '../salvage/containers';
import { createScavenger, scavengerSlots } from './scavenger';
import { retrieveWreck } from '../discovery/wrecks';
import { computeProperties } from '../ship/properties';
import { CHUNK_SIZE } from '../world/chunks';
import { loadSave } from '../save/load';
import { restoreSimulation, toEnvelope, toSave } from '../save/serialize';
import { testContext } from '../save/testing';

const SEED = 4242;

const gunship = () =>
  createGrid([
    ['cockpit', 0, 0],
    ['cannon', 1, 0],
    ['cannon', 1, 1],
    ['tractorBeam', 0, 1],
    ['reactor', -1, 0],
    ['reactor', -1, 1],
    ['cargo', 0, -1],
    ['engine', -2, 0],
  ]);

/** A quiet place near home (P1 – no pirates or POIs). */
function quietSpot(): Vec2 {
  const probe = flyingAt(SEED, { x: 0, y: 400 });
  for (let r = 320; r < 560; r += 20) {
    for (let a = 0; a < 64; a++) {
      const p = { x: Math.cos(a / 10) * r, y: Math.sin(a / 10) * r };
      probe.state.world.update(p);
      if (probe.state.world.circlesNear(p, 140).length > 0) continue;
      if (probe.state.world.stationCirclesNear(p, 220).length > 0) continue;
      return p;
    }
  }
  throw new Error('no quiet spot');
}
const Q = quietSpot();
const at = (dx: number, dy: number): Vec2 => ({ x: Q.x + dx, y: Q.y + dy });

function addScavenger(sim: Simulation, pos: Vec2, id = 'zb:test') {
  const e = createScavenger({ id, kind: 'scavenger', tier: 1, pos, angle: 0, home: pos, orbit: 1 });
  sim.state.combat.enemies.push(e);
  return e;
}

describe('scavenger slots', () => {
  it('none in the home ring; often next to medium and large wrecks in the outer belts', () => {
    for (let cx = -3; cx <= 3; cx++) for (let cy = -3; cy <= 3; cy++) expect(scavengerSlots(SEED, cx, cy, 'normal')).toEqual([]);
    const poi = findPoi(SEED, 'wreck', (p) => p.size >= 1 && p.ring >= 2 && scavengerSlots(SEED, p.cx, p.cy, 'normal').some((s) => s.id === `zb:${p.id}`));
    const slot = scavengerSlots(SEED, poi.cx, poi.cy, 'normal').find((s) => s.id === `zb:${poi.id}`)!;
    expect(Math.hypot(slot.pos.x - poi.pos.x, slot.pos.y - poi.pos.y)).toBeCloseTo(70, 3);
    expect(scavengerSlots(SEED, poi.cx, poi.cy, 'normal')).toBe(scavengerSlots(SEED, poi.cx, poi.cy, 'normal'));
    // the P2 belt has them even alone
    let lone = 0;
    for (let cx = 9; cx < 19; cx++) for (let cy = -10; cy < 10; cy++) lone += scavengerSlots(SEED, cx, cy, 'normal').filter((s) => s.id === `zb:${cx},${cy}`).length;
    expect(lone).toBeGreaterThan(0);
    expect(Math.hypot(9 * CHUNK_SIZE, 0)).toBeGreaterThan(1500);
  });

  it('a scavenger carries a full hold and no gun', () => {
    const e = createScavenger({ id: 'zb:1,2', kind: 'scavenger', tier: 1, pos: { x: 2000, y: 0 }, angle: 0, home: { x: 2000, y: 0 }, orbit: 1 });
    expect(e.props.weapons).toHaveLength(0);
    expect(e.props.tractors).toHaveLength(1);
    expect(e.grid.parts.length).toBeGreaterThanOrEqual(10);
    expect(e.grid.parts.length).toBeLessThanOrEqual(14);
    expect(lootEmpty(e.hold!)).toBe(false);
  });
});

describe('scavenger behaviour', () => {
  it('ignores the player, flies to a container and steals it', () => {
    const sim = flyingAt(SEED, Q, gunship());
    const e = addScavenger(sim, at(40, 40));
    const loot = emptyLoot();
    loot.cargo.titanium = 12;
    sim.state.combat.containers.push(createContainer(900, at(90, 60), { x: 0, y: 0 }, loot));
    const hold0 = e.hold!.cargo.titanium;
    const events = run(sim, 900);
    const stole = ofType(events, 'scavengerStole');
    expect(stole).toHaveLength(1);
    expect(stole[0]).toMatchObject({ what: 'container', fromPlayer: false });
    expect(sim.state.combat.containers).toHaveLength(0);
    expect(e.hold!.cargo.titanium).toBe(hold0 + 12);
    expect(ofType(events, 'shotFired')).toHaveLength(0);
    expect(ofType(events, 'enemyAlert')).toHaveLength(0);
  });

  it('steals the container the player is towing', () => {
    const sim = flyingAt(SEED, Q, gunship());
    const c = createContainer(901, at(0, 14), { x: 0, y: 0 }, emptyLoot());
    c.loot.cargo.copper = 5;
    sim.state.combat.containers.push(c);
    run(sim, 1, { tractor: true, aim: c.body.pos });
    expect(sim.state.player.tractor).not.toBeNull();
    addScavenger(sim, at(0, 90));
    const events = run(sim, 900);
    expect(ofType(events, 'scavengerStole')[0]).toMatchObject({ fromPlayer: true });
    expect(ofType(events, 'tractorReleased')[0]).toMatchObject({ reason: 'stolen' });
  });

  it('I9: leaves the wreck of a Retrieve contract alone (it respawns – a theft would print its part again)', () => {
    const sim = flyingAt(SEED, Q, gunship());
    addScavenger(sim, at(40, 40));
    const w = retrieveWreck(7, at(90, 60), 0, 'cannon:1', 1);
    // a small one (a scavenger could carry it)
    w.grid = createGrid([['cockpit', 0, 0], ['cargo', 1, 0], ['engine', -1, 0]]);
    w.props = computeProperties(w.grid);
    sim.state.combat.wrecks.push(w);
    const events = run(sim, 900);
    expect(ofType(events, 'scavengerStole')).toHaveLength(0);
    expect(sim.state.combat.wrecks).toContain(w);
    expect(w.loot.parts).toEqual({ 'cannon:1': 1 });
  });

  it('runs away when hit and leaves its whole hold in the wreck', () => {
    const sim = flyingAt(SEED, Q, gunship());
    const e = addScavenger(sim, at(30, 0));
    const hold = structuredClone(e.hold!);
    run(sim, 40, { fire: true, aim: e.body.pos });
    expect(e.ai.mode).toBe('flee');
    // finish it off on the spot: lower the HP of all parts
    for (const p of e.grid.parts) e.hp.set(p.id, 1);
    sim.state.player.body = { ...sim.state.player.body, pos: at(e.body.pos.x - Q.x - 20, e.body.pos.y - Q.y) };
    const events = run(sim, 120, { fire: true, aim: e.body.pos });
    const killed = ofType(events, 'shipDestroyed').find((x) => x.ref === 'zb:test');
    expect(killed?.kind).toBe('scavenger');
    const total = sim.state.combat.wrecks.reduce((s, w) => s + w.loot.cargo.iron, 0);
    expect(total).toBeGreaterThanOrEqual(hold.cargo.iron);
  });
});

describe('scavenger across save and load', () => {
  it('keeps its hold, mode and target – identical events after loading', () => {
    const ctx = testContext();
    const setup = () => {
      const sim = flyingAt(SEED, Q, gunship());
      addScavenger(sim, at(40, 40));
      const loot = emptyLoot();
      loot.cargo.iron = 9;
      sim.state.combat.containers.push(createContainer(900, at(90, 60), { x: 0, y: 0 }, loot));
      return sim;
    };
    const a = setup();
    const b = setup();
    run(a, 200);
    run(b, 200);
    const result = loadSave(toEnvelope(toSave(b, ctx)));
    if (!result.ok) throw new Error(result.error);
    const loaded = restoreSimulation(result.save);
    expect(loaded.state.combat.enemies[0]!.hold).toEqual(b.state.combat.enemies[0]!.hold);
    const ea = run(a, 700, { fire: true, aim: at(60, 60) });
    const eb = run(loaded, 700, { fire: true, aim: at(60, 60) });
    expect(eb).toEqual(ea);
    expect(JSON.stringify(toSave(loaded, ctx))).toBe(JSON.stringify(toSave(a, ctx)));
  }, 20_000);
});
