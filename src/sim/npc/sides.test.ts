// M4d T4: the side rules – every row of the target table (user decision 2026-10-16: NO friendly fire).
import { describe, expect, it } from 'vitest';
import { stepProjectiles, type ProjectileWorld, type ShipTarget } from '../combat/projectiles';
import { combatShip } from '../combat/testing';
import type { Projectile } from '../combat/types';
import { createGrid } from '../ship/grid';
import { canHit, sideOf } from './sides';

const PLAYER = 'player';
const PIRATES = ['pr:0,0:0', 'pr:3,-2:1', 'cap:3', 'ea:4:0:1', 'rc:A:0', 'gy:2,3:s0', 'hp:7:1'];
const WATCH = ['gw:lane:A:0|0', 'gw:sector:12,-3|1', 'gw:relay:B|2'];
const CONVOY = ['cv:A@3:trader', 'cv:B@0:tanker', 'es:5:trader', 'es:5:tanker'];
const RELAY = ['gr:A', 'gr:B'];

describe('sideOf', () => {
  it('reads the side from the id prefix', () => {
    expect(sideOf(PLAYER)).toBe('player');
    for (const id of PIRATES) expect(sideOf(id), id).toBe('pirate');
    for (const id of WATCH) expect(sideOf(id), id).toBe('guild');
    for (const id of CONVOY) expect(sideOf(id), id).toBe('convoy');
  });
});

describe('canHit – the side table', () => {
  const all = (owners: readonly string[], targets: readonly string[], want: boolean) => {
    for (const o of owners) for (const t of targets) if (o !== t) expect(canHit(o, t), `${o} → ${t}`).toBe(want);
  };

  it('player ↔ pirate both ways', () => {
    all([PLAYER], PIRATES, true);
    all(PIRATES, [PLAYER], true);
  });

  it('no friendly fire: player shots never hit a Watch ship or a convoy ship (scheduled or escorted)', () => {
    all([PLAYER], WATCH, false);
    all([PLAYER], CONVOY, false);
  });

  it('guild ↔ pirate both ways; the Watch never hits the player or a convoy', () => {
    all(WATCH, PIRATES, true);
    all(PIRATES, WATCH, true);
    all(WATCH, [PLAYER], false);
    all(WATCH, CONVOY, false);
  });

  it('pirates hit convoy ships (the owner module decides whether they take damage)', () => {
    all(PIRATES, CONVOY, true);
  });

  it('NPCs never hit NPCs of their kind; pirates never hit pirates; convoys never shoot', () => {
    all(WATCH, WATCH, false);
    all(PIRATES, PIRATES, false);
    all(CONVOY, [PLAYER, ...PIRATES, ...WATCH, ...CONVOY], false);
  });

  it('a ship never hits itself', () => {
    for (const id of [PLAYER, ...PIRATES, ...WATCH, ...CONVOY]) expect(canHit(id, id), id).toBe(false);
  });

  it('the Guild relay mast stops every shot (a spent structure hit)', () => {
    all([PLAYER, ...PIRATES, ...WATCH], RELAY, true);
  });
});

describe('stepProjectiles with the side rules', () => {
  const empty: ProjectileWorld = { circlesNear: () => [], stationCirclesNear: () => [] };
  const ships: ShipTarget[] = [
    { ref: 'player', ship: combatShip(createGrid([['cockpit', 0, 0]]), { x: 2, y: 0 }) },
    { ref: 'pr:a', ship: combatShip(createGrid([['cockpit', 0, 0]]), { x: 4, y: 0 }) },
  ];
  const shot = (owner: string): Projectile => ({ id: 1, owner, pos: { x: 0, y: 0 }, vel: { x: 360, y: 0 }, ttl: 30, damage: 1, tier: 1, origin: { x: 0, y: 0 } });

  it('a Watch shot passes through the player and hits the pirate behind', () => {
    expect(stepProjectiles([shot('gw:lane:A:0|0')], ships, [], empty, 1 / 60, canHit).hits[0]).toMatchObject({ kind: 'ship', ref: 'pr:a' });
  });

  it('a pirate shot still hits the player; a convoy owner (never shoots) would hit nothing', () => {
    expect(stepProjectiles([shot('pr:b')], ships, [], empty, 1 / 60, canHit).hits[0]).toMatchObject({ kind: 'ship', ref: 'player' });
    expect(stepProjectiles([shot('es:1:trader')], ships, [], empty, 1 / 60, canHit).hits).toEqual([]);
  });
});
