// Test helpers of the NPC side rules (M4d T4): synthetic live Watch ships until the Watch (T3) spawns
// real ones, and NPC hit targets.
import { WATCH } from '../../data/guild';
import type { WatchKind, WatchShip } from '../guild/types';
import type { Vec2 } from '../math/vec2';
import { createBody } from '../physics/body';
import type { NpcHitTarget } from './types';

/** A live Watch ship at `pos` (full hull and shield, mode `engage`). */
export function syntheticWatch(id: string, pos: Vec2, kind: WatchKind = 'cutter', vel: Vec2 = { x: 0, y: 0 }): WatchShip {
  const def = WATCH.ships[kind];
  const body = { ...createBody({ ...pos }), vel: { ...vel } };
  return {
    id,
    kind,
    body,
    prevBody: body,
    hull: def.hull,
    shield: def.shield,
    shieldDelay: 0,
    cooldowns: def.guns.map(() => 0),
    mode: 'engage',
    target: null,
    route: id.slice(3, id.lastIndexOf('|')),
    slot: Number(id.slice(id.lastIndexOf('|') + 1)) || 0,
    modeTick: 0,
    lastHitBy: -1,
  };
}

/** An NPC hit target (defaults: an escorted convoy trader, damageable, no shield, at rest). */
export function npcTarget(id: string, pos: Vec2, over: Partial<NpcHitTarget> = {}): NpcHitTarget {
  const kind = id.startsWith('gw:') ? 'watch' : id.startsWith('gr:') ? 'relay' : 'convoy';
  return { id, kind, pos, radius: 3, shield: 0, damageable: !id.startsWith('cv:') && kind !== 'relay', ...over };
}
