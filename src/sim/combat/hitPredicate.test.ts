// M4d T0: `stepProjectiles` takes the hit predicate as a parameter. With the default predicate it must
// behave exactly as before (enemy shots hit only the player, the player's shots every enemy, never the
// owner itself), and the side rules agree with that rule for the player and pirates.
import { describe, expect, it } from 'vitest';
import { canHit } from '../npc';
import { createGrid } from '../ship/grid';
import { defaultCanHit, stepProjectiles, type ProjectileWorld, type ShipTarget } from './projectiles';
import { combatShip } from './testing';
import type { Projectile } from './types';

const DT = 1 / 60;
const empty: ProjectileWorld = { circlesNear: () => [], stationCirclesNear: () => [] };

/** The rule `stepProjectiles` had inline before M4d (verbatim). */
const beforeM4d = (owner: string, target: string): boolean => !(target === owner) && !(owner !== 'player' && target !== 'player');

const REFS = ['player', 'pr:0,0:0', 'pr:0,0:1', 'cap:3', 'ea:1:0:0', 'rc:A:0', 'gy:2,3:s0'];

describe('the projectile hit predicate', () => {
  it('defaultCanHit is the pre-M4d rule for every pair of refs', () => {
    for (const owner of REFS) for (const target of REFS) expect(defaultCanHit(owner, target), `${owner} → ${target}`).toBe(beforeM4d(owner, target));
  });

  it('the side rules equal the pre-M4d rule between the player and pirates', () => {
    for (const owner of REFS) for (const target of REFS) expect(canHit(owner, target), `${owner} → ${target}`).toBe(beforeM4d(owner, target));
  });

  it('stepProjectiles without a predicate equals the pre-M4d rule shot for shot', () => {
    // a row of ships along +x: the player at 0, pirates at 10, 20, 30; shots from everyone in both directions
    const ship = (x: number) => combatShip(createGrid([['cockpit', 0, 0], ['armor', 1, 0], ['armor', -1, 0]]), { x, y: 0 });
    const ships: ShipTarget[] = [
      { ref: 'player', ship: ship(0) },
      { ref: 'pr:0,0:0', ship: ship(10) },
      { ref: 'pr:0,0:1', ship: ship(20) },
      { ref: 'cap:3', ship: ship(30) },
    ];
    const shots: Projectile[] = [];
    let id = 1;
    for (const owner of ['player', 'pr:0,0:0', 'pr:0,0:1', 'cap:3']) {
      for (const [x, vx] of [
        [-5, 240],
        [5, 240],
        [15, -240],
        [25, -240],
        [35, -240],
        [12, 240],
      ] as const) {
        shots.push({ id: id++, owner, pos: { x, y: 0.2 }, vel: { x: vx, y: 0 }, ttl: 30, damage: 4, tier: 1, origin: { x, y: 0.2 } });
      }
    }
    let a = shots;
    let b = shots;
    let c = shots;
    for (let step = 0; step < 12; step++) {
      const ra = stepProjectiles(a, ships, [], empty, DT);
      const rb = stepProjectiles(b, ships, [], empty, DT, defaultCanHit);
      const rc = stepProjectiles(c, ships, [], empty, DT, beforeM4d);
      expect(ra).toEqual(rc);
      expect(rb).toEqual(rc);
      a = ra.alive;
      b = rb.alive;
      c = rc.alive;
    }
  });

  it('an enemy shot passes another enemy and hits the player; the player hits the first enemy', () => {
    const ships: ShipTarget[] = [
      { ref: 'pr:a', ship: combatShip(createGrid([['cockpit', 0, 0]]), { x: 2, y: 0 }) },
      { ref: 'player', ship: combatShip(createGrid([['cockpit', 0, 0]]), { x: 4, y: 0 }) },
    ];
    const shot = (owner: string): Projectile => ({ id: 1, owner, pos: { x: 0, y: 0 }, vel: { x: 360, y: 0 }, ttl: 30, damage: 1, tier: 1, origin: { x: 0, y: 0 } });
    expect(stepProjectiles([shot('pr:b')], ships, [], empty, DT).hits[0]).toMatchObject({ kind: 'ship', ref: 'player' });
    expect(stepProjectiles([shot('player')], ships, [], empty, DT).hits[0]).toMatchObject({ kind: 'ship', ref: 'pr:a' });
    // a predicate that lets nothing hit: every shot flies on
    expect(stepProjectiles([shot('player')], ships, [], empty, DT, () => false).hits).toEqual([]);
  });
});
