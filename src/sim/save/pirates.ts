// Pirate state <-> save (V6). Maps as sorted pairs (canonical save: equal state gives equal JSON).
import { createPirates, type FortressState, type PirateState, type Raid, type Toll } from '../pirates/state';
import type { SavedPiratesV11, SavedPiratesV6 } from './types';

const byString = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
const sorted = <V>(m: ReadonlyMap<string, V>): [string, V][] => [...m].sort((a, b) => byString(a[0], b[0]));

const copyFortress = (f: FortressState): FortressState => ({
  core: f.core,
  gens: [...f.gens],
  turrets: [...f.turrets],
  destroyed: f.destroyed,
  kills: f.kills,
  reinforce: f.reinforce,
  spawned: f.spawned,
  cooldowns: [...f.cooldowns],
});

const copyRaid = (r: Raid): Raid => ({ ...r, pos: { x: r.pos.x, y: r.pos.y } });
const copyToll = (t: Toll): Toll => ({ ...t });

export function piratesToSave(p: PirateState): SavedPiratesV11 {
  return {
    attention: p.attention,
    chunk: p.chunk,
    lastHunt: p.lastHunt,
    serial: p.serial,
    raid: p.raid ? copyRaid(p.raid) : null,
    toll: p.toll ? copyToll(p.toll) : null,
    tolled: sorted(p.tolled),
    paid: sorted(p.paid),
    fortresses: sorted(p.fortresses).map(([id, f]): [string, FortressState] => [id, copyFortress(f)]),
    beacons: sorted(p.beacons),
  };
}

export function piratesFromSave(s: SavedPiratesV11): PirateState {
  return {
    attention: s.attention,
    chunk: s.chunk,
    lastHunt: s.lastHunt,
    serial: s.serial,
    raid: s.raid ? copyRaid(s.raid) : null,
    toll: s.toll ? copyToll(s.toll) : null,
    tolled: new Map(s.tolled),
    paid: new Map(s.paid),
    fortresses: new Map(s.fortresses.map(([id, f]) => [id, copyFortress(f)])),
    beacons: new Map(s.beacons),
  };
}

/** Pirates of an old save (V5): no attention, nothing touched (in the V6 shape – `paid` comes in V11). */
export function legacyPirates(): SavedPiratesV6 {
  const { paid: _p, ...v6 } = piratesToSave(createPirates());
  return v6;
}
