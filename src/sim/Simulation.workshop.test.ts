// On-board workshop in the simulation (M4c T8): refinery,
// refined ore, repair module. The save does not carry `refined` / `repair` until T12, so the save/load
// case hands the restored state its bank through the Simulation constructor (like home/restore.test.ts).
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FUEL_PER_ICE, REPAIR_MATERIAL_FACTOR, RECIPES, repairCost, resourcePrice } from './../data/economy';
import { REFINED_BONUS, WORKSHOP_MIN_BATTERY } from './../data/workshop';
import { emptyCargo, type Cargo } from './../data/resources';
import { boardEpoch } from './contracts/board';
import type { ContractOffer } from './career/types';
import { applyRam } from './combat/combat';
import { createEnemy } from './combat/enemies';
import { PLAYER_REF } from './combat/types';
import { IDLE_COMMAND, type PlayerCommand } from './commands';
import { applyDeath } from './death/death';
import { parkForNewShip, richSim } from './fleet/testing';
import { loadSave } from './save/load';
import { restoreSimulation, toEnvelope, toSave } from './save/serialize';
import { testContext } from './save/testing';
import { createGrid } from './ship/grid';
import { currentHp, maxHp } from './ship/hp';
import type { ShipGrid } from './ship/types';
import { repairMaterialPerHp, stepWorkshop, type RepairBank } from './ship/workshop';
import { SIM_DT, Simulation, type SimEvent } from './Simulation';
import { act, dockedSim, expectOk, homeOnly } from './station/testHarness';
import { HOME_STATION_ID, homeStation } from './world/stations';
import type { ChunkGenerator } from './world/generate';

const inject: { refined: Cargo | null; repair: RepairBank | null } = { refined: null, repair: null };

vi.mock('./Simulation', async (importOriginal) => {
  const m = await importOriginal<typeof import('./Simulation')>();
  class Simulation extends m.Simulation {
    constructor(options: ConstructorParameters<typeof m.Simulation>[0]) {
      const r = options.restore;
      super(r && (inject.refined || inject.repair) ? { ...options, restore: { ...r, player: { ...r.player, refined: inject.refined ?? undefined, repair: inject.repair } } } : options);
    }
  }
  return { ...m, Simulation };
});

beforeEach(() => {
  inject.refined = null;
  inject.repair = null;
});

const emptySpace: ChunkGenerator = (_s, cx, cy) => ({ cx, cy, asteroids: [] });

/** Ids 1–8: cockpit, repair module, armour E, armour N, engine (diagonal), refinery, reactor, cargo. */
const workshopShip = (extra: Parameters<typeof createGrid>[0] = []): ShipGrid =>
  createGrid([
    ['cockpit', 0, 0],
    ['repairModule', 1, 0],
    ['armor', 2, 0],
    ['armor', 1, 1],
    ['engine', 2, 1],
    ['refinery', -2, 0],
    ['reactor', 0, 1],
    ['cargo', 0, -1],
    ...extra,
  ]);
const REPAIR = 2;
const ARMOR_E = 3;
const ARMOR_N = 4;
const ENGINE = 5;
const COCKPIT = 1;

function flying(grid = workshopShip(), generator: ChunkGenerator = emptySpace): Simulation {
  const sim = new Simulation({ seed: 5, grid, startDocked: false, generator });
  const body = { pos: { x: 0, y: 0 }, vel: { x: 0, y: 0 }, angle: 0, angVel: 0 };
  sim.state.player.body = body;
  sim.state.player.prevBody = body;
  sim.state.player.fuel = sim.state.player.props.fuelCapacity;
  return sim;
}

const run = (sim: Simulation, steps: number, cmd: PlayerCommand = IDLE_COMMAND): SimEvent[] => {
  const out: SimEvent[] = [];
  for (let i = 0; i < steps; i++) out.push(...sim.step(cmd));
  return out;
};

const part = (sim: Simulation, id: number) => sim.state.player.grid.parts.find((p) => p.id === id)!;
const hpOf = (sim: Simulation, id: number): number => currentHp(sim.state.player.hp, part(sim, id));
const cargo = (c: Partial<Cargo>): Cargo => ({ ...emptyCargo(), ...c });

describe('refinery', () => {
  it('tops up the fuel from ice at the station ratio while it is more than 1 below full, never above full', () => {
    const sim = flying();
    const p = sim.state.player;
    const cap = p.props.fuelCapacity;
    p.fuel = cap - 3;
    p.cargo = cargo({ ice: 10 });
    run(sim, 60);
    expect(p.cargo.ice).toBeCloseTo(10 - 0.5, 6);
    expect(p.fuel).toBeCloseTo(cap - 3 + 0.5 * FUEL_PER_ICE, 6);
    expect(p.workshop.refining).toBe('fuel');
    run(sim, 600);
    // stopped within one step of the top-up gap (stateless rule: fuel < full − 1)
    expect(p.fuel).toBeGreaterThanOrEqual(cap - 1);
    expect(p.fuel).toBeLessThan(cap - 1 + 0.5 * FUEL_PER_ICE * SIM_DT + 1e-9);
    expect(p.cargo.ice).toBeCloseTo(10 - (p.fuel - (cap - 3)) / FUEL_PER_ICE, 9);
    expect(p.workshop.refining).toBeNull();
    expect(p.workshop.refineryIdle).toBe('nothing');
    // less than 1 below full: no top-up (and ice is never refined)
    const ice = p.cargo.ice;
    p.fuel = cap - 0.5;
    run(sim, 30);
    expect(p.cargo.ice).toBe(ice);
    expect(p.refined.ice).toBe(0);
    // a step never fills the tank above full
    p.fuel = cap - 1.001;
    for (let i = 0; i < 3; i++) stepWorkshop(sim.state, [], 1);
    expect(p.fuel).toBeLessThanOrEqual(cap);
    // fuel low and no ice (nothing to refine either): the refinery lacks material
    p.fuel = 1;
    p.cargo.ice = 0;
    sim.step(IDLE_COMMAND);
    expect(p.workshop.refineryIdle).toBe('material');
  });

  it('refines ore in the order titanium → copper → iron, never ice', () => {
    const sim = flying();
    const p = sim.state.player;
    p.cargo = cargo({ titanium: 0.5, copper: 1, iron: 5, ice: 3 });
    run(sim, 60);
    expect(p.workshop.refining).toBe('ore');
    expect(p.refined.titanium).toBeCloseTo(0.5, 6);
    expect(p.refined.copper).toBeCloseTo(0.1, 6);
    expect(p.refined.iron).toBe(0);
    run(sim, 120);
    expect(p.refined).toEqual(cargo({ titanium: 0.5, copper: 1, iron: expect.closeTo(0.3, 6) as unknown as number }));
    // the cargo itself is unchanged: refined is a sub-account
    expect(p.cargo).toEqual(cargo({ titanium: 0.5, copper: 1, iron: 5, ice: 3 }));
    run(sim, 60 * 10);
    expect(p.refined.iron).toBeCloseTo(5, 6);
    expect(p.workshop.refining).toBeNull();
    expect(p.workshop.refineryIdle).toBe('nothing');
  });

  it('two refineries add up', () => {
    const sim = flying(workshopShip([['refinery', -2, 1]]));
    const p = sim.state.player;
    p.cargo = cargo({ iron: 10 });
    run(sim, 60);
    expect(p.refined.iron).toBeCloseTo(1.2, 6);
  });

  it('nothing while docked, berthed or destroyed', () => {
    const docked = new Simulation({ seed: 5, grid: workshopShip(), generator: homeOnly });
    docked.state.player.cargo = cargo({ iron: 10, ice: 10 });
    docked.state.player.fuel = 1;
    docked.state.player.hp.set(ARMOR_E, 10);
    run(docked, 120);
    expect(docked.state.player.refined.iron).toBe(0);
    expect(docked.state.player.cargo.ice).toBe(10);
    expect(hpOf(docked, ARMOR_E)).toBe(10);
    expect(docked.state.player.workshop).toEqual({ refining: null, repairing: [] });

    for (const stop of ['berth', 'destroyed'] as const) {
      const sim = flying();
      const p = sim.state.player;
      p.cargo = cargo({ iron: 10 });
      p.hp.set(ARMOR_E, 10);
      if (stop === 'berth') sim.state.sites.berth = 'dr:test';
      else p.destroyed = true;
      const events: SimEvent[] = [];
      for (let i = 0; i < 60; i++) stepWorkshop(sim.state, events, SIM_DT);
      expect(p.refined.iron).toBe(0);
      expect(hpOf(sim, ARMOR_E)).toBe(10);
      expect(events).toEqual([]);
    }
  });
});

describe('energy priority', () => {
  it('a low battery stops the refinery first, then the repair module', () => {
    const sim = flying();
    const p = sim.state.player;
    p.cargo = cargo({ iron: 10 });
    p.hp.set(ARMOR_E, 10);
    const floor = WORKSHOP_MIN_BATTERY * p.props.batteryCapacity;
    const repairNeed = 3 * SIM_DT;
    const refineNeed = 5 * SIM_DT;

    // plenty: both work at full rate
    p.energy = floor + repairNeed + refineNeed + 1;
    stepWorkshop(sim.state, [], SIM_DT);
    expect(p.workshop.repairing).toEqual([{ module: REPAIR, target: ARMOR_E }]);
    expect(p.workshop.refining).toBe('ore');
    expect(p.energy).toBeCloseTo(floor + 1, 9);

    // only the repair module's share above the floor: the refinery stops
    p.energy = floor + repairNeed;
    const refined = p.refined.iron;
    stepWorkshop(sim.state, [], SIM_DT);
    expect(p.workshop.repairing).toHaveLength(1);
    expect(p.workshop.refining).toBeNull();
    expect(p.workshop.refineryIdle).toBe('energy');
    expect(p.refined.iron).toBe(refined);
    expect(p.energy).toBeCloseTo(floor, 9);

    // at the floor: both stop, the battery never goes below it
    const hp = hpOf(sim, ARMOR_E);
    const events: SimEvent[] = [];
    stepWorkshop(sim.state, events, SIM_DT);
    expect(p.workshop.repairing).toEqual([]);
    expect(p.workshop.repairIdle).toBe('energy');
    expect(hpOf(sim, ARMOR_E)).toBe(hp);
    expect(p.energy).toBeCloseTo(floor, 9);
    expect(events).toContainEqual({ type: 'workshopIdle', what: 'repair', reason: 'energy' });
  });
});

describe('refined ore stays inside the cargo', () => {
  function refinedDocked(): Simulation {
    const sim = richSim();
    const p = sim.state.player;
    p.cargo = cargo({ iron: 20, copper: 10, titanium: 4 });
    p.refined = cargo({ iron: 8, copper: 10, titanium: 4 });
    return sim;
  }
  const inside = (sim: Simulation): void => {
    const { cargo: c, refined } = sim.state.player;
    for (const r of ['iron', 'copper', 'titanium', 'ice'] as const) expect(refined[r]).toBeLessThanOrEqual(c[r]);
    expect(refined.ice).toBe(0);
  };

  it('selling sells refined units first with the bonus; value = refined × 1.15 + raw', () => {
    const sim = refinedDocked();
    const p = sim.state.player;
    const unit = resourcePrice('iron', homeStation().ring, homeStation().priceJitter.iron).sell;
    const before = sim.state.credits;
    expectOk(act(sim, { type: 'sellResource', resource: 'iron', qty: 10, from: 'ship' }));
    expect(sim.state.credits - before).toBe(Math.floor(8 * unit * (1 + REFINED_BONUS) + 2 * unit + 1e-9));
    expect(p.cargo.iron).toBe(10);
    expect(p.refined.iron).toBe(0);
    // the rest is raw: plain price
    const mid = sim.state.credits;
    expectOk(act(sim, { type: 'sellResource', resource: 'iron', qty: 'all', from: 'ship' }));
    expect(sim.state.credits - mid).toBe(Math.floor(10 * unit + 1e-9));
    // selling fewer than the refined units keeps the rest refined
    expectOk(act(sim, { type: 'sellResource', resource: 'copper', qty: 4, from: 'ship' }));
    expect(p.refined.copper).toBe(6);
    inside(sim);
  });

  it('selling from the station storage never uses the ship\'s refined units', () => {
    const sim = refinedDocked();
    sim.state.stations.get(HOME_STATION_ID)!.resources.iron = 10;
    const unit = resourcePrice('iron', homeStation().ring, homeStation().priceJitter.iron).sell;
    const before = sim.state.credits;
    expectOk(act(sim, { type: 'sellResource', resource: 'iron', qty: 10, from: 'storage' }));
    expect(sim.state.credits - before).toBe(Math.floor(10 * unit + 1e-9));
    expect(sim.state.player.refined.iron).toBe(8);
  });

  it('a transfer to the station storage moves raw units first; refined ones arrive as plain ore', () => {
    const sim = refinedDocked();
    const p = sim.state.player;
    expectOk(act(sim, { type: 'transfer', resource: 'iron', qty: 12, to: 'storage' }));
    expect(p.refined.iron).toBe(8);
    expectOk(act(sim, { type: 'transfer', resource: 'iron', qty: 3, to: 'storage' }));
    expect(p.cargo.iron).toBe(5);
    expect(p.refined.iron).toBe(5);
    // back on board it is raw
    expectOk(act(sim, { type: 'transfer', resource: 'iron', qty: 15, to: 'ship' }));
    expect(p.cargo.iron).toBe(20);
    expect(p.refined.iron).toBe(5);
    inside(sim);
  });

  it('a transfer to storage and back in the same step drops the refined status (clamp after each action)', () => {
    const sim = refinedDocked();
    const p = sim.state.player;
    const events = sim.step({
      ...IDLE_COMMAND,
      actions: [
        { type: 'transfer', resource: 'copper', qty: 10, to: 'storage', reqId: 9001 },
        { type: 'transfer', resource: 'copper', qty: 10, to: 'ship', reqId: 9002 },
      ],
    });
    expect(events.filter((e) => e.type === 'actionResult').map((e) => (e as { ok: boolean }).ok)).toEqual([true, true]);
    expect(p.cargo.copper).toBe(10);
    expect(p.refined.copper).toBe(0);
    inside(sim);
  });

  it('contract delivery takes raw units first', () => {
    const sim = refinedDocked();
    const board = sim.state.career.boards.get('home')!;
    const offer: ContractOffer = {
      id: `home@${boardEpoch(sim.state.tick)}.909`,
      type: 'delivery',
      faction: 'guild',
      station: 'home',
      ring: 1,
      risk: 0,
      target: { kind: 'delivery', resource: 'iron', amount: 15, to: 'home' },
      modifiers: [],
      bonus: 0,
      part: null,
    };
    board.offers.push(offer);
    expectOk(act(sim, { type: 'acceptContract', offerId: offer.id }));
    const c = sim.state.career.contracts.at(-1)!;
    expectOk(act(sim, { type: 'turnInContract', contractId: c.serial }));
    expect(sim.state.player.cargo.iron).toBe(5);
    expect(sim.state.player.refined.iron).toBe(5);
    inside(sim);
  });

  it('crafting from the cargo takes raw units first', () => {
    const sim = refinedDocked();
    const need = RECIPES['armor:1'].resources.iron!;
    expectOk(act(sim, { type: 'craft', key: 'armor:1', count: 1 }));
    expect(sim.state.player.cargo.iron).toBe(20 - need);
    expect(sim.state.player.refined.iron).toBe(Math.min(8, 20 - need));
    inside(sim);
  });

  it('a cargo spill (a destroyed large cargo hold) and a death keep refined ≤ cargo', () => {
    const sim = flying(workshopShip([['largeCargo', -2, -2]]));
    const p = sim.state.player;
    p.cargo = cargo({ iron: 40, copper: 10 });
    p.refined = cargo({ iron: 30, copper: 10 });
    const hold = p.grid.parts.find((x) => x.partId === 'largeCargo')!;
    applyRam(sim.state, PLAYER_REF, p, hold.id, 10_000, [], 'impact');
    expect(p.cargo.iron).toBeLessThan(40);
    sim.step(IDLE_COMMAND);
    inside(sim);
    expect(p.refined.iron).toBe(p.cargo.iron);

    // death: the cockpit goes, applyDeath (between steps), then the next step clamps
    applyRam(sim.state, PLAYER_REF, p, COCKPIT, 10_000, [], 'impact');
    expect(p.destroyed).toBe(true);
    applyDeath(sim);
    sim.step(IDLE_COMMAND);
    inside(sim);
  });
});

describe('the hangar swap carries refined ore', () => {
  it('both ways', () => {
    const sim = richSim();
    const p = sim.state.player;
    p.cargo = cargo({ iron: 20, titanium: 5 });
    p.refined = cargo({ iron: 7, titanium: 5 });
    const first = sim.state.fleet.active.id;
    expectOk(parkForNewShip(sim));
    const stored = sim.state.fleet.stored.find((s) => s.record.id === first)!;
    expect(stored.cargo).toMatchObject({ iron: 20, titanium: 5 });
    expect(stored.refined).toEqual(cargo({ iron: 7, titanium: 5 }));
    // the new ship has nothing refined
    expect(p.refined).toEqual(emptyCargo());
    p.cargo = cargo({ copper: 3 });
    p.refined = cargo({ copper: 2 });
    expectOk(act(sim, { type: 'hangarSwitch', shipId: first }));
    expect(sim.state.player.refined).toEqual(cargo({ iron: 7, titanium: 5 }));
    const other = sim.state.fleet.stored.find((s) => s.record.id !== first)!;
    expect(other.refined).toEqual(cargo({ copper: 2 }));
  });
});

describe('repair module', () => {
  it('picks the lowest HP fraction among its edge neighbours, ties by id, never itself or a diagonal', () => {
    const sim = flying();
    const p = sim.state.player;
    p.cargo = cargo({ iron: 50 });
    // the diagonal engine is the most damaged, but not a neighbour; the module itself does not count
    p.hp.set(ENGINE, 1);
    p.hp.set(REPAIR, 1);
    p.hp.set(ARMOR_E, 20);
    p.hp.set(ARMOR_N, 20);
    sim.step(IDLE_COMMAND);
    expect(p.workshop.repairing).toEqual([{ module: REPAIR, target: ARMOR_E }]);
    // the cockpit (60 HP) at 25/60 < 21/40: it wins
    p.hp.set(COCKPIT, 25);
    sim.step(IDLE_COMMAND);
    expect(p.workshop.repairing).toEqual([{ module: REPAIR, target: COCKPIT }]);
    expect(hpOf(sim, ENGINE)).toBe(1);
    expect(hpOf(sim, REPAIR)).toBe(1);
  });

  it('a second module repairs the first one', () => {
    const sim = flying(workshopShip([['repairModule', 1, -1]]));
    const p = sim.state.player;
    p.cargo = cargo({ iron: 50 });
    p.hp.set(REPAIR, 10);
    sim.step(IDLE_COMMAND);
    expect(p.workshop.repairing).toEqual([{ module: 9, target: REPAIR }]);
  });

  it('never repairs a removed part', () => {
    const sim = flying();
    const p = sim.state.player;
    p.cargo = cargo({ iron: 50 });
    p.hp.set(ARMOR_E, 5);
    p.hp.set(ARMOR_N, 30);
    applyRam(sim.state, PLAYER_REF, p, ARMOR_E, 10_000, [], 'impact');
    expect(p.grid.parts.some((x) => x.id === ARMOR_E)).toBe(false);
    sim.step(IDLE_COMMAND);
    expect(p.workshop.repairing).toEqual([{ module: REPAIR, target: ARMOR_N }]);
  });

  it('material = the station formula (Fe for T1, Ti for T2 targets), from the cargo only, whole units', () => {
    const sim = flying(createGrid([['cockpit', 0, 0], ['repairModule', 1, 0], ['armor', 2, 0, 0, 2], ['reactor', 0, 1]]));
    const p = sim.state.player;
    const armor = part(sim, 3);
    const max = maxHp(armor);
    // station parity: a full repair costs what repairCost charges (before its rounding up)
    const { material, perHp } = repairMaterialPerHp(armor);
    expect(material).toBe('titanium');
    expect(perHp).toBeCloseTo((REPAIR_MATERIAL_FACTOR * RECIPES['armor:2'].resources.titanium!) / max, 12);
    expect(repairCost('armor:2', 0, max, 1).amount).toBe(Math.ceil(perHp * max - 1e-9));

    p.hp.set(3, 10);
    // iron does not help a T2 part; Ti in the station storage does not count in flight
    p.cargo = cargo({ iron: 50 });
    const events = run(sim, 30);
    expect(hpOf(sim, 3)).toBe(10);
    expect(p.workshop.repairIdle).toBe('material');
    expect(p.cargo.iron).toBe(50);
    expect(events.filter((e) => e.type === 'workshopIdle')).toEqual([]);

    p.cargo = cargo({ iron: 50, titanium: 2 });
    run(sim, 1);
    // one whole unit drawn into the bank
    expect(p.cargo.titanium).toBe(1);
    expect(p.repair).toEqual({ part: 3, bank: expect.closeTo(1 / perHp - 1 / 60, 9) as unknown as number });
    expect(hpOf(sim, 3)).toBeCloseTo(10 + 1 / 60, 9);
    // 2 Ti buy 2 / perHp HP; then it idles without material
    const events2 = run(sim, 60 * 50);
    expect(p.cargo.titanium).toBe(0);
    expect(hpOf(sim, 3)).toBeCloseTo(10 + 2 / perHp, 6);
    expect(p.repair).toBeNull();
    expect(p.workshop.repairIdle).toBe('material');
    expect(events2).toContainEqual({ type: 'workshopIdle', what: 'repair', reason: 'material' });
    expect(p.cargo.iron).toBe(50);
  });

  it('a T1 target uses iron; the part is back at full HP with a partRepaired event', () => {
    const sim = flying();
    const p = sim.state.player;
    const max = maxHp(part(sim, ARMOR_E));
    p.cargo = cargo({ iron: 10 });
    p.hp.set(ARMOR_E, max - 2);
    const events = run(sim, 2 * 60 + 5);
    expect(hpOf(sim, ARMOR_E)).toBe(max);
    expect(p.hp.has(ARMOR_E)).toBe(false);
    expect(events).toContainEqual({ type: 'partRepaired', partId: ARMOR_E });
    expect(p.cargo.iron).toBe(9);
    expect(p.workshop.repairIdle).toBe('nothing');
  });

  it('the bank survives save/load: repair → save → load → continue = the same HP and material as without the reload', () => {
    const make = (): Simulation => {
      const sim = new Simulation({ seed: 9, grid: workshopShip(), startDocked: false });
      const body = { pos: { x: 260, y: 40 }, vel: { x: 0, y: 0 }, angle: 0, angVel: 0 };
      sim.state.player.body = body;
      sim.state.player.prevBody = body;
      sim.state.player.cargo = cargo({ iron: 20, copper: 6 });
      sim.state.player.hp.set(ARMOR_E, 12);
      sim.state.player.hp.set(ARMOR_N, 30);
      return sim;
    };
    const a = make();
    const b = make();
    run(a, 400);
    run(b, 400);
    expect(b.state.player.repair).not.toBeNull();
    const loaded = loadSave(toEnvelope(toSave(b, testContext())));
    if (!loaded.ok) throw new Error(loaded.error);
    inject.refined = { ...b.state.player.refined };
    inject.repair = { ...b.state.player.repair! };
    const c = restoreSimulation(loaded.save);
    inject.refined = null;
    inject.repair = null;
    run(a, 900);
    run(c, 900);
    const state = (s: Simulation) => ({
      hp: [...s.state.player.hp].sort((x, y) => x[0] - y[0]),
      cargo: s.state.player.cargo,
      refined: s.state.player.refined,
      repair: s.state.player.repair,
      energy: s.state.player.energy,
    });
    expect(state(c)).toEqual(state(a));
    // the run did repair and refine
    expect(hpOf(a, ARMOR_E)).toBeGreaterThan(12);
    expect(a.state.player.refined.copper).toBeGreaterThan(0);
  });

  it('heals at most 1 HP/s next to a damaged part during combat', () => {
    const sim = flying(workshopShip([['cannon', 3, 0]]), homeOnly);
    const p = sim.state.player;
    p.body = { pos: { x: 400, y: 0 }, vel: { x: 0, y: 0 }, angle: 0, angVel: 0 };
    p.prevBody = p.body;
    p.cargo = cargo({ iron: 30 });
    p.hp.set(ARMOR_E, 10);
    const e = createEnemy({ id: 'pr:test:jackal', kind: 'jackal', tier: 1, pos: { x: 440, y: 0 }, angle: Math.PI, home: { x: 440, y: 0 }, orbit: 1 });
    sim.state.combat.enemies.push(e);
    let last = hpOf(sim, ARMOR_E);
    let healed = 0;
    for (let i = 0; i < 300; i++) {
      sim.step({ ...IDLE_COMMAND, aim: e.body.pos, fire: true });
      if (!p.grid.parts.some((x) => x.id === ARMOR_E) || p.destroyed) break;
      const now = hpOf(sim, ARMOR_E);
      if (now > last) healed += now - last;
      expect(now - last).toBeLessThanOrEqual(1 / 60 + 1e-9);
      last = now;
    }
    expect(healed).toBeGreaterThan(0);
  });
});

describe('repair module: switching targets never burns material (saboteur B1)', () => {
  it('a T1 and a T2 neighbour whose HP fractions cross: every unit drawn heals its HP', () => {
    // module 2 touches the cockpit (full), a T1 plate (3) and a T2 plate (4)
    const sim = flying(createGrid([['cockpit', 0, 0], ['repairModule', 1, 0], ['armor', 2, 0], ['armor', 1, 1, 0, 2], ['reactor', 0, -1]]));
    const p = sim.state.player;
    const [t1, t2] = [part(sim, 3), part(sim, 4)];
    p.hp.set(3, maxHp(t1) / 2);
    p.hp.set(4, maxHp(t2) / 3);
    p.cargo = cargo({ iron: 3, titanium: 3 });
    const fe = repairMaterialPerHp(t1).perHp;
    const ti = repairMaterialPerHp(t2).perHp;
    const need = [maxHp(t1) / 2, (maxHp(t2) * 2) / 3];
    let switches = 0;
    let last: number | null = null;
    for (let i = 0; i < 60 * 120; i++) {
      sim.step(IDLE_COMMAND);
      const now = p.workshop.repairing[0]?.target ?? null;
      if (now !== null && last !== null && now !== last) switches++;
      if (now !== null) last = now;
    }
    // the fractions crossed (the module did switch) – yet all the material went into HP
    expect(switches).toBeGreaterThan(0);
    const healed = [hpOf(sim, 3) - maxHp(t1) / 2, hpOf(sim, 4) - maxHp(t2) / 3];
    expect(healed[0]).toBeCloseTo(Math.min(need[0]!, 3 / fe), 6);
    expect(healed[1]).toBeCloseTo(Math.min(need[1]!, 3 / ti), 6);
    // whole units: exactly the units the healed HP needed (the T1 plate's last unit is not all used)
    expect(p.cargo.iron).toBe(3 - Math.ceil(healed[0]! * fe - 1e-9));
    expect(p.cargo.titanium).toBe(3 - Math.ceil(healed[1]! * ti - 1e-9));
  });

  it('while one module drains the bank, a module of the other material waits instead of taking it', () => {
    // module 2 (lower id, runs first) touches a T2 plate (3); module 4 touches two T1 plates (5, 6)
    const sim = flying(
      createGrid([
        ['cockpit', 0, 0],
        ['repairModule', 0, 1],
        ['armor', 0, 2, 0, 2],
        ['repairModule', 1, 0],
        ['armor', 2, 0],
        ['armor', 1, -1],
        ['reactor', -1, 0],
      ]),
    );
    const p = sim.state.player;
    const fe = repairMaterialPerHp(part(sim, 5)).perHp;
    p.cargo = cargo({ iron: 5, titanium: 5 });
    p.hp.set(5, 20);
    run(sim, 30);
    expect(p.repair?.part).toBe(5);
    // the other T1 plate drops below plate 5 and the T2 plate is damaged: the Fe bank moves to plate 6
    p.hp.set(6, 5);
    p.hp.set(3, 30);
    const hp = (id: number): number => hpOf(sim, id);
    const before = { iron: p.cargo.iron, hp5: hp(5), hp6: hp(6), bank: p.repair!.bank };
    run(sim, 1);
    const fePaid = (hp(5) - before.hp5 + hp(6) - before.hp6 + (p.repair?.part === 5 || p.repair?.part === 6 ? p.repair.bank : 0) - before.bank) * fe;
    expect(fePaid).toBeCloseTo(before.iron - p.cargo.iron, 9);
    expect(p.repair?.part).toBe(6);
    expect(hp(3)).toBe(30);
  });
});

describe('determinism', () => {
  it('two runs of the same workshop game are identical', () => {
    const make = (): Simulation => {
      const sim = flying(workshopShip([['repairModule', 3, 0], ['refinery', -2, 1]]));
      const p = sim.state.player;
      p.cargo = cargo({ iron: 30, titanium: 3, copper: 7, ice: 12 });
      p.fuel = p.props.fuelCapacity - 6;
      p.hp.set(ARMOR_E, 32);
      p.hp.set(ARMOR_N, 9);
      p.hp.set(COCKPIT, 40);
      return sim;
    };
    const a = make();
    const b = make();
    const cmd: PlayerCommand = { ...IDLE_COMMAND, flight: { forward: 0.3, strafe: 0, turn: 0.2 } };
    const ea = run(a, 1500, cmd);
    const eb = run(b, 1500, cmd);
    expect(eb).toEqual(ea);
    expect(b.state.player.refined).toEqual(a.state.player.refined);
    expect([...b.state.player.hp]).toEqual([...a.state.player.hp]);
    expect(b.state.player.repair).toEqual(a.state.player.repair);
    expect(ea.some((e) => e.type === 'partRepaired')).toBe(true);
  });
});

describe('a starter game is unaffected', () => {
  it('no workshop parts: the workshop stays idle and sends nothing', () => {
    const sim = dockedSim();
    act(sim, { type: 'undock' });
    const events = run(sim, 120);
    expect(events.some((e) => e.type === 'workshopIdle' || e.type === 'partRepaired')).toBe(false);
    expect(sim.state.player.workshop).toEqual({ refining: null, repairing: [] });
  });
});
