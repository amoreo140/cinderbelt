// The Guild ↔ save (V20, M4d): relay chain stages, the relay hold, the live Watch ships (every field
// but `prevBody`, which equals `body` after a load), the lost Watch ids and the last radio line. Maps as
// sorted arrays, so a save is canonical; the live ships keep their order (the AI steps them in it).
import { createGuild } from '../guild/state';
import type { GuildState, WatchShip } from '../guild/types';
import type { LaneId } from '../regions/lanes';
import type { SavedBodyV1, SavedGuildV20, SavedWatchShipV20 } from './types';

const byString = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

const copyBody = (b: SavedBodyV1): SavedBodyV1 => ({ pos: { x: b.pos.x, y: b.pos.y }, vel: { x: b.vel.x, y: b.vel.y }, angle: b.angle, angVel: b.angVel });

function watchToSave(w: WatchShip): SavedWatchShipV20 {
  return {
    id: w.id,
    kind: w.kind,
    body: copyBody(w.body),
    hull: w.hull,
    shield: w.shield,
    shieldDelay: w.shieldDelay,
    cooldowns: [...w.cooldowns],
    mode: w.mode,
    target: w.target,
    route: w.route,
    slot: w.slot,
    modeTick: w.modeTick,
    lastHitBy: w.lastHitBy,
  };
}

function watchFromSave(w: SavedWatchShipV20): WatchShip {
  const body = copyBody(w.body);
  return {
    id: w.id,
    kind: w.kind,
    body,
    prevBody: body,
    hull: w.hull,
    shield: w.shield,
    shieldDelay: w.shieldDelay,
    cooldowns: [...w.cooldowns],
    mode: w.mode,
    target: w.target,
    route: w.route,
    slot: w.slot,
    modeTick: w.modeTick,
    lastHitBy: w.lastHitBy,
  };
}

export function guildToSave(g: GuildState): SavedGuildV20 {
  return {
    relays: [...g.relays]
      .sort((a, b) => byString(a[0], b[0]))
      .map(([lane, r]): [LaneId, SavedGuildV20['relays'][number][1]] => [lane, { stage: r.stage, sector: r.sector, tick: r.tick }]),
    hold: g.hold ? { lane: g.hold.lane, start: g.hold.start, phase: g.hold.phase, reinforced: g.hold.reinforced } : null,
    watch: g.watch.map(watchToSave),
    lost: [...g.lost].sort((a, b) => byString(a[0], b[0])).map(([id, tick]): [string, number] => [id, tick]),
    lastRadio: g.lastRadio,
  };
}

export function guildFromSave(saved: SavedGuildV20): GuildState {
  return {
    relays: new Map(saved.relays.map(([lane, r]) => [lane, { stage: r.stage, sector: r.sector, tick: r.tick }])),
    hold: saved.hold ? { ...saved.hold } : null,
    watch: saved.watch.map(watchFromSave),
    lost: new Map(saved.lost),
    lastRadio: saved.lastRadio,
  };
}

/** The Guild of a save before V20: no relay progress, no live Watch ships, no radio line yet. */
export const legacyGuild = (): SavedGuildV20 => guildToSave(createGuild());
