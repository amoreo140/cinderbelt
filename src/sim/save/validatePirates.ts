// Validation of the pirate state in save V6 (M3.6) – same style as validate.ts: a clean copy, errors with paths.
import { FORTRESS } from '../../data/pirates';
import type { FortressState, Raid, Toll } from '../pirates/state';
import type { SavedPiratesV11 } from './types';
import { SAVE_MAX_TICK_AHEAD, SAVE_MAX_TICK, type Checker } from './validate';

function pairs(c: Checker, v: unknown, path: string): [string, number][] {
  const out: [string, number][] = [];
  (c.arr(v, path) ?? []).forEach((entry, i) => {
    const p = `${path}[${i}]`;
    if (!Array.isArray(entry) || entry.length !== 2) return c.err(p, 'expected [key, tick]');
    out.push([c.str(entry[0], p, true), c.until(entry[1], p, -SAVE_MAX_TICK_AHEAD)]);
  });
  if (new Set(out.map(([k]) => k)).size !== out.length) c.err(path, 'duplicate keys');
  return out;
}

/** HP of fortress parts: the maximum is tunable – more is clamped with a warning (M1). */
function hpList(c: Checker, v: unknown, path: string, max: number): number[] {
  return (c.arr(v, path) ?? []).map((x, i) => c.capped(x, `${path}[${i}]`, 0, max));
}

function fortress(c: Checker, v: unknown, path: string): FortressState {
  const o = c.obj(v, path) ?? {};
  return {
    core: c.capped(o.core, `${path}.core`, 0, FORTRESS.coreHp),
    gens: hpList(c, o.gens, `${path}.gens`, FORTRESS.generatorHp),
    turrets: hpList(c, o.turrets, `${path}.turrets`, FORTRESS.turretHp),
    destroyed: o.destroyed === null ? null : c.tick(o.destroyed, `${path}.destroyed`),
    kills: c.int(o.kills, `${path}.kills`, 0),
    reinforce: c.int(o.reinforce, `${path}.reinforce`, 0),
    spawned: c.int(o.spawned, `${path}.spawned`, 0),
    cooldowns: (c.arr(o.cooldowns, `${path}.cooldowns`) ?? []).map((x, i) => c.int(x, `${path}.cooldowns[${i}]`, 0)),
  };
}

function raid(c: Checker, v: unknown, path: string): Raid | null {
  if (v === null) return null;
  const o = c.obj(v, path) ?? {};
  return {
    serial: c.int(o.serial, `${path}.serial`, 0),
    kind: c.oneOf(o.kind, ['raid', 'challenge'] as const, `${path}.kind`),
    pos: c.vec(o.pos, `${path}.pos`),
    station: o.station === null ? null : c.str(o.station, `${path}.station`, true),
    beacon: o.beacon === null ? null : c.str(o.beacon, `${path}.beacon`, true),
    captain: o.captain === null ? null : c.int(o.captain, `${path}.captain`, 0),
    ships: c.int(o.ships, `${path}.ships`, 1),
    arrive: c.until(o.arrive, `${path}.arrive`),
    ends: c.until(o.ends, `${path}.ends`),
    spawned: c.bool(o.spawned, `${path}.spawned`),
  };
}

function toll(c: Checker, v: unknown, path: string): Toll | null {
  if (v === null) return null;
  const o = c.obj(v, path) ?? {};
  return { group: c.str(o.group, `${path}.group`, true), amount: c.num(o.amount, `${path}.amount`, 0), until: c.until(o.until, `${path}.until`) };
}

export function validatePirates(c: Checker, raw: unknown, path: string): SavedPiratesV11 {
  const o = c.obj(raw, path) ?? {};
  const fortresses: [string, FortressState][] = [];
  (c.arr(o.fortresses, `${path}.fortresses`) ?? []).forEach((entry, i) => {
    const p = `${path}.fortresses[${i}]`;
    if (!Array.isArray(entry) || entry.length !== 2) return c.err(p, 'expected [id, fortress]');
    fortresses.push([c.str(entry[0], p, true), fortress(c, entry[1], p)]);
  });
  return {
    attention: c.num(o.attention, `${path}.attention`, 0, 100),
    chunk: o.chunk === null ? null : c.str(o.chunk, `${path}.chunk`, true),
    lastHunt: c.tick(o.lastHunt, `${path}.lastHunt`, -SAVE_MAX_TICK),
    serial: c.int(o.serial, `${path}.serial`, 1),
    raid: raid(c, o.raid, `${path}.raid`),
    toll: toll(c, o.toll, `${path}.toll`),
    tolled: pairs(c, o.tolled, `${path}.tolled`),
    paid: pairs(c, o.paid, `${path}.paid`),
    fortresses,
    beacons: pairs(c, o.beacons, `${path}.beacons`),
  };
}
