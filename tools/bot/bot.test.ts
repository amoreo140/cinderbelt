import { describe, expect, it } from 'vitest';
import { BOT_GOALS } from './goals';
import { envVar } from './node';
import { runSeed } from './runner';
import { goalSatisfied, personaGoals, planGoalOps, REFINER_WORKSHOP } from './shipPlan';
import { partDef } from '../../src/data/parts';
import { workshopMounts } from '../../src/sim/ship/workshop';
import { createStarterShip } from '../../src/sim/ship/presets';
import { hullPoints } from '../../src/sim/ship/budget';
import { computeProperties } from '../../src/sim/ship/properties';
import { GRAVITY_PULL } from '../../src/data/poi';
import { RESOURCES } from '../../src/data/resources';
import { REGION_GEN, regionWorld } from '../../src/sim/regions';

describe('balance bot – ship plans', () => {
  it('builds every goal of the main path in order on the starter ship within the hull budget', () => {
    let grid = createStarterShip();
    for (const goal of BOT_GOALS) {
      const plan = planGoalOps(grid, goal);
      grid = plan.grid;
      expect(goalSatisfied(grid, goal), goal.id).toBe(true);
      const cockpit = grid.parts.find((p) => p.partId === 'cockpit')!;
      expect(hullPoints(grid), goal.id).toBeLessThanOrEqual(cockpit.tier === 2 ? 48 : 28);
      // the ship keeps forward thrust and every laser fires forward
      const props = computeProperties(grid);
      expect(props.thrust.forward).toBeGreaterThan(0);
      expect(props.lasers.every((l) => l.facing.x === 1)).toBe(true);
    }
  });

  it('every ship of the main path escapes a gravity well with a full hold (F3)', () => {
    let grid = createStarterShip();
    for (const goal of BOT_GOALS) {
      grid = planGoalOps(grid, goal).grid;
      const props = computeProperties(grid);
      const laden = props.mass + props.cargoCapacity * Math.max(...Object.values(RESOURCES).map((r) => r.massPerUnit));
      expect(props.thrust.forward / laden, goal.id).toBeGreaterThan(GRAVITY_PULL);
    }
  });

  it('fills the 28-point T1 hull exactly with the T1 plan – nothing is skipped for lack of hull points', () => {
    let grid = createStarterShip();
    for (const goal of BOT_GOALS) {
      const plan = planGoalOps(grid, goal);
      grid = plan.grid;
      expect(plan.skipped, goal.id).toEqual([]);
      if (goal.id === 'fillT1') expect(hullPoints(grid)).toBe(28);
    }
  });
});

describe('balance bot – the refiner persona (M4c)', () => {
  it('builds the workshop in place of the M3 weapons and the rest of the main path still fits', () => {
    const goals = personaGoals('refiner');
    expect(goals.map((g) => g.id)).toEqual(BOT_GOALS.map((g) => (g.id === 'weapons' ? 'workshop' : g.id)));
    let grid = createStarterShip();
    for (const goal of goals) {
      const plan = planGoalOps(grid, goal);
      grid = plan.grid;
      expect(plan.skipped, goal.id).toEqual([]);
      expect(goalSatisfied(grid, goal), goal.id).toBe(true);
      if (goal.id === 'fillT1') expect(hullPoints(grid)).toBe(28);
      if (goal.id === REFINER_WORKSHOP.id) {
        // the repair module sits beside a mining laser (the bow takes the ram damage)
        const mounts = workshopMounts(grid);
        expect(mounts.refineries).toHaveLength(1);
        expect(mounts.repairs).toHaveLength(1);
        const near = mounts.repairs[0]!.neighbours.map((id) => grid.parts.find((p) => p.id === id)!);
        expect(near.some((p) => !!partDef(p.partId, p.tier, p.variant).mining)).toBe(true);
      }
      const props = computeProperties(grid);
      expect(props.thrust.forward).toBeGreaterThan(0);
      expect(props.lasers.every((l) => l.facing.x === 1)).toBe(true);
    }
  });

  it('buys the Archive nodes, builds the workshop, refines in flight and sells the refined ore', () => {
    const r = runSeed(3, { hours: 0.12, persona: 'refiner', startCredits: 15_000 });
    expect(r.milestones[REFINER_WORKSHOP.id]).toBeDefined();
    expect(r.counts.archiveBought).toBe(REFINER_WORKSHOP.archive!.length);
    expect(r.final.parts['refinery:1']).toBe(1);
    expect(r.final.parts['repairModule:1']).toBe(1);
    expect(r.m4c.refined ?? 0).toBeGreaterThan(10);
    expect(r.m4c.refinedSold ?? 0).toBeGreaterThan(10);
    expect(r.m4c.refinedBonus ?? 0).toBeGreaterThan(0);
    expect(r.stuck).toEqual([]);
    expect(r.deaths).toEqual([]);
  });
});

describe('sectors (design 2026-10-18 §6.4)', () => {
  it('item 1: depths 2 and 3 are balanced into both exposure ranges on 20 seeds', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const w = regionWorld(seed);
      for (const depth of [2, 3] as const) {
        const b = w.balance[depth]!;
        expect(b.ok, `seed ${seed} depth ${depth}: area ${b.area.toFixed(3)} cautious ${b.cautious.toFixed(3)}`).toBe(true);
        expect(b.area).toBeGreaterThanOrEqual(REGION_GEN.balance.area[0]);
        expect(b.area).toBeLessThanOrEqual(REGION_GEN.balance.area[1]);
        expect(b.cautious).toBeGreaterThanOrEqual(REGION_GEN.balance.cautious[0]);
        expect(b.cautious).toBeLessThanOrEqual(REGION_GEN.balance.cautious[1]);
      }
    }
  });

  it('the cautious miner persona plays without getting stuck', () => {
    const r = runSeed(3, { hours: 0.25, persona: 'cautious' });
    expect(r.milestones.firstSale).toBeDefined();
    expect(r.stuck).toEqual([]);
    expect(r.deaths).toEqual([]);
  });

  it('the explorer persona charts sectors by survey points and sells the charts (sectors 2, 6.4 item 6)', () => {
    const r = runSeed(3, { hours: 0.25, persona: 'explorer' });
    expect(r.milestones.firstSale).toBeDefined();
    expect(r.counts.surveyPoints ?? 0).toBeGreaterThan(2);
    expect(r.counts.chartsSold ?? 0).toBeGreaterThan(0);
    expect(r.creditsByReason.chart ?? 0).toBeGreaterThan(0);
    expect(r.stuck).toEqual([]);
    expect(r.deaths).toEqual([]);
  });
});

describe('balance bot – short run', () => {
  it('sells, buys the first upgrades and never gets stuck in 12 game minutes', () => {
    const r = runSeed(3, { hours: 0.2 });
    expect(r.milestones.firstSale).toBeDefined();
    expect(r.milestones.cargo1).toBeDefined();
    expect(r.milestones.laser2).toBeDefined();
    expect(r.stuck).toEqual([]);
    expect(r.deaths).toEqual([]);
    expect(r.trips.length).toBeGreaterThan(3);
  });

  it('plays on from the ship the Guild Training leaves (training played first)', () => {
    const r = runSeed(3, { hours: 0.15, training: 'play' });
    expect(r.milestones.firstSale).toBeDefined();
    expect(r.milestones.cargo1).toBeDefined();
    expect(r.stuck).toEqual([]);
    expect(r.deaths).toEqual([]);
  });

  it('is deterministic for a seed', () => {
    const a = runSeed(5, { hours: 0.05 });
    const b = runSeed(5, { hours: 0.05 });
    expect(a.milestones).toEqual(b.milestones);
    expect(a.final).toEqual(b.final);
  });
});

// Slow: several seeds × 1 game hour (≈ 1 min). Opt-in: BOT_SLOW=1 npm run test:bot
describe.skipIf(!envVar('BOT_SLOW'))('balance bot – slow multi-seed run', () => {
  it('reaches the T1 → T2 path without stuck states or deaths', () => {
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const r = runSeed(seed, { hours: 1 });
      expect(r.stuck, `seed ${seed}`).toEqual([]);
      expect(r.milestones.firstT2, `seed ${seed}`).toBeDefined();
      expect(r.counts.towed ?? 0, `seed ${seed}`).toBe(0);
    }
  });
});
