import { describe, expect, it } from 'vitest';
import { STATION_SERVICES } from '../../data/stations';
import { IDLE_COMMAND, type GameAction } from '../commands';
import { loadSave } from '../save/load';
import { toEnvelope, toSave } from '../save/serialize';
import { testContext } from '../save/testing';
import type { DeathPenalty } from '../settings';
import { maxHp } from '../ship/hp';
import { createStarterShip } from '../ship/presets';
import { loanStarterShip } from '../ship/loan';
import { INSTALL_FEE, partBuyPrice, partSellPrice, scrapResources, towCost } from '../../data/economy';
import type { ResourceId } from '../../data/resources';
import { components } from '../combat/damage';
import { lootEmpty } from '../combat/wrecks';
import { missingParts } from '../ship/blueprint';
import { storedWorth } from '../station/guildLoan';
import { partKey } from '../../data/parts';
import { createWreck, emptyLoot } from '../combat/wrecks';
import { computeProperties } from '../ship/properties';
import { createGrid } from '../ship/grid';
import { Simulation } from '../Simulation';
import { dockPose } from '../station/dock';
import { homeOnly } from '../station/testHarness';
import type { ChunkGenerator } from '../world/generate';
import { HOME_STATION_ID, homeStation, type StationDef } from '../world/stations';
import { applyDeath, DEATH_RULES, planDeath } from './death';

const undock = { ...IDLE_COMMAND, actions: [{ reqId: 1, type: 'undock' } as GameAction] };

/** dyingGame of a broke player: no credits, nothing stored at home. */
function brokeDying(deathPenalty: DeathPenalty): Simulation {
  const sim = dyingGame(deathPenalty);
  sim.state.credits = 0;
  sim.state.stations.get(HOME_STATION_ID)!.parts = {};
  sim.state.stations.get(HOME_STATION_ID)!.resources.iron = 0;
  return sim;
}

/** A bigger ship than the starter – so it is visible whether it was restored from the respawn point. */
const bigShip = () =>
  createGrid([
    ['cockpit', 1, 0],
    ['gyro', 0, 0],
    ['miningLaser', 2, 0, 0],
    ['reactor', -1, 0],
    ['cargo', 0, 1],
    ['cargo', 0, -1],
    ['fuelTank', 1, 1],
    ['fuelTank', 1, -1],
    ['engine', -1, 1, 0],
    ['engine', -1, -1, 0],
    ['engine', 2, 1, 2],
    ['engine', 2, -1, 2],
    ['engine', 0, -2, 1],
    ['engine', 0, 2, 3],
    ['armor', 3, 0, 0, 2],
  ]);

/** A game with a bigger ship, damaged, with cargo, in space far from home. */
function dyingGame(deathPenalty: DeathPenalty): Simulation {
  const sim = new Simulation({ seed: 1, generator: homeOnly, grid: bigShip(), settings: { deathPenalty } });
  sim.state.stations.get(HOME_STATION_ID)!.parts['engine:2'] = 3;
  sim.state.stations.get(HOME_STATION_ID)!.resources.iron = 50;
  sim.state.credits = 1234;
  sim.step(undock);
  const p = sim.state.player;
  p.cargo.iron = 30;
  p.fuel = 3;
  p.hp.set(1, 5);
  p.dampers = false;
  p.body = { pos: { x: 900, y: -400 }, vel: { x: 20, y: 0 }, angle: 2, angVel: 1 };
  p.prevBody = p.body;
  sim.step(IDLE_COMMAND);
  return sim;
}

describe('DEATH_RULES', () => {
  it('matches the penalties chosen by the user (spec 9.5 + 15.2/15.7)', () => {
    expect(DEATH_RULES).toEqual({
      none: { ship: 'respawnSnapshot', partHpFraction: 1, keepCargo: true, fuelFraction: 1, fallTo: null },
      mild: { ship: 'respawnSnapshot', partHpFraction: 0.4, keepCargo: false, fuelFraction: 0.25, fallTo: null },
      hard: { ship: 'starter', partHpFraction: 1, keepCargo: false, fuelFraction: 1, fallTo: null },
      hardcore: { ship: 'starter', partHpFraction: 1, keepCargo: false, fuelFraction: 1, fallTo: 'hard' },
    });
  });
});

describe('applyDeath – common', () => {
  it.each<DeathPenalty>(['none', 'mild', 'hard', 'hardcore'])('%s: respawns docked at the last station, keeps credits, storages and world', (penalty) => {
    const sim = dyingGame(penalty);
    const storages = structuredClone([...sim.state.stations]);
    const explored = [...sim.state.world.explored];
    const outcome = applyDeath(sim);
    const p = sim.state.player;
    const pose = dockPose(homeStation(), p.props.boundingRadius);
    expect(outcome).toMatchObject({ penalty, stationId: HOME_STATION_ID, evacuated: false });
    expect(outcome.events).toContainEqual({ type: 'docked', stationId: HOME_STATION_ID });
    expect(p.dock).toEqual({ mode: 'docked', stationId: HOME_STATION_ID });
    expect(p.body).toEqual(pose);
    expect(p.prevBody).toEqual(pose);
    expect(p.dampers).toBe(true);
    expect(p.energy).toBe(p.props.batteryCapacity);
    expect(p.beams).toEqual([]);
    expect(sim.state.credits).toBe(1234);
    expect([...sim.state.stations]).toEqual(storages);
    expect([...sim.state.world.explored]).toEqual(explored);
    expect(sim.state.stats.deaths).toBe(1);
    expect(sim.state.respawn).toEqual({ stationId: HOME_STATION_ID, grid: p.grid });
    expect(sim.state.world.center()).toEqual({ cx: 0, cy: 0 });
  });

  it('produces a state that saves and loads cleanly', () => {
    for (const penalty of ['none', 'mild', 'hard', 'hardcore'] as const) {
      const sim = dyingGame(penalty);
      applyDeath(sim);
      expect(loadSave(toEnvelope(toSave(sim, testContext('death')))).ok).toBe(true);
    }
  });

  it('bumps the grid version so the renderer rebuilds the ship', () => {
    const sim = dyingGame('hard');
    const before = sim.state.player.gridVersion;
    applyDeath(sim);
    expect(sim.state.player.gridVersion).toBeGreaterThan(before);
  });
});

describe('applyDeath – combat (M3a)', () => {
  it('revives a destroyed ship; salvaged parts on board are lost on every death (saboteur report X3)', () => {
    for (const penalty of ['none', 'mild', 'hard'] as const) {
      const sim = dyingGame(penalty);
      const p = sim.state.player;
      const storedBefore = sim.state.stations.get(HOME_STATION_ID)?.parts['cannon:1'] ?? 0;
      p.destroyed = true;
      p.salvage = { 'cannon:1': 2 };
      // a destroyed game saves and loads as destroyed (no escape from death by loading)
      const loaded = loadSave(toEnvelope(toSave(sim, testContext('interval'))));
      expect(loaded.ok && loaded.save.player.destroyed).toBe(true);
      applyDeath(sim);
      expect(p.destroyed).toBe(false);
      const stored = sim.state.stations.get(sim.state.respawn.stationId)?.parts['cannon:1'] ?? 0;
      expect(stored, penalty).toBe(storedBefore);
      expect(p.salvage).toEqual({});
    }
  });
});

describe('applyDeath – penalties', () => {
  it('none: the ship as it was before the fatal event (its damage too – a death repairs nothing), cargo kept, full tank', () => {
    const sim = dyingGame('none');
    applyDeath(sim);
    const p = sim.state.player;
    expect(p.grid).toEqual(bigShip());
    expect([...p.hp]).toEqual([[1, 5]]);
    expect(p.cargo.iron).toBe(30);
    expect(p.fuel).toBe(p.props.fuelCapacity);
  });

  it('mild: the ship at most 40 % HP, cargo lost, a quarter tank', () => {
    const sim = dyingGame('mild');
    applyDeath(sim);
    const p = sim.state.player;
    expect(p.grid).toEqual(bigShip());
    expect(p.hp.get(1)).toBe(5);
    for (const part of p.grid.parts) if (part.id !== 1) expect(p.hp.get(part.id)).toBe(Math.round(maxHp(part) * 0.4));
    expect(p.cargo).toEqual({ iron: 0, copper: 0, ice: 0, titanium: 0 });
    expect(p.fuel).toBeCloseTo(p.props.fuelCapacity * 0.25, 9);
  });

  it('I6: none / mild – parts lost before the fatal event stay lost (the blueprint gaps), the fatal hit takes nothing', () => {
    for (const penalty of ['none', 'mild'] as const) {
      const sim = dyingGame(penalty);
      const p = sim.state.player;
      const armor = p.grid.parts.find((part) => part.partId === 'armor')!;
      // the armor was shot off on the way; later the cockpit fell (the fatal event)
      p.grid = { ...p.grid, parts: p.grid.parts.filter((part) => part.id !== armor.id) };
      const beforeFatal = structuredClone(p.grid);
      p.destroyed = true;
      applyDeath(sim);
      expect(p.grid, penalty).toEqual(beforeFatal);
      expect(missingParts(p.blueprint, p.grid).map((part) => part.id), penalty).toEqual([armor.id]);
    }
  });

  it('I5: hard – the Guild lends only what the player cannot buy here; the rest is the blueprint gap to restore', () => {
    const sim = dyingGame('hard');
    applyDeath(sim);
    const p = sim.state.player;
    // 1234 cr, three T2 engines and 50 iron at home buy part of the starter hull – those are not lent
    expect(p.grid.parts.length).toBeLessThan(createStarterShip().parts.length);
    expect(p.grid.parts.every((part) => part.loan === true)).toBe(true);
    expect(p.grid.parts.some((part) => part.partId === 'cockpit')).toBe(true);
    expect(components(p.grid.parts)).toHaveLength(1);
    expect(p.blueprint).toEqual(createStarterShip());
    const missing = missingParts(p.blueprint, p.grid);
    expect(missing.length).toBe(createStarterShip().parts.length - p.grid.parts.length);
    // what is missing costs no more than the player has here
    const price = missing.reduce((s, part) => s + partBuyPrice(partKey(part.partId, part.tier), 1)! + INSTALL_FEE, 0);
    expect(price).toBeLessThanOrEqual(storedWorth(sim.state, homeStation()));
    // a rich player gets the bare cockpit
    const rich = dyingGame('hard');
    rich.state.credits = 1_000_000;
    applyDeath(rich);
    expect(rich.state.player.grid.parts.map((part) => part.partId)).toEqual(['cockpit']);
  });

  it('I5: hard – the Guild never lends more hull than the death took (a ship stripped before dying gets little)', () => {
    const sim = new Simulation({ seed: 1, generator: homeOnly, grid: createGrid([['cockpit', 1, 0], ['cargo', 0, 0], ['engine', -1, 0, 0]]), settings: { deathPenalty: 'hard' } });
    sim.state.credits = 0;
    sim.step(undock);
    const lost = sim.state.player.grid.parts.reduce((s, p) => s + partSellPrice(partKey(p.partId, p.tier)), 0);
    sim.state.player.destroyed = true;
    applyDeath(sim);
    const lent = sim.state.player.grid.parts.reduce((s, p) => s + partSellPrice(partKey(p.partId, p.tier)), 0);
    expect(lent).toBeLessThanOrEqual(lost);
    expect(sim.state.player.grid.parts.some((p) => p.partId === 'cockpit')).toBe(true);
  });

  it('hard: installed parts and cargo are lost, a broke player gets the starter ship lent by the Guild, storages stay', () => {
    const sim = brokeDying('hard');
    const outcome = applyDeath(sim);
    const p = sim.state.player;
    expect(p.grid).toEqual(loanStarterShip());
    expect(p.grid.parts.every((part) => part.loan === true)).toBe(true);
    expect(p.props).toEqual(computeProperties(createStarterShip()));
    expect(p.hp.size).toBe(0);
    expect(p.cargo).toEqual({ iron: 0, copper: 0, ice: 0, titanium: 0 });
    expect(p.fuel).toBe(p.props.fuelCapacity);
    expect(outcome.fellFromHardcore).toBe(false);
    expect(sim.state.settings.deathPenalty).toBe('hard');
  });

  it('hardcore: the hard penalty and the game falls to the hard difficulty', () => {
    const sim = brokeDying('hardcore');
    const outcome = applyDeath(sim);
    expect(outcome.fellFromHardcore).toBe(true);
    expect(sim.state.settings).toMatchObject({ deathPenalty: 'hard', fallenFromHardcore: true });
    expect(sim.state.player.grid).toEqual(loanStarterShip());
    // the second death is already an ordinary death in Hard
    const second = applyDeath(sim);
    expect(second).toMatchObject({ penalty: 'hard', fellFromHardcore: false });
    expect(sim.state.settings.fallenFromHardcore).toBe(true);
    expect(sim.state.stats.deaths).toBe(2);
  });
});

// ---- respawn point and free evacuation ----

const station = (id: string, cx: number, pos: { x: number; y: number }, kind: StationDef['kind']): StationDef => ({
  ...homeStation(),
  id,
  kind,
  pos,
  chunk: { cx, cy: 0 },
  services: STATION_SERVICES[kind],
});

const outpost = station('st:5,0', 5, { x: 1100, y: 100 }, 'outpost');
const yard = station('st:4,0', 4, { x: 900, y: 100 }, 'station');

const worldWith =
  (...stations: StationDef[]): ChunkGenerator =>
  (s, cx, cy) => {
    const found = stations.find((st) => st.chunk.cx === cx && st.chunk.cy === cy);
    return { ...homeOnly(s, cx, cy), ...(found ? { station: found } : {}) };
  };

/** A game docked at the `outpost` (respawn point), then departure and death. */
function diedAfterOutpost(penalty: DeathPenalty, ...stations: StationDef[]): Simulation {
  const sim = new Simulation({ seed: 1, generator: worldWith(...stations), settings: { deathPenalty: penalty }, startDocked: false });
  const pose = dockPose(outpost, sim.state.player.props.boundingRadius);
  sim.state.world.update(pose.pos);
  sim.enterDocked(outpost.id, pose);
  sim.step(IDLE_COMMAND);
  expect(sim.state.respawn.stationId).toBe(outpost.id);
  sim.step(undock);
  return sim;
}

describe('respawn station and evacuation', () => {
  it('respawns at the last visited station, not at home', () => {
    const sim = diedAfterOutpost('mild', outpost, yard);
    expect(applyDeath(sim)).toMatchObject({ stationId: outpost.id, evacuated: false });
  });

  it('evacuates a ship-less player from a station without a shipyard to the nearest discovered shipyard', () => {
    const sim = diedAfterOutpost('hard', outpost, yard);
    const plan = planDeath(sim);
    expect(plan.respawnStation.id).toBe(outpost.id);
    expect(plan.evacuation?.id).toBe(yard.id);
    const outcome = applyDeath(sim);
    expect(outcome).toMatchObject({ stationId: yard.id, evacuated: true });
    expect(sim.state.player.dock).toEqual({ mode: 'docked', stationId: yard.id });
    expect(sim.state.respawn.stationId).toBe(yard.id);
  });

  it('lets the player decline the evacuation', () => {
    const sim = diedAfterOutpost('hardcore', outpost, yard);
    expect(applyDeath(sim, { evacuate: false })).toMatchObject({ stationId: outpost.id, evacuated: false });
  });

  it('falls back to the home shipyard when no other shipyard is known', () => {
    const sim = diedAfterOutpost('hard', outpost);
    expect(planDeath(sim).evacuation?.id).toBe(HOME_STATION_ID);
    expect(applyDeath(sim)).toMatchObject({ stationId: HOME_STATION_ID, evacuated: true });
  });

  it('evacuates to a shipyard when the restored ship could not fly (no forward thrust) – also on mild and none (F1)', () => {
    const starter = createStarterShip();
    const engineless = { ...starter, parts: starter.parts.filter((p) => !(p.partId === 'engine' && p.rot === 0)) };
    for (const penalty of ['mild', 'none'] as const) {
      const sim = new Simulation({ seed: 1, generator: worldWith(outpost, yard), grid: engineless, settings: { deathPenalty: penalty }, startDocked: false });
      const pose = dockPose(outpost, sim.state.player.props.boundingRadius);
      sim.state.world.update(pose.pos);
      sim.enterDocked(outpost.id, pose);
      sim.step(IDLE_COMMAND);
      sim.step(undock);
      const plan = planDeath(sim);
      expect(plan.rule.ship, penalty).toBe('respawnSnapshot');
      expect(plan.respawnStation.id, penalty).toBe(outpost.id);
      expect(plan.evacuation?.id, penalty).toBe(yard.id);
      expect(applyDeath(sim), penalty).toMatchObject({ stationId: yard.id, evacuated: true });
      // the layout is restored as it was – the shipyard can fit new engines
      expect(sim.state.player.props.thrust.forward, penalty).toBe(0);
    }
  });

  it('offers no evacuation when the ship is restored or the station has a shipyard', () => {
    expect(planDeath(diedAfterOutpost('none', outpost, yard)).evacuation).toBeNull();
    expect(planDeath(diedAfterOutpost('mild', outpost, yard)).evacuation).toBeNull();
    expect(planDeath(dyingGame('hard')).evacuation).toBeNull();
  });

  it('respawns at home when the respawn station cannot be resolved', () => {
    const sim = dyingGame('mild');
    sim.state.respawn = { ...sim.state.respawn, stationId: 'bogus' };
    expect(applyDeath(sim).stationId).toBe(HOME_STATION_ID);
  });
});

// ---- voluntary scuttle (saboteur report X4) and own wrecks (X3) ----

/** dyingGame, abandoned by the player instead of killed by the world. */
function scuttledGame(penalty: DeathPenalty, credits = 1234): Simulation {
  const sim = dyingGame(penalty);
  sim.state.credits = credits;
  // a damaged laser (part 3) – the cockpit (part 1) goes with the scuttle
  sim.state.player.hp.set(3, 5);
  sim.step({ ...IDLE_COMMAND, scuttle: true });
  expect(sim.state.player).toMatchObject({ destroyed: true, scuttled: true });
  return sim;
}

describe('applyDeath – voluntary scuttle', () => {
  it('is never cheaper than a tow: the tow fee to the respawn station is charged', () => {
    for (const penalty of ['none', 'mild', 'hard'] as const) {
      const sim = scuttledGame(penalty);
      const { pos } = sim.state.player.body;
      const fee = towCost(Math.hypot(pos.x, pos.y));
      expect(planDeath(sim).scuttle, penalty).toEqual({ fee, free: false });
      const outcome = applyDeath(sim);
      expect(sim.state.credits, penalty).toBe(1234 - fee);
      expect(outcome.events, penalty).toContainEqual({ type: 'creditsChanged', delta: -fee, reason: 'tow' });
      expect(sim.state.player.scuttled, penalty).toBe(false);
    }
  });

  it('none: the ship arrives as it was – no repair, no refuel, lost parts stay lost; the cargo stays in the wreck', () => {
    const sim = scuttledGame('none');
    const p = sim.state.player;
    const wreck = sim.state.combat.wrecks.find((w) => w.loot.cargo.iron > 0);
    expect(wreck?.loot.cargo.iron).toBe(30);
    applyDeath(sim);
    expect(p.grid).toEqual(bigShip());
    expect(p.hp.get(3)).toBe(5);
    expect(p.fuel).toBe(3);
    expect(p.cargo.iron).toBe(0);
  });

  it('none: a player who cannot pay the fee is brought in for free', () => {
    const sim = scuttledGame('none', 10);
    expect(planDeath(sim).scuttle).toMatchObject({ free: true });
    applyDeath(sim);
    expect(sim.state.credits).toBe(10);
    expect(sim.state.player.cargo.iron).toBe(0);
  });

  it('none: parts lost since the last dock are not restored by a scuttle', () => {
    const sim = dyingGame('none');
    const p = sim.state.player;
    p.grid = { ...p.grid, parts: p.grid.parts.filter((part) => part.partId !== 'armor') };
    sim.step({ ...IDLE_COMMAND, scuttle: true });
    applyDeath(sim);
    expect(p.grid.parts.some((part) => part.partId === 'armor')).toBe(false);
  });

  it('mild: the penalty on top – damage at most 40 %, the tank at most a quarter, cargo lost', () => {
    const sim = scuttledGame('mild');
    const p = sim.state.player;
    applyDeath(sim);
    expect(p.hp.get(3)).toBe(5);
    for (const part of p.grid.parts) if (part.id !== 3) expect(p.hp.get(part.id)).toBe(Math.round(maxHp(part) * 0.4));
    expect(p.fuel).toBe(3);
    expect(p.cargo.iron).toBe(0);
  });

  it('hard: the Guild loan hull with the old tank level (at most full), never a refuel', () => {
    const sim = scuttledGame('hard', 0);
    sim.state.stations.get(HOME_STATION_ID)!.parts = {};
    sim.state.stations.get(HOME_STATION_ID)!.resources.iron = 0;
    applyDeath(sim);
    expect(sim.state.player.grid).toEqual(loanStarterShip());
    expect(sim.state.player.fuel).toBe(3);
  });
});

describe('applyDeath – own wrecks', () => {
  it('a restored ship takes every copy of its parts back out of the player own wrecks – intact or scrap (I6)', () => {
    for (const penalty of ['none', 'mild'] as const) {
      const sim = dyingGame(penalty);
      const p = sim.state.player;
      const armor = p.grid.parts.find((part) => part.partId === 'armor')!;
      const laser = p.grid.parts.find((part) => part.partId === 'miningLaser')!;
      // the fatal event knocked the armor off whole and the laser as scrap; both come back with the ship
      const armorKey = partKey(armor.partId, armor.tier);
      const loot = emptyLoot();
      loot.parts[armorKey] = 1;
      sim.state.combat.wrecks.push(createWreck(99, [armor], { body: p.body, props: p.props }, { vel: { x: 0, y: 0 }, angVel: 0 }, loot, 'default'));
      const scrap = emptyLoot();
      const laserScrap = scrapResources(partKey(laser.partId, laser.tier), maxHp(laser), maxHp(laser));
      for (const [r, n] of Object.entries(laserScrap)) scrap.cargo[r as ResourceId] = n!;
      sim.state.combat.wrecks.push(createWreck(98, [laser], { body: p.body, props: p.props }, { vel: { x: 0, y: 0 }, angVel: 0 }, scrap, 'default'));
      p.destroyed = true;
      applyDeath(sim);
      expect(p.grid.parts.some((part) => part.id === armor.id), penalty).toBe(true);
      expect(sim.state.combat.wrecks.find((w) => w.id === 99)?.loot.parts[armorKey] ?? 0, penalty).toBe(0);
      expect(lootEmpty(sim.state.combat.wrecks.find((w) => w.id === 98)!.loot), penalty).toBe(true);
    }
  });

  it('only the wrecks of the ship that died give parts back – part ids repeat across the fleet (M4a)', () => {
    const sim = dyingGame('none');
    const p = sim.state.player;
    const armor = p.grid.parts.find((part) => part.partId === 'armor')!;
    const armorKey = partKey(armor.partId, armor.tier);
    const wreckOf = (id: number, ship: number | undefined) => {
      const loot = emptyLoot();
      loot.parts[armorKey] = 1;
      const w = createWreck(id, [armor], { body: p.body, props: p.props }, { vel: { x: 0, y: 0 }, angVel: 0 }, loot, 'default');
      if (ship !== undefined) w.ship = ship;
      sim.state.combat.wrecks.push(w);
    };
    // the same part id on another (stored) ship's wreck, and on this ship's own wreck
    const active = sim.state.fleet.active.id;
    wreckOf(97, active + 1);
    wreckOf(96, active);
    p.destroyed = true;
    applyDeath(sim);
    expect(sim.state.combat.wrecks.find((w) => w.id === 97)?.loot.parts[armorKey]).toBe(1);
    expect(sim.state.combat.wrecks.find((w) => w.id === 96)?.loot.parts[armorKey] ?? 0).toBe(0);
  });
});
