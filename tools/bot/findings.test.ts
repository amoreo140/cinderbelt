// Issues the balance bot ran into (see reports/econ/bot-report.md, "Findings"), kept as regression
// tests after the fixes: each test replays the situation the bot got stuck in.
// The second block holds the saboteur findings (reports/econ/saboteur-report.md): each test first
// demonstrated the exploit or softlock and now guards its fix.
import { describe, expect, it } from 'vitest';
import { partBuyPrice } from '../../src/data/economy';
import type { PartKey } from '../../src/data/parts';
import { emptyCargo } from '../../src/data/resources';
import { STATION_LAYOUTS, STATION_SERVICES } from '../../src/data/stations';
import { IDLE_COMMAND, type GameAction, type GameActionInput } from '../../src/sim/commands';
import { planDeath } from '../../src/sim/death/death';
import { createGrid } from '../../src/sim/ship/grid';
import { createStarterShip } from '../../src/sim/ship/presets';
import { Simulation } from '../../src/sim/Simulation';
import { dockPose } from '../../src/sim/station/dock';
import { guildLoanOffer, LOAN_ENGINE_KEY, LOAN_LASER_KEY } from '../../src/sim/station/guildLoan';
import { towAvailable } from '../../src/sim/station/tow';
import type { ChunkGenerator } from '../../src/sim/world/generate';
import { HOME_STATION_ID, homeStation, type StationDef } from '../../src/sim/world/stations';
import { Driver, isMiningKey, keyOf, newGame } from './saboteur/harness';
import { liquidate, noneSalvageDupe, partRewardSurvey, quoteSurvey } from './saboteur/scenarios';
import { netWorth } from './saboteur/value';
import { planFromOps } from './shipPlan';

const outpost: StationDef = {
  ...homeStation(),
  id: 'st:2,0',
  kind: 'outpost',
  pos: { x: 450, y: 100 },
  chunk: { cx: 2, cy: 0 },
  model: 'outpost_a',
  radius: STATION_LAYOUTS.outpost_a.radius,
  clearRadius: STATION_LAYOUTS.outpost_a.clearRadius,
  colliders: STATION_LAYOUTS.outpost_a.circles.map((c) => ({ pos: { x: c.x, y: c.y }, radius: c.r })),
  services: STATION_SERVICES.outpost,
};

const world: ChunkGenerator = (_s, cx, cy) => ({
  cx,
  cy,
  asteroids: [],
  ...(cx === 0 && cy === 0 ? { station: homeStation() } : cx === 2 && cy === 0 ? { station: outpost } : {}),
});

let req = 0;
const act = (sim: Simulation, a: GameActionInput) => sim.step({ ...IDLE_COMMAND, actions: [{ ...a, reqId: ++req } as GameAction] });

describe('bot findings – regressions', () => {
  it('F1: a ship without forward engines is towed from an outpost to a station with a shipyard, and dying with that layout evacuates there', () => {
    // pirates shot off the forward engines (bot runs: seeds 9 and 12 in an earlier bot version)
    const starter = createStarterShip();
    const grid = { ...starter, parts: starter.parts.filter((p) => !(p.partId === 'engine' && p.rot === 0)) };
    const sim = new Simulation({ seed: 1, generator: world, grid, startDocked: false });
    const pose = dockPose(outpost, sim.state.player.props.boundingRadius);
    sim.enterDocked(outpost.id, pose);
    expect(towAvailable(sim.state.player)).toBe(true);

    act(sim, { type: 'undock' });
    sim.step(IDLE_COMMAND); // the outpost's chunk gets explored (discovered)
    expect(sim.state.world.discovered.has(outpost.id)).toBe(true);
    const towed = sim.step({ ...IDLE_COMMAND, emergency: true }).find((e) => e.type === 'towed');
    // the outpost is nearer, but it has no shipyard or parts market to replace the engines
    expect(towed && towed.type === 'towed' ? towed.stationId : null).toBe(HOME_STATION_ID);
    expect(sim.state.player.dock).toEqual({ mode: 'docked', stationId: HOME_STATION_ID });

    // the same layout docked at the outpost (it drifted in on its side thrusters): the mild penalty
    // restores that layout, so the respawn is moved to a shipyard instead of the outpost
    sim.enterDocked(outpost.id, pose);
    sim.step(IDLE_COMMAND);
    expect(sim.state.respawn.stationId).toBe(outpost.id);
    const plan = planDeath(sim);
    expect(plan.rule.ship).toBe('respawnSnapshot');
    expect(plan.respawnStation.id).toBe(outpost.id);
    expect(plan.evacuation?.id).toBe(HOME_STATION_ID);
  });
});


// ------------------------------------------------------------------------------------------------
// Saboteur / exploiter findings (reports/econ/saboteur-report.md). Each test first reproduced the
// exploit or softlock (asserting the broken behaviour); since the Guild-loan fix it guards the fix.

const shipyardStation: StationDef = {
  ...homeStation(),
  id: 'st:2,0',
  kind: 'station',
  pos: { x: 450, y: 100 },
  chunk: { cx: 2, cy: 0 },
  model: 'station_a',
  radius: STATION_LAYOUTS.station_a.radius,
  clearRadius: STATION_LAYOUTS.station_a.clearRadius,
  colliders: STATION_LAYOUTS.station_a.circles.map((c) => ({ pos: { x: c.x, y: c.y }, radius: c.r })),
  services: STATION_SERVICES.station,
};

const shipyardWorld: ChunkGenerator = (_s, cx, cy) => ({
  cx,
  cy,
  asteroids: [],
  ...(cx === 0 && cy === 0 ? { station: homeStation() } : cx === 2 && cy === 0 ? { station: shipyardStation } : {}),
});

const loanCount = (d: Driver): number => d.state.player.grid.parts.filter((p) => p.loan).length;

describe('saboteur findings – fixed (Guild loan, scuttle cost, quote floor)', () => {
  it('X1: on Hard, strip → sell → scuttle no longer prints money – the respawn hull is a Guild loan', () => {
    for (const penalty of ['hard', 'hardcore'] as const) {
      const d = new Driver(newGame(1, penalty));
      d.stripToMinimum();
      d.sellStorageParts();
      const before = netWorth(d.state).total;
      expect(d.scuttle()).toBe(true);
      expect(d.state.player.grid.parts.length).toBeLessThanOrEqual(createStarterShip().parts.length);
      expect(loanCount(d), penalty).toBe(d.state.player.grid.parts.length);
      // the loan hull is worth nothing and the Guild charged the tow fee
      expect(netWorth(d.state).total - before, penalty).toBeLessThanOrEqual(0);
      // and it cannot be cashed in: stripping it returns the parts to the Guild, nothing to sell
      d.stripToMinimum();
      expect(d.sellStorageParts(), penalty).toBe(0);
    }
  });

  it('I5: on Hard the respawn loan is means-tested – the usable ship (loan hull at its buy-back value) never grows from a scuttle', () => {
    for (const penalty of ['hard', 'hardcore'] as const) {
      // a richer ship: stripping and selling raises ~5k (the second code review case)
      const d = new Driver(newGame(1, penalty));
      d.state.credits = 5000;
      d.stripToMinimum();
      d.sellStorageParts();
      const before = netWorth(d.state);
      expect(d.scuttle()).toBe(true);
      // the Guild lends only what the player cannot buy, never more hull than the scuttle took
      expect(d.state.player.grid.parts.length, penalty).toBeLessThan(createStarterShip().parts.length);
      expect(netWorth(d.state).loanHull, penalty).toBeLessThanOrEqual(before.ship);
      expect(netWorth(d.state).usable - before.usable, penalty).toBeLessThanOrEqual(0);
      // a broke player: the first scuttle is the safety net, every further cycle gains nothing
      const poor = new Driver(newGame(1, penalty));
      poor.stripToMinimum();
      poor.sellStorageParts();
      expect(poor.scuttle()).toBe(true);
      for (let cycle = 0; cycle < 3; cycle++) {
        poor.stripToMinimum();
        poor.sellStorageParts();
        const w = netWorth(poor.state).usable;
        expect(poor.scuttle()).toBe(true);
        expect(netWorth(poor.state).usable - w, `${penalty} cycle ${cycle}`).toBeLessThanOrEqual(1e-6);
      }
    }
  });

  it('X2: removing lasers / holds before accepting a contract no longer inflates the frozen reward', () => {
    for (const seed of [1, 2]) {
      for (const o of quoteSurvey(seed).offers) {
        expect(o.noLaser, `${seed} ${o.type}`).toBeLessThanOrEqual(o.starter);
        expect(o.minimal, `${seed} ${o.type}`).toBeLessThanOrEqual(o.starter);
      }
    }
  });

  it('X3: on "none", a part knocked off and loaded from the wreck is not duplicated by a scuttle (salvage is lost, the ship arrives as it was)', () => {
    const r = noneSalvageDupe(1, 'none');
    expect(r.detail).toContain('loaded from the wreck true');
    expect(r.exploit, r.detail).toBe(false);
    expect(r.metrics?.perCycle ?? 0).toBeLessThanOrEqual(0);
  });

  it('X4: on "none", scuttling far from home leaves the cargo in the wreck, costs the tow fee, keeps the tank as it was and repairs nothing', () => {
    const d = new Driver(newGame(1, 'none'));
    d.undock();
    d.flyTo({ x: 700, y: 400 }, { seconds: 120 });
    // setup: ore in the hold, a partly used tank and a damaged part, as after a mining trip
    d.state.player.cargo.iron = 60;
    const laser = d.state.player.grid.parts.find((p) => p.partId === 'miningLaser')!;
    d.state.player.hp.set(laser.id, 5);
    d.state.credits = 1000;
    const fuel = d.state.player.fuel;
    expect(fuel).toBeLessThan(d.state.player.props.fuelCapacity);
    expect(d.scuttle()).toBe(true);
    expect(d.docked()?.id).toBe(HOME_STATION_ID);
    expect(d.state.credits).toBeLessThan(1000 - 100);
    expect(d.state.player.cargo.iron).toBe(0);
    expect(d.state.combat.wrecks.some((w) => w.loot.cargo.iron === 60)).toBe(true);
    expect(d.state.player.fuel).toBeCloseTo(fuel, 0);
    expect(d.state.player.hp.get(laser.id)).toBe(5);
    // a broke player is brought in for free; the cargo is in the wreck as well
    const broke = new Driver(newGame(1, 'none'));
    broke.undock();
    broke.flyTo({ x: 700, y: 400 }, { seconds: 120 });
    broke.state.player.cargo.iron = 60;
    broke.state.credits = 0;
    expect(broke.scuttle()).toBe(true);
    expect(broke.state.player.cargo.iron).toBe(0);
  });

  it('X5: the Guild loan cannot be sold – a rich player gets none, a broke one gets a part that never reaches a storage', () => {
    const d = new Driver(newGame(1, 'mild'));
    d.commit(d.state.player.grid.parts.filter((p) => isMiningKey(keyOf(p))).map((p) => ({ op: 'remove' as const, id: p.id })));
    d.sellStorageParts(isMiningKey);
    d.idle(1);
    // the starter hull is worth far more than a laser: no free help
    expect(d.counts.guildLoan ?? 0).toBe(0);
    liquidate(d);
    expect(d.counts.guildLoan).toBeGreaterThanOrEqual(1);
    expect(d.state.player.props.lasers.length).toBeGreaterThan(0);
    const before = netWorth(d.state).total;
    for (let i = 0; i < 3; i++) {
      d.commit(d.state.player.grid.parts.filter((p) => p.loan).map((p) => ({ op: 'remove' as const, id: p.id })));
      expect(d.sellStorageParts()).toBe(0);
      d.idle(10 * 60 + 1);
    }
    expect(netWorth(d.state).total - before).toBeLessThanOrEqual(0);
  });

  it('X6: an exclusive-part contract never pays more (reward + the part sold) than its credit-only reward', () => {
    const rows = partRewardSurvey(1, 1);
    expect(rows.length).toBeGreaterThan(0);
    expect(Math.max(...rows.map((r) => r.ratio))).toBeLessThanOrEqual(1.05);
  });

  it('S1: no forward engine at a non-home shipyard station and poor – the Guild lends an engine there, and the shipyard lets the player strip and sell', () => {
    // pirates or a rock took every engine; the tow brought the ship to the nearest shipyard
    const grid = createGrid([
      ['cockpit', 1, 0],
      ['cargo', 0, 0],
      ['miningLaser', 2, 0],
    ]);
    const sim = new Simulation({ seed: 1, generator: shipyardWorld, grid, startDocked: false, settings: { deathPenalty: 'mild' } });
    expect(sim.state.credits).toBeLessThan(partBuyPrice('engine:1', shipyardStation.ring)!);
    sim.enterDocked(shipyardStation.id, dockPose(shipyardStation, sim.state.player.props.boundingRadius));
    // a removal-only draft is valid on a ship that already cannot fly forward
    const cargo = sim.state.player.grid.parts.find((p) => p.partId === 'cargo')!;
    expect(planFromOps(sim.state, shipyardStation, [{ op: 'remove', id: cargo.id }]).report.errors.map((e) => e.code)).not.toContain('noForwardEngine');
    expect(guildLoanOffer(sim.state, shipyardStation)).toEqual([LOAN_ENGINE_KEY]);
    const credits = sim.state.credits;
    const d = new Driver(sim);
    d.idle(1);
    expect(d.counts.guildLoan).toBe(1);
    expect(sim.state.player.props.thrust.forward).toBeGreaterThan(0);
    expect(sim.state.credits).toBe(credits);
    // the ship flies again: undock and come back
    d.undock();
    expect(d.dockAt(shipyardStation, 60)).toBe(true);
  });

  it('S2: a spare engine stored at another station does not block the Guild loan', () => {
    const grid = createGrid([
      ['cockpit', 1, 0],
      ['cargo', 0, 0],
      ['miningLaser', 2, 0],
    ]);
    const sim = new Simulation({ seed: 1, generator: world, grid, settings: { deathPenalty: 'mild' } });
    // a poor player: nothing in the home storage, no credits
    sim.state.credits = 0;
    sim.state.stations.get(HOME_STATION_ID)!.parts = {};
    expect(guildLoanOffer(sim.state, homeStation())).toEqual([LOAN_ENGINE_KEY]); // control
    // setup: an engine left in the outpost's storage earlier
    sim.state.stations.set(outpost.id, { resources: emptyCargo(), parts: { 'engine:1': 1 } });
    expect(guildLoanOffer(sim.state, homeStation())).toEqual([LOAN_ENGINE_KEY]);
  });

  it('S3: the Guild mounts its loan for free – a broke player mines again at once', () => {
    const d = new Driver(newGame(1, 'mild'));
    liquidate(d);
    d.idle(1);
    expect(d.state.credits).toBeLessThan(10);
    expect(d.state.player.props.lasers.length).toBeGreaterThan(0);
    expect(d.state.player.grid.parts.find((p) => p.partId === 'miningLaser')?.loan).toBe(true);
    expect(d.kitParts[LOAN_LASER_KEY]).toBe(1);
  });
});
