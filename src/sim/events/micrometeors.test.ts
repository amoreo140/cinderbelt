// Micrometeor shower (M4b T1): rays, the first part along the ray, profile, shields, damage by depth.
import { describe, expect, it } from 'vitest';
import type { RingIndex } from '../../data/economy';
import { MICROMETEORS } from '../../data/events';
import { combatShip } from '../combat/testing';
import { currentHp } from '../ship/hp';
import { createGrid } from '../ship/grid';
import { shaped } from '../ship/testing';
import type { ShipGrid } from '../ship/types';
import { Simulation, type SimEvent } from '../Simulation';
import { micrometeorHit, micrometeorRay, rayOffset, showerOf } from './micrometeors';
import { ofType, parkedAt } from './testing';

/** A long thin ship along its x axis: cockpit at the back, armour at the nose (+x). */
const needle = (): ShipGrid =>
  createGrid([
    ['cockpit', 0, 0],
    ['reactor', 1, 0],
    ['cargo', 2, 0],
    ['cargo', 3, 0],
    ['cargo', 4, 0],
    ['armor', 5, 0],
  ]);

const hp = (sim: Simulation, id: number): number => currentHp(sim.state.player.hp, sim.state.player.grid.parts.find((p) => p.id === id)!);

describe('micrometeor rays', () => {
  it('the shower is a pure function of (seed, sector, bucket); rays stay within the band', () => {
    expect(showerOf(5, 'rg:A:2.4', 9)).toEqual(showerOf(5, 'rg:A:2.4', 9));
    const s = showerOf(5, 'rg:A:2.4', 9);
    expect(s.duration).toBeGreaterThanOrEqual(MICROMETEORS.duration[0] * 60);
    expect(s.duration).toBeLessThanOrEqual(MICROMETEORS.duration[1] * 60);
    for (let i = 0; i < 500; i++) expect(Math.abs(rayOffset(5, 'rg:A:2.4', 9, i))).toBeLessThanOrEqual(MICROMETEORS.bandWidth / 2);
    expect(rayOffset(5, 'rg:A:2.4', 9, 3)).toBe(rayOffset(5, 'rg:A:2.4', 9, 3));
  });

  it('a ray hits the first part along it: armour in front takes the grain', () => {
    const ship = combatShip(needle());
    const armour = ship.grid.parts.find((p) => p.partId === 'armor')!;
    const cockpit = ship.grid.parts.find((p) => p.partId === 'cockpit')!;
    // the stream comes from +x (the nose) through the ship's axis
    expect(micrometeorRay(ship, 0, 0)?.partId).toBe(armour.id);
    // from −x it meets the cockpit first
    expect(micrometeorRay(ship, Math.PI, 0)?.partId).toBe(cockpit.id);
    // a ray beside the ship misses
    expect(micrometeorRay(ship, 0, 5)).toBeNull();
  });

  it('a ship turned narrow-side into the stream takes far fewer hits (seeded)', () => {
    const ship = combatShip(needle());
    let nose = 0;
    let broadside = 0;
    for (let i = 0; i < 2000; i++) {
      const o = rayOffset(77, 'rg:A:2.0', 12, i);
      if (micrometeorRay(ship, 0, o)) nose++;
      if (micrometeorRay(ship, Math.PI / 2, o)) broadside++;
    }
    expect(nose).toBeGreaterThan(0);
    expect(broadside).toBeGreaterThan(nose * 3);
    // ≈ width / band: 1 cell vs 6 cells across a 16 u band
    expect(nose / 2000).toBeCloseTo(1 / MICROMETEORS.bandWidth, 1);
    expect(broadside / 2000).toBeCloseTo(6 / MICROMETEORS.bandWidth, 1);
  });
});

describe('micrometeor hits', () => {
  const noShield = (): Simulation => {
    const sim = parkedAt(11, { x: 3000, y: 0 }, needle());
    sim.state.player.shield = 0;
    return sim;
  };

  it.each([1, 2, 3, 4] as RingIndex[])('damage by depth %i, cause hazard', (depth) => {
    const sim = noShield();
    const armour = sim.state.player.grid.parts.find((p) => p.partId === 'armor')!;
    const before = hp(sim, armour.id);
    const events: SimEvent[] = [];
    micrometeorHit(sim.state, { partId: armour.id, pos: { x: 0, y: 0 } }, depth, events);
    expect(before - hp(sim, armour.id)).toBe(MICROMETEORS.damage[depth]);
    expect(ofType(events, 'micrometeorHit')).toEqual([{ type: 'micrometeorHit', pos: { x: 0, y: 0 }, partId: armour.id, damage: MICROMETEORS.damage[depth], shielded: false }]);
  });

  it('a destroyed part is lost to a hazard', () => {
    const sim = noShield();
    const cargo = sim.state.player.grid.parts.find((p) => p.partId === 'cargo')!;
    sim.state.player.hp.set(cargo.id, 1);
    const events: SimEvent[] = [];
    micrometeorHit(sim.state, { partId: cargo.id, pos: { x: 0, y: 0 } }, 3, events);
    expect(ofType(events, 'partsLost')[0]?.cause).toBe('hazard');
  });

  it('a raised shield absorbs the hit and drains twice the damage; what it cannot hold reaches the part', () => {
    const grid = createGrid([
      ['cockpit', 0, 0],
      ['shield', 1, 0],
      ['reactor', -1, 0],
      ['armor', 2, 0],
    ]);
    const sim = parkedAt(11, { x: 3000, y: 0 }, grid);
    const armour = sim.state.player.grid.parts.find((p) => p.partId === 'armor')!;
    sim.state.player.shield = 10;
    const events: SimEvent[] = [];
    micrometeorHit(sim.state, { partId: armour.id, pos: { x: 0, y: 0 } }, 2, events);
    expect(sim.state.player.shield).toBe(10 - 2 * MICROMETEORS.shieldDrainMult);
    expect(sim.state.player.hp.has(armour.id)).toBe(false);
    expect(ofType(events, 'micrometeorHit')[0]?.shielded).toBe(true);
    // 2 points of shield hold 1 of the 3 damage; 2 reach the armour
    sim.state.player.shield = 2;
    const before = hp(sim, armour.id);
    micrometeorHit(sim.state, { partId: armour.id, pos: { x: 0, y: 0 } }, 3, events);
    expect(sim.state.player.shield).toBe(0);
    expect(before - hp(sim, armour.id)).toBeCloseTo(2);
    expect(ofType(events, 'micrometeorHit')[1]?.shielded).toBe(false);
  });
});

describe('micrometeor rays on shaped parts', () => {
  it('a grain passes the empty half of a shaped plate and hits the part behind it', () => {
    // half plate at (1,0) in front of the cockpit: solid for grid y ∈ [−½, 0]
    const ship = combatShip(shaped(createGrid([['cockpit', 0, 0], ['armor', 1, 0]]), 2, 'half'));
    const offset = (gridY: number) => gridY - ship.props.centerOfMass.y;
    // the stream from +x (the nose); the ray's sideways offset is along world +y = grid +y at angle 0
    expect(micrometeorRay(ship, 0, offset(0.3))?.partId).toBe(1);
    const low = micrometeorRay(ship, 0, offset(-0.3))!;
    expect(low.partId).toBe(2);
    expect(low.pos.x).toBeCloseTo(ship.body.pos.x + 1.5 - ship.props.centerOfMass.x);
  });
});
