import { describe, expect, it } from 'vitest';
import { COCKPIT_RCS_THRUST, partDef, type PartKey } from '../data/parts';
import { createGrid } from '../sim/ship/grid';
import { createStarterShip } from '../sim/ship/presets';
import type { ShipGrid } from '../sim/ship/types';
import { MAX_SPEED } from '../sim/physics/body';
import { ASSISTED_SPEED } from '../sim/ship/control';
import {
  fuelRange,
  travelFuel,
  partAdvice,
  partEffect,
  shipMetrics,
  shipWeaknesses,
  summarizeShip,
  withPart,
  type EffectRow,
  type MetricId,
} from './partEffect';

const row = (rows: readonly EffectRow[], id: MetricId): EffectRow => {
  const r = rows.find((x) => x.id === id);
  if (!r) throw new Error(`missing row ${id}: ${rows.map((x) => x.id).join(', ')}`);
  return r;
};
const ids = (rows: readonly EffectRow[]): MetricId[] => rows.map((r) => r.id);

/** Starter ship with four large cargo holds bolted on – heavy and slow to turn (26 / 28 b). */
function heavyShip(): ShipGrid {
  const grid = createStarterShip();
  const extra: ShipGrid = createGrid([
    ['largeCargo', -3, 0],
    ['largeCargo', -3, -2],
    ['largeCargo', -5, 0],
    ['largeCargo', -5, -2],
  ]);
  let id = grid.nextId;
  for (const p of extra.parts) grid.parts.push({ ...p, id: id++ });
  grid.nextId = id;
  return grid;
}

/** The heavy ship plus two armor plates – the hull budget is full (28 / 28 b). */
function fullShip(): ShipGrid {
  const grid = heavyShip();
  grid.parts.push({ id: grid.nextId++, partId: 'armor', tier: 1, x: -1, y: 2, rot: 0 });
  grid.parts.push({ id: grid.nextId++, partId: 'armor', tier: 1, x: -1, y: -2, rot: 0 });
  return grid;
}

describe('fuelRange', () => {
  it('counts the run-up and the cruise at top speed until the tank is empty', () => {
    // a = 10 j/s², run-up 6 s; burn 100·0.003 = 0.3 fuel/s → 333.3 s of thrust
    const burn = 100 / 0.3;
    expect(fuelRange(100, 100, 10, 1)).toBeCloseTo(0.5 * 10 * 36 + MAX_SPEED * (burn - 6), 3);
  });
  it('drains a tank that runs dry before top speed', () => {
    // a = 1, burn 1·100·0.003 = 0.3/s → 1/0.3 s, never reaches 60
    const t = 1 / 0.3;
    expect(fuelRange(1, 100, 100, 1)).toBeCloseTo(0.5 * 1 * t * t, 6);
  });
  it('a thirsty engine flies less far', () => {
    expect(fuelRange(100, 100, 10, 1.8)!).toBeLessThan(fuelRange(100, 100, 10, 1)!);
  });
  it('is null without forward thrust', () => {
    expect(fuelRange(100, 0, 10, 1)).toBeNull();
  });
  it('keeps the starter ship range of the formula before travelFuel (M4d)', () => {
    const s = summarizeShip(createStarterShip());
    expect(fuelRange(s.fuel, s.thrust.forward, s.mass, s.fuelUseMult)).toBeCloseTo(13083.333333, 4);
  });
});

describe('travelFuel', () => {
  it('distance and seconds are inverses on both sides of the run-up', () => {
    const t = travelFuel(100, 10, 1)!;
    expect(t.runUp).toBeCloseTo(6, 9);
    for (const s of [0, 2, 6, 50, 300]) expect(t.seconds(t.distance(s))).toBeCloseTo(s, 6);
  });
  it('burns the fuel fuelRange spends: thrust · 0.003 · multiplier per second', () => {
    const t = travelFuel(100, 10, 1.5)!;
    expect(t.fuelPerSecond).toBeCloseTo(0.45, 9);
    const range = fuelRange(90, 100, 10, 1.5)!;
    expect(t.seconds(range) * t.fuelPerSecond).toBeCloseTo(90, 6);
  });
  it('is null without forward thrust or mass', () => {
    expect(travelFuel(0, 10, 1)).toBeNull();
    expect(travelFuel(10, 0, 1)).toBeNull();
  });
});

describe('summarizeShip / shipMetrics', () => {
  it('describes the starter ship in human units', () => {
    const s = summarizeShip(createStarterShip());
    expect(s.mass).toBeCloseTo(25, 6);
    expect(s.hullUsed).toBe(14);
    expect(s.hullBudget).toBe(28);
    const m = shipMetrics(s);
    expect(m.accel).toBeCloseTo(180 / 25, 6);
    expect(m.topSpeedTime).toBeCloseTo(ASSISTED_SPEED / (180 / 25), 6);
    expect(m.brakeTime).toBeCloseTo(ASSISTED_SPEED / (180 / 25), 6);
    expect(m.energyMining).toBeCloseTo(10 - 6, 6);
    expect(m.cargo).toBe(130);
    expect(m.turn180).toBeGreaterThan(2);
    expect(m.turn180).toBeLessThan(4.5);
    expect(m.dps).toBe(0);
  });
  it('a ship without reverse engines brakes slowly with the cockpit RCS', () => {
    const s = summarizeShip(createGrid([['cockpit', 0, 0], ['engine', -1, 0, 0]]));
    expect(s.rcs).toBe(COCKPIT_RCS_THRUST[1]);
    expect(shipMetrics(s).brakeTime).toBeCloseTo(ASSISTED_SPEED / (COCKPIT_RCS_THRUST[1] / s.mass), 6);
    // a T2 cockpit brings stronger RCS
    expect(withPart(s, 'cockpit:2').rcs).toBe(COCKPIT_RCS_THRUST[2]);
    expect(shipMetrics(withPart(s, 'cockpit:2')).brakeTime!).toBeLessThan(shipMetrics(s).brakeTime!);
  });
  it('handles an empty draft', () => {
    const s = summarizeShip({ parts: [], nextId: 1 });
    const m = shipMetrics(s);
    expect(m.turn180).toBeNull();
    expect(m.accel).toBe(0);
    expect(m.topSpeedTime).toBeNull();
  });
});

describe('withPart', () => {
  it('a gyroscope adds torque and mass (inertia grows with the mass)', () => {
    const s = summarizeShip(createStarterShip());
    const a = withPart(s, 'gyro:2');
    expect(a.torque).toBeCloseTo(s.torque + 68, 6);
    expect(a.mass).toBeCloseTo(s.mass + 1.6, 6);
    expect(a.inertia).toBeCloseTo((s.inertia * (s.mass + 1.6)) / s.mass, 6);
    expect(a.hullUsed).toBe(s.hullUsed + 1);
  });
  it('a new cockpit replaces the old one', () => {
    const s = summarizeShip(createStarterShip());
    const a = withPart(s, 'cockpit:2');
    expect(a.hullBudget).toBe(48);
    expect(a.hullUsed).toBe(s.hullUsed);
    expect(a.mass).toBeCloseTo(s.mass - 4 + 3.2, 6);
    expect(a.torque).toBeCloseTo(s.torque - 12 + 18, 6);
    expect(a.cockpit).toEqual({ tier: 2 });
  });
  it('a radar only matters when it sees further', () => {
    const s = summarizeShip(createStarterShip());
    expect(withPart(s, 'radar:1').radar).toBe(s.radar);
    expect(withPart(s, 'radar:2').radar).toBe(260);
  });
  it('a large cargo hold costs 3 hull points', () => {
    const s = summarizeShip(createStarterShip());
    expect(withPart(s, 'largeCargo:1').hullUsed).toBe(s.hullUsed + 3);
  });
  it('a cannon adds fire power and an energy draw while fighting', () => {
    const s = summarizeShip(createStarterShip());
    const a = withPart(s, 'cannon:1');
    const w = partDef('cannon', 1).weapon!;
    expect(a.dps).toBeCloseTo(w.damage * w.fireRate, 6);
    expect(a.combatDraw).toBeCloseTo(w.energyPerShot * w.fireRate, 6);
    expect(a.cannonArc).toBe(120);
  });
  it('an overdrive engine raises the fuel use multiplier', () => {
    const s = summarizeShip(createStarterShip());
    const a = withPart(s, 'engine:1:overdrive');
    expect(a.fuelUseMult).toBeGreaterThan(1);
  });
});

describe('partEffect', () => {
  it('gyroscope: faster half-turn as the main row, acceleration as the mass trade-off', () => {
    const e = partEffect(createStarterShip(), 'gyro:2');
    const turn = row(e.rows, 'turn180');
    expect(turn.role).toBe('main');
    expect(turn.after!).toBeLessThan(turn.before!);
    expect(turn.trend).toBe('better');
    expect(turn.pct!).toBeLessThan(0);
    const accel = row(e.rows, 'accel');
    expect(accel.role).toBe('side');
    expect(accel.trend).toBe('worse');
    expect(row(e.rows, 'hull').after).toBe(15);
    expect(ids(e.rows)[0]).toBe('turn180');
  });
  it('engine: acceleration and time to top speed improve, full-throttle range drops', () => {
    const e = partEffect(createStarterShip(), 'engine:1');
    expect(row(e.rows, 'accel').trend).toBe('better');
    expect(row(e.rows, 'topSpeedTime').trend).toBe('better');
    expect(row(e.rows, 'fuelRange').trend).toBe('worse');
    expect(e.placement).toBe('engineForward');
    // the extra mass is the price: the ship turns a little slower
    expect(row(e.rows, 'turn180')).toMatchObject({ role: 'side', trend: 'worse' });
  });
  it('mining laser: more ore per second, less energy while mining', () => {
    const e = partEffect(createStarterShip(), 'miningLaser:1');
    expect(row(e.rows, 'miningRate').after).toBeCloseTo(5, 6);
    const energy = row(e.rows, 'energyMining');
    expect(energy.before).toBeCloseTo(4, 6);
    expect(energy.after).toBeCloseTo(-2, 6);
    expect(energy.trend).toBe('worse');
  });
  it('cargo, fuel tank, reactor, battery, shield, tractor beam and armor each lead with their own job', () => {
    const lead = (key: PartKey): MetricId => partEffect(createStarterShip(), key).rows[0]!.id;
    expect(lead('cargo:1')).toBe('cargo');
    expect(lead('largeCargo:2')).toBe('cargo');
    expect(lead('fuelTank:1')).toBe('fuelRange');
    expect(lead('reactor:1')).toBe('energyMining');
    expect(lead('battery:1')).toBe('battery');
    expect(lead('shield:1')).toBe('shieldCapacity');
    expect(lead('tractorBeam:1')).toBe('tractorRange');
    expect(lead('armor:1')).toBe('hp');
    expect(lead('radar:2')).toBe('radar');
    expect(lead('cannon:1')).toBe('dps');
    expect(lead('heavyLaser:1')).toBe('miningRate');
    expect(lead('cockpit:2')).toBe('hull');
  });
  it('a cannon marks its coverage as placement dependent', () => {
    const e = partEffect(createStarterShip(), 'cannon:1');
    expect(e.placement).toBe('cannonArc');
    expect(row(e.rows, 'cannonArc').after).toBe(120);
  });
  it('the hull row turns red when the part does not fit the budget', () => {
    const grid = fullShip();
    const s = summarizeShip(grid);
    expect(s.hullUsed).toBe(28);
    const hull = row(partEffect(grid, 'armor:1').rows, 'hull');
    expect(hull.trend).toBe('worse');
  });
  it('the same cockpit changes nothing', () => {
    const e = partEffect(createStarterShip(), 'cockpit:1');
    expect(e.rows.every((r) => r.trend === 'same')).toBe(true);
  });
  it('a battery shows how long mining lasts when the energy balance is negative', () => {
    const grid = createStarterShip();
    grid.parts.push({ id: grid.nextId++, partId: 'miningLaser', tier: 1, x: 2, y: 2, rot: 0 });
    const e = partEffect(grid, 'battery:1');
    const end = row(e.rows, 'miningEndurance');
    expect(end.before).toBeCloseTo(60 / 2, 6);
    expect(end.after).toBeCloseTo(180 / 2, 6);
    expect(end.trend).toBe('better');
  });
});

describe('shipWeaknesses', () => {
  it('the starter ship has none', () => {
    expect(shipWeaknesses(summarizeShip(createStarterShip()))).toEqual([]);
  });
  it('a heavy ship turns slowly', () => {
    const w = shipWeaknesses(summarizeShip(heavyShip()));
    expect(w.map((x) => x.id)).toContain('slowTurn');
  });
  it('a ship without backward engines cannot brake', () => {
    const grid = createStarterShip();
    grid.parts = grid.parts.filter((p) => !(p.partId === 'engine' && p.rot === 2));
    const w = shipWeaknesses(summarizeShip(grid));
    expect(w[0]!.id).toBe('noBrake');
    expect(w[0]!.severity).toBe('high');
  });
  it('a negative mining balance comes first', () => {
    const grid = createStarterShip();
    grid.parts = grid.parts.filter((p) => p.partId !== 'reactor' && !(p.partId === 'engine' && p.rot === 2));
    const w = shipWeaknesses(summarizeShip(grid));
    expect(w[0]!.id).toBe('miningEnergy');
  });
});

describe('partAdvice', () => {
  it('names the weakness the part fixes', () => {
    const e = partEffect(heavyShip(), 'gyro:1');
    const a = partAdvice(e, 'gyro');
    expect(a).toMatchObject({ kind: 'fixes', weakness: 'slowTurn', tone: 'ok' });
  });
  it('warns when the part does not fit the hull budget (before anything else)', () => {
    // 28 / 28 b – even the gyroscope the slow ship needs does not fit
    expect(partAdvice(partEffect(fullShip(), 'gyro:1'), 'gyro')).toMatchObject({ kind: 'noRoom', tone: 'warn' });
    expect(partAdvice(partEffect(fullShip(), 'armor:1'), 'armor')).toMatchObject({ kind: 'noRoom', tone: 'warn' });
  });
  it('warns when the part makes mining drain the battery', () => {
    const a = partAdvice(partEffect(createStarterShip(), 'miningLaser:1'), 'miningLaser');
    expect(a).toMatchObject({ kind: 'causes', weakness: 'miningEnergy', tone: 'warn' });
  });
  it('says when the part adds nothing', () => {
    expect(partAdvice(partEffect(createStarterShip(), 'radar:1'), 'radar')).toMatchObject({ kind: 'noEffect' });
    expect(partAdvice(partEffect(createStarterShip(), 'cockpit:1'), 'cockpit')).toMatchObject({ kind: 'noEffect' });
  });
  it('stays quiet on a healthy ship', () => {
    expect(partAdvice(partEffect(createStarterShip(), 'cargo:1'), 'cargo')).toBeNull();
    expect(partAdvice(partEffect(createStarterShip(), 'gyro:1'), 'gyro')).toBeNull();
  });
  it('mentions a severe unrelated weakness, but only a severe one', () => {
    const grid = createStarterShip();
    grid.parts = grid.parts.filter((p) => !(p.partId === 'engine' && p.rot === 2));
    expect(partAdvice(partEffect(grid, 'cargo:1'), 'cargo')).toMatchObject({ kind: 'general', weakness: 'noBrake' });
    expect(partAdvice(partEffect(grid, 'engine:1'), 'engine')).toMatchObject({ kind: 'fixes', weakness: 'noBrake' });
  });
});

describe('hull row', () => {
  it('a bigger cockpit raises the budget (better), the combat cockpit lowers it (worse)', () => {
    const t2 = row(partEffect(createStarterShip(), 'cockpit:2').rows, 'hull');
    expect(t2).toMatchObject({ budgetBefore: 28, budgetAfter: 48, trend: 'better' });
    const combat = row(partEffect(createStarterShip(), 'cockpit:1:combat').rows, 'hull');
    expect(combat).toMatchObject({ budgetBefore: 28, budgetAfter: 24, trend: 'worse' });
  });
  it('an ordinary part that fits leaves the hull row neutral', () => {
    expect(row(partEffect(createStarterShip(), 'armor:1').rows, 'hull')).toMatchObject({ before: 14, after: 15, trend: 'same' });
  });
});

describe('shaped armour (SL2 E2)', () => {
  it('sums the max HP of shaped parts and their ½ hull points', () => {
    const grid = createStarterShip();
    const full = summarizeShip(grid);
    grid.parts.push({ id: grid.nextId++, partId: 'armor', tier: 1, x: -1, y: 2, rot: 0, shape: 'wedge' });
    const s = summarizeShip(grid);
    expect(s.hp - full.hp).toBe(20);
    expect(s.hullUsed - full.hullUsed).toBe(0.5);
  });

  it('adds the shape in hand: a wedge costs ½ b and brings half the HP', () => {
    const grid = createStarterShip();
    const before = summarizeShip(grid);
    const wedge = withPart(before, 'armor:1', 'wedge');
    expect(wedge.hp - before.hp).toBe(20);
    expect(wedge.hullUsed - before.hullUsed).toBe(0.5);
    const nose = partEffect(grid, 'armor:2', 'nose2x1');
    expect(nose.after.hullUsed - nose.before.hullUsed).toBe(1.5);
    expect(nose.after.hp - nose.before.hp).toBe(Math.round(partDef('armor', 2).hp * 1.67));
    // no shape = the full part, as before
    expect(withPart(before, 'armor:1').hp - before.hp).toBe(partDef('armor', 1).hp);
    expect(withPart(before, 'armor:1', null).hullUsed - before.hullUsed).toBe(1);
  });
});
