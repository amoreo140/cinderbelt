// Large reactor blast (M4c T9).
//
// Every path that takes a ship part to 0 HP funnels into `resolveDestroyed` (combat.ts), which runs
// `expandBlasts` before `splitGrid` – so a large reactor blows whatever destroyed it:
// - projectiles: `applyHits` → `damageShip` → `resolveDestroyed(…, 'shot')` (pirate, player, fortress
//   turret and sentry shots all travel as `combat.projectiles`);
// - ram (ship–ship): `collideAll` → `applyRam(…, 'impact')`;
// - asteroid / station impact: `Simulation.ts` flight → `applyRam(…, 'impact')`;
// - micrometeors: `events/micrometeors.ts` → `applyRam(…, 'hazard')`;
// - radiation anomalies: `discovery/anomalies.ts` → `applyRam(…, 'hazard')`;
// - mines (M4b sites): `sites/mines.ts` → `applyRam(…, 'hazard')`;
// - cut blasts (a wreck's fuel tank / reactor cut by the laser): `salvage/dismantle.ts` `blastPlayer`
//   → `applyRam(…, 'hazard')`;
// - covered engine nozzles: `ship/exhaust.ts` → `burnExhausts` → `resolveDestroyed(…, 'exhaust')`;
// - scuttle: `scuttlePlayer` → `resolveDestroyed(…, 'hazard')` (the cockpit; never a reactor);
// - another blast: the breadth-first chain inside `expandBlasts`.
// `damageShip` (damage.ts) and `applyExhaustBurns` (exhaust.ts) are the only writers that lower a part's
// HP; the shipyard's dismantling never goes through combat and never blasts.
import { describe, expect, it } from 'vitest';
import { CUT_BLAST, CUT_BLAST_RADIUS } from '../../data/salvage';
import { IDLE_COMMAND } from '../commands';
import { add, rotate } from '../math/vec2';
import { createGrid, partCells } from '../ship/grid';
import { maxHp } from '../ship/hp';
import type { Rotation, ShipGrid } from '../ship/types';
import { Simulation, type SimEvent } from '../Simulation';
import type { ChunkGenerator } from '../world/generate';
import { cutJoint } from '../salvage/dismantle';
import { applyRam } from './combat';
import { gridToWorld } from './geometry';
import { blastNeighbours, expandBlasts } from './partBlast';
import { combatShip } from './testing';
import { PLAYER_REF } from './types';
import { createWreck, emptyLoot } from './wrecks';

/** Empty space without stations and asteroids. */
const emptySpace: ChunkGenerator = (_s, cx, cy) => ({ cx, cy, asteroids: [] });

/**
 * The large reactor (2) at (0,0)–(1,1) inside a ring of T2 plates; far plates two cells out.
 *
 *   y= 3          F12
 *   y= 2      .   W11  A4
 *   y= 1  .   R   R    A3
 *   y= 0  F9 A6  R   R    C1  F8
 *   y=-1     A7  Wing10    A5
 *       x=-2 -1   0   1    2   3
 */
const ringGrid = (tier: 1 | 2 = 1, rot: Rotation = 0): ShipGrid =>
  createGrid([
    ['cockpit', 2, 0],
    ['largeReactor', 0, 0, rot, tier],
    ['armor', 2, 1, 0, 2],
    ['armor', 2, 2, 0, 2],
    ['armor', 2, -1, 0, 2],
    ['armor', -1, 0, 0, 2],
    ['armor', -1, -1, 0, 2],
    ['armor', 3, 0, 0, 2],
    ['armor', -2, 0, 0, 2],
    ['armor', 0, -1, 0, 2, 'wingL'],
    ['armor', 1, 2, 0, 2, 'wedge'],
    ['armor', 1, 3, 0, 2],
  ]);

const ofType = <T extends SimEvent['type']>(events: readonly SimEvent[], type: T): Extract<SimEvent, { type: T }>[] =>
  events.filter((e): e is Extract<SimEvent, { type: T }> => e.type === type);

describe('blastNeighbours', () => {
  it('are the parts with a cell 8-adjacent to the 2×2 footprint at any rotation (shaped and 2×1 parts by their cells)', () => {
    for (const rot of [0, 1, 2, 3] as Rotation[]) {
      const grid = ringGrid(1, rot);
      const reactor = grid.parts.find((p) => p.id === 2)!;
      expect(partCells(reactor)).toHaveLength(4);
      expect(blastNeighbours(grid, reactor), `rot ${rot}`).toEqual([1, 3, 4, 5, 6, 7, 10, 11]);
    }
  });
});

describe('expandBlasts', () => {
  it('a destroyed T1 large reactor deals 40 to exactly its 8-adjacent parts, straight to HP; nothing farther; shields untouched', () => {
    const ship = combatShip(ringGrid(1), { x: 30, y: -12 }, 0.4);
    ship.shield = 25;
    ship.hp.set(2, 0);
    const events: SimEvent[] = [];
    const gone = expandBlasts({} as never, 'pr:t', ship, new Set([2]), events);
    const part = (id: number) => ship.grid.parts.find((p) => p.id === id)!;
    // a T2 plate (70) keeps 30, the cockpit (60) 20; the shaped wing takes it on its own smaller max HP
    expect(ship.hp.get(1)).toBe(20);
    for (const id of [3, 4, 5, 6, 7]) expect(ship.hp.get(id), `part ${id}`).toBe(30);
    expect(ship.hp.get(10)).toBe(Math.max(0, maxHp(part(10)) - 40));
    // the half-area wedge (35 HP) does not survive it
    expect(maxHp(part(11))).toBeLessThanOrEqual(40);
    expect(ship.hp.get(11)).toBe(0);
    for (const id of [8, 9, 12]) expect(ship.hp.has(id), `far part ${id}`).toBe(false);
    expect([...gone].sort((a, b) => a - b)).toEqual([2, 11]);
    expect(ship.shield).toBe(25);
    expect(ship.shieldDelay).toBe(0);
    const pos = gridToWorld(ship.body, ship.props.centerOfMass, { x: 0.5, y: 0.5 });
    expect(events).toEqual([{ type: 'partBlast', ref: 'pr:t', partId: 2, pos, damage: 40 }]);
  });

  it('a T2 large reactor blasts 50', () => {
    const ship = combatShip(ringGrid(2));
    const events: SimEvent[] = [];
    expandBlasts({} as never, PLAYER_REF, ship, new Set([2]), events);
    expect(ship.hp.get(1)).toBe(10);
    expect(ship.hp.get(3)).toBe(20);
    expect(ofType(events, 'partBlast').map((e) => e.damage)).toEqual([50]);
  });

  it('returns the input untouched when nothing explosive was destroyed', () => {
    const ship = combatShip(ringGrid(1));
    const events: SimEvent[] = [];
    const destroyed = new Set([3]);
    expect(expandBlasts({} as never, PLAYER_REF, ship, destroyed, events)).toBe(destroyed);
    expect(events).toEqual([]);
    expect(ship.hp.size).toBe(0);
  });

  it('the cockpit dies to a blast only when its HP ≤ blast', () => {
    const full = combatShip(ringGrid(1));
    expect(expandBlasts({} as never, PLAYER_REF, full, new Set([2]), []).has(1)).toBe(false);
    const hurt = combatShip(ringGrid(1));
    hurt.hp.set(1, 40);
    expect(expandBlasts({} as never, PLAYER_REF, hurt, new Set([2]), []).has(1)).toBe(true);
    expect(hurt.hp.get(1)).toBe(0);
  });

  //   y= 1   R1 R1 R2 R2
  //   y= 0 C R1 R1 R2 R2 A
  //       -1  0  1  2  3 4
  const twoReactors = () =>
    createGrid([
      ['cockpit', -1, 0],
      ['largeReactor', 0, 0],
      ['largeReactor', 2, 0],
      ['armor', 4, 0, 0, 2],
    ]);

  it('chains: a large reactor destroyed by a blast blows too, each reactor once, breadth-first', () => {
    const ship = combatShip(twoReactors());
    ship.hp.set(3, 30);
    const events: SimEvent[] = [];
    const gone = expandBlasts({} as never, PLAYER_REF, ship, new Set([2]), events);
    expect([...gone].sort()).toEqual([2, 3]);
    expect(ofType(events, 'partBlast').map((e) => e.partId)).toEqual([2, 3]);
    // the cockpit is next to the first reactor only, the plate next to the second only
    expect(ship.hp.get(1)).toBe(20);
    expect(ship.hp.get(4)).toBe(30);
  });

  it('two reactors destroyed together blow once each in part-id order; a part next to both takes both', () => {
    const grid = createGrid([
      ['cockpit', -1, 0],
      ['largeReactor', 3, 0],
      ['largeReactor', 0, 0],
      ['armor', 2, 0, 0, 2],
    ]);
    const ship = combatShip(grid);
    const events: SimEvent[] = [];
    const gone = expandBlasts({} as never, PLAYER_REF, ship, new Set([3, 2]), events);
    expect(ofType(events, 'partBlast').map((e) => e.partId)).toEqual([2, 3]);
    expect(ship.hp.get(4)).toBe(0);
    expect([...gone].sort()).toEqual([2, 3, 4]);
    expect(ship.hp.get(1)).toBe(20);
  });

  it('a third reactor two waves out also blows once (breadth-first order)', () => {
    const grid = createGrid([
      ['cockpit', -1, 0],
      ['largeReactor', 0, 0],
      ['largeReactor', 4, 0],
      ['largeReactor', 2, 0],
    ]);
    const ship = combatShip(grid);
    ship.hp.set(3, 10);
    ship.hp.set(4, 10);
    const events: SimEvent[] = [];
    const gone = expandBlasts({} as never, PLAYER_REF, ship, new Set([2]), events);
    expect([...gone].sort()).toEqual([2, 3, 4]);
    expect(ofType(events, 'partBlast').map((e) => e.partId)).toEqual([2, 4, 3]);
  });
});

/** The player in empty space with `grid`, shields down. */
function flying(grid: ShipGrid, seed = 61): Simulation {
  const sim = new Simulation({ seed, startDocked: false, generator: emptySpace, grid });
  sim.state.player.shield = 0;
  return sim;
}

//   y= 1    R R A
//   y= 0  E R R C
//   y=-1    K
//      x=-1 0 1 2
const shipWithReactor = () =>
  createGrid([
    ['cockpit', 2, 0],
    ['largeReactor', 0, 0],
    ['armor', 2, 1],
    ['engine', -1, 0],
    ['cargo', 0, -1],
  ]);

describe('blast in the simulation', () => {
  it('a ship that loses parts to a blast breaks up into wrecks like any other loss (cause: blast)', () => {
    const sim = flying(shipWithReactor());
    const p = sim.state.player;
    const events: SimEvent[] = [];
    applyRam(sim.state, PLAYER_REF, p, 2, 500, events, 'shot');
    // armour (40), engine (25) and cargo (30) die in the blast; the cockpit keeps 20
    expect(p.destroyed).toBe(false);
    expect(p.grid.parts.map((x) => x.id)).toEqual([1]);
    expect(p.hp.get(1)).toBe(20);
    expect(ofType(events, 'partBlast')).toHaveLength(1);
    const lost = ofType(events, 'partsLost');
    expect(lost).toHaveLength(1);
    expect(lost[0]!.cause).toBe('blast');
    expect(lost[0]!.parts.map((x) => x.partId).sort()).toEqual([2, 3, 4, 5]);
    expect(ofType(events, 'partDestroyed').map((e) => e.partId).sort()).toEqual([2, 3, 4, 5]);
  });

  it('detached parts beyond the blast become wrecks', () => {
    //   y= 0  E A R R C
    //   y= 1      R R
    const grid = createGrid([
      ['cockpit', 2, 0],
      ['largeReactor', 0, 0],
      ['armor', -1, 0, 0, 2],
      ['engine', -2, 0],
    ]);
    const sim = flying(grid);
    const p = sim.state.player;
    const wrecks0 = sim.state.combat.wrecks.length;
    const events: SimEvent[] = [];
    applyRam(sim.state, PLAYER_REF, p, 2, 500, events, 'impact');
    // the T2 plate survives with 30 but lost its link to the cockpit: it and the engine drift off as a wreck
    expect(p.grid.parts.map((x) => x.id)).toEqual([1]);
    expect(sim.state.combat.wrecks.length).toBe(wrecks0 + 1);
    const w = sim.state.combat.wrecks.at(-1)!;
    expect(w.grid.parts.map((x) => x.id).sort()).toEqual([3, 4]);
    expect(p.hp.has(3)).toBe(false);
    expect(ofType(events, 'partBlast')).toHaveLength(1);
    // the blast destroyed nothing beyond the reactor itself – the notice keeps the blow's cause
    expect(ofType(events, 'partsLost')[0]).toMatchObject({ cause: 'impact' });
  });

  it('a blast kills a hurt cockpit: the player dies and the rest breaks up', () => {
    const sim = flying(shipWithReactor());
    const p = sim.state.player;
    p.hp.set(1, 30);
    const events: SimEvent[] = [];
    applyRam(sim.state, PLAYER_REF, p, 2, 500, events, 'shot');
    expect(p.destroyed).toBe(true);
    expect(ofType(events, 'playerDestroyed')).toHaveLength(1);
  });

  it('a projectile that destroys the reactor sets it off (applyHits path)', () => {
    const sim = flying(shipWithReactor());
    const p = sim.state.player;
    p.hp.set(2, 1);
    // a pirate shot from behind along the reactor's upper row (grid y = 1 – nothing in front of it)
    const lane = gridToWorld(p.body, p.props.centerOfMass, { x: -1, y: 1 });
    const from = add(lane, rotate({ x: -6, y: 0 }, p.body.angle));
    sim.state.combat.projectiles.push({ id: 999_001, owner: 'pr:x', pos: from, vel: rotate({ x: 300, y: 0 }, p.body.angle), ttl: 30, damage: 5, tier: 1, origin: from });
    const events: SimEvent[] = [];
    for (let i = 0; i < 20 && ofType(events, 'partBlast').length === 0; i++) events.push(...sim.step(IDLE_COMMAND));
    expect(ofType(events, 'partBlast').map((e) => e.partId)).toEqual([2]);
    expect(ofType(events, 'partsLost')[0]).toMatchObject({ cause: 'blast' });
    expect(p.hp.get(1)).toBe(20);
  });

  it('a covered nozzle that burns a large reactor through sets it off (exhaust path)', () => {
    //   the engine at (−1,0) thrusts −x (rot 2), so its nozzle blows +x into the reactor
    const grid = createGrid([
      ['cockpit', 2, 0],
      ['largeReactor', 0, 0],
      ['engine', -1, 0, 2],
    ]);
    const sim = flying(grid);
    const p = sim.state.player;
    expect(p.props.exhaustBurns.map((b) => b.partId)).toEqual([2]);
    p.hp.set(2, 0.01);
    const events: SimEvent[] = [];
    for (let i = 0; i < 5; i++) events.push(...sim.step({ ...IDLE_COMMAND, flight: { forward: 0, strafe: 0, turn: 0 } }));
    expect(ofType(events, 'partBlast')).toHaveLength(0);
    for (let i = 0; i < 5; i++) events.push(...sim.step({ ...IDLE_COMMAND, flight: { forward: -1, strafe: 0, turn: 0 } }));
    expect(ofType(events, 'partBlast').map((e) => e.partId)).toEqual([2]);
    expect(p.hp.get(1)).toBe(20);
  });

  it('is deterministic', () => {
    const once = () => {
      const sim = flying(shipWithReactor());
      const events: SimEvent[] = [];
      applyRam(sim.state, PLAYER_REF, sim.state.player, 2, 500, events, 'shot');
      events.push(...sim.step(IDLE_COMMAND));
      return JSON.stringify({ events, hp: [...sim.state.player.hp], wrecks: sim.state.combat.wrecks.map((w) => [w.id, w.body, w.grid]) });
    };
    expect(once()).toBe(once());
  });
});

describe('cutting a wreck’s large reactor', () => {
  it('blasts 50 within CUT_BLAST_RADIUS and destroys its neighbours in the wreck', () => {
    expect(CUT_BLAST.largeReactor).toBe(50);
    const blastAt = (gap: number) => {
      const sim = new Simulation({ seed: 62, startDocked: false, generator: emptySpace, grid: createGrid([['cockpit', 0, 0], ['armor', 1, 0, 0, 2]]) });
      const p = sim.state.player;
      //   wreck row: cockpit – large reactor – armour (the reactor is the joint)
      const grid = createGrid([['cockpit', 0, 0], ['largeReactor', 1, 0], ['armor', 3, 0]]);
      const pos = add(p.body.pos, { x: p.props.boundingRadius + gap + 2, y: 0 });
      const source = { body: { pos, vel: { x: 0, y: 0 }, angle: 0, angVel: 0 }, props: { centerOfMass: { x: 1.5, y: 0.5 } } };
      const w = createWreck(sim.state.combat.nextId++, grid.parts, source, { vel: { x: 0, y: 0 }, angVel: 0 }, emptyLoot(), 'pirate');
      w.dismantle = { intact: [] };
      sim.state.combat.wrecks.push(w);
      const events: SimEvent[] = [];
      cutJoint(sim.state, w, 2, events);
      const left = sim.state.combat.wrecks.flatMap((x) => x.grid.parts.map((q) => q.id));
      return { events, left };
    };
    const near = blastAt(0);
    expect(ofType(near.events, 'wreckCut')[0]).toMatchObject({ partId: 2, blast: 50 });
    expect(near.left).not.toContain(2);
    expect(near.left).not.toContain(1);
    expect(near.left).not.toContain(3);
    const hit = ofType(near.events, 'cutBlast');
    expect(hit).toHaveLength(1);
    expect(hit[0]!.damage).toBeGreaterThan(25);
    expect(hit[0]!.damage).toBeLessThanOrEqual(50);
    const far = blastAt(CUT_BLAST_RADIUS + 6);
    expect(ofType(far.events, 'cutBlast')).toHaveLength(0);
  });
});
