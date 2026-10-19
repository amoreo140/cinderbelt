import { describe, expect, it } from 'vitest';
import { createEnemy, type SpawnSlot } from './enemies';
import { AGGRO_RANGE, FLEE_SAFE, LEASH_RANGE, LOW_FUEL, steerTo, think } from './ai';
import { AIM_SKILL } from './aim';

const slot = (kind: 'jackal' | 'hammer' = 'jackal'): SpawnSlot => ({
  id: 'pr:0,0:0',
  kind,
  tier: 1,
  pos: { x: 0, y: 0 },
  angle: 0,
  home: { x: 0, y: 0 },
  orbit: 1,
});

const still = (x: number, y: number) => ({ pos: { x, y }, vel: { x: 0, y: 0 } });

describe('steerTo', () => {
  it('turns toward the point and thrusts only when roughly aligned', () => {
    const body = { pos: { x: 0, y: 0 }, vel: { x: 0, y: 0 }, angle: 0, angVel: 0 };
    const ahead = steerTo(body, { x: 10, y: 0 }, 1);
    expect(ahead.forward).toBeCloseTo(1);
    expect(ahead.turn).toBeCloseTo(0);
    const behind = steerTo(body, { x: -10, y: 1 }, 1);
    expect(behind.forward).toBe(0);
    expect(Math.abs(behind.turn)).toBe(1);
  });
});

describe('think', () => {
  it('patrols around home while the player is far or absent', () => {
    const e = createEnemy(slot());
    const holder = { rng: 1 };
    const r = think(e, null, holder);
    expect(r.alerted).toBe(false);
    expect(r.cmd.fire).toBe(false);
    expect(e.ai.mode).toBe('patrol');
    expect(Math.hypot(e.ai.waypoint.x, e.ai.waypoint.y)).toBeLessThanOrEqual(60);
    expect(e.ai.timer).toBeGreaterThanOrEqual(600);
    think(e, still(AGGRO_RANGE.jackal + 5, 0), holder);
    expect(e.ai.mode).toBe('patrol');
  });

  it('attacks a player within aggro range, leading the shot and firing within cannon range after its reaction time', () => {
    const e = createEnemy(slot());
    const target = { pos: { x: 40, y: 0 }, vel: { x: 0, y: 10 } };
    const holder = { rng: 2 };
    const r = think(e, target, holder);
    expect(r.alerted).toBe(true);
    expect(e.ai.mode).toBe('attack');
    // a new target: the gunner holds fire for its reaction time
    expect(r.cmd.fire).toBe(false);
    expect(e.ai.react).toBe(AIM_SKILL.mild.reaction - 1);
    let shots = 0;
    for (let i = 0; i < AIM_SKILL.mild.reaction - 1; i++) if (think(e, target, holder).cmd.fire) shots++;
    expect(shots).toBe(0);
    const ready = think(e, target, holder);
    expect(ready.cmd.fire).toBe(true);
    // aims ahead of the target (in the direction of its movement)
    expect(ready.cmd.aim.y).toBeGreaterThan(0);
    const far = createEnemy(slot());
    far.ai.mode = 'attack';
    expect(think(far, still(120, 0), { rng: 2 }).cmd.fire).toBe(false);
  });

  it('gives up the chase beyond the leash range', () => {
    const e = createEnemy(slot());
    e.ai.mode = 'attack';
    think(e, still(LEASH_RANGE + 1, 0), { rng: 3 });
    expect(e.ai.mode).toBe('patrol');
  });

  it('flees at low hull and calms down far away', () => {
    const e = createEnemy(slot('hammer'));
    for (const p of e.grid.parts) if (p.partId !== 'cockpit') e.hp.set(p.id, 1);
    e.ai.mode = 'attack';
    const r = think(e, still(30, 0), { rng: 4 });
    expect(e.ai.mode).toBe('flee');
    expect(r.cmd.fire).toBe(false);
    think(e, still(FLEE_SAFE + 10, 0), { rng: 4 });
    expect(e.ai.mode).toBe('patrol');
  });

  it('jackals break off after a run and come back', () => {
    const e = createEnemy(slot());
    const holder = { rng: 5 };
    think(e, still(30, 0), holder);
    e.ai.timer = 0;
    think(e, still(30, 0), holder);
    expect(e.ai.breakOff).toBeGreaterThan(0);
    const orbit = e.ai.orbit;
    while (e.ai.breakOff > 0) think(e, still(30, 0), holder);
    expect(e.ai.timer).toBeGreaterThan(200);
    expect(e.ai.orbit).toBe(orbit);
  });

  it('is deterministic for the same rng state', () => {
    const a = createEnemy(slot());
    const b = createEnemy(slot());
    const ha = { rng: 9 };
    const hb = { rng: 9 };
    for (let i = 0; i < 50; i++) {
      const target = still(30 + i, i);
      expect(think(a, target, ha)).toEqual(think(b, target, hb));
    }
    expect(ha.rng).toBe(hb.rng);
  });

  it('reacts again when the target changes course', () => {
    const e = createEnemy(slot());
    const holder = { rng: 6 };
    const east = { pos: { x: 30, y: 0 }, vel: { x: 0, y: 8 } };
    think(e, east, holder);
    for (let i = 0; i < 40; i++) think(e, east, holder);
    expect(e.ai.react).toBe(0);
    // a hard turn: the velocity flips – no shot until the gunner has reacted again
    const west = { pos: { x: 30, y: 0 }, vel: { x: 0, y: -8 } };
    expect(think(e, west, holder).cmd.fire).toBe(false);
    expect(e.ai.react).toBe(AIM_SKILL.mild.reaction - 1);
    // a small drift does not count as a new course
    for (let i = 0; i < AIM_SKILL.mild.reaction; i++) think(e, west, holder);
    expect(think(e, { ...west, vel: { x: 1, y: -8 } }, holder).cmd.fire).toBe(true);
  });

  it('aims worse on Calm than on Hardcore (same lead, wider spread)', () => {
    const spread = (skill: (typeof AIM_SKILL)[keyof typeof AIM_SKILL]) => {
      const e = createEnemy(slot());
      const holder = { rng: 11 };
      const target = { pos: { x: 30, y: 0 }, vel: { x: 0, y: 0 } };
      let worst = 0;
      for (let i = 0; i < 300; i++) {
        const { aim } = think(e, target, holder, skill).cmd;
        worst = Math.max(worst, Math.abs(Math.atan2(aim.y - e.body.pos.y, aim.x - e.body.pos.x)));
      }
      return worst;
    };
    const calm = spread(AIM_SKILL.none);
    const hardcore = spread(AIM_SKILL.hardcore);
    expect(calm).toBeGreaterThan(AIM_SKILL.none.spread * 0.8);
    expect(calm).toBeLessThanOrEqual(AIM_SKILL.none.spread + 1e-9);
    expect(hardcore).toBeLessThanOrEqual(AIM_SKILL.hardcore.spread + 1e-9);
    expect(AIM_SKILL.none.reaction).toBeGreaterThan(AIM_SKILL.mild.reaction);
    expect(AIM_SKILL.mild.reaction).toBeGreaterThan(AIM_SKILL.hard.reaction);
    expect(AIM_SKILL.hard.reaction).toBeGreaterThan(AIM_SKILL.hardcore.reaction);
  });

  it('breaks off and heads home when the tanks run low, then waits there', () => {
    const e = createEnemy(slot());
    e.home = { x: -100, y: 0 };
    e.ai.mode = 'attack';
    e.fuel = e.props.fuelCapacity * (LOW_FUEL - 0.01);
    const r = think(e, still(150, 0), { rng: 7 });
    expect(e.ai.mode).toBe('retreat');
    // turns towards home (–x) instead of the player (+x)
    expect(Math.abs(r.cmd.flight.turn)).toBeGreaterThan(0.5);
    e.body = { ...e.body, pos: { x: -100, y: 2 }, angle: Math.PI };
    const home = think(e, still(150, 0), { rng: 7 });
    expect(home.cmd.flight).toEqual({ forward: 0, strafe: 0, turn: 0 });
    expect(e.ai.mode).toBe('retreat');
  });

  it('patrols economically: thrusts up to cruise speed, then coasts with the dampers off', () => {
    const e = createEnemy(slot());
    const holder = { rng: 1 };
    think(e, null, holder);
    e.ai.waypoint = { x: 50, y: 0 };
    e.body = { ...e.body, angle: 0, vel: { x: 0, y: 0 } };
    const slow = think(e, null, holder).cmd;
    expect(slow.flight.forward).toBeGreaterThan(0);
    e.body = { ...e.body, vel: { x: 4.5, y: 0 } };
    const coast = think(e, null, holder).cmd;
    expect(coast.flight.forward).toBe(0);
    expect(coast.dampers).toBe(false);
  });
});
