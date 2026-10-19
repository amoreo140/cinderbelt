// Slot overview for the Load / Continue screens – a separate record so that the whole save
// need not be parsed (SlotMetaV1; slots by difficulty).
import type { RingIndex } from '../../data/economy';
import { length, type Vec2 } from '../math/vec2';
import type { DeathPenalty, EnemyDensity, MiningYield } from '../settings';
import { ringIndexAt } from '../world/rings';
import type { StationId } from '../world/stations';
import type { SaveGame, SaveReason, SlotRef } from './types';

/** Where the game stands. The UI looks up the station name via stationById(seed, stationId) and the i18n texts. */
export type SaveLocation =
  | { kind: 'docked'; stationId: StationId; ring: RingIndex }
  | { kind: 'space'; ring: RingIndex; pos: Vec2 };

export interface SlotMeta {
  slot: SlotRef;
  gameId: string;
  name: string;
  /** Version of the main record's schema. */
  version: number;
  createdAt: string;
  savedAt: string;
  saveReason: SaveReason;
  /** Game time in steps (60/s). */
  playTimeTicks: number;
  seed: number;
  seedText: string;
  deathPenalty: DeathPenalty;
  enemyDensity: EnemyDensity;
  miningYield: MiningYield;
  fallenFromHardcore: boolean;
  credits: number;
  location: SaveLocation;
  partCount: number;
  /** The slot has a backup (the previous successful write). Filled in by the storage. */
  hasBackup: boolean;
}

export const TICKS_PER_SECOND = 60;

export function slotMetaFor(save: SaveGame, slot: SlotRef, hasBackup: boolean): SlotMeta {
  const { player, settings } = save;
  const ring = ringIndexAt(length(player.body.pos));
  const location: SaveLocation =
    player.dockedAt !== null
      ? { kind: 'docked', stationId: player.dockedAt, ring }
      : { kind: 'space', ring, pos: { x: player.body.pos.x, y: player.body.pos.y } };
  return {
    slot: { ...slot },
    gameId: save.gameId,
    name: save.name,
    version: save.version,
    createdAt: save.createdAt,
    savedAt: save.savedAt,
    saveReason: save.saveReason,
    playTimeTicks: save.tick,
    seed: save.seed,
    seedText: settings.seedText,
    deathPenalty: settings.deathPenalty,
    enemyDensity: settings.enemyDensity,
    miningYield: settings.miningYield,
    fallenFromHardcore: settings.fallenFromHardcore,
    credits: save.credits,
    location,
    partCount: player.grid.parts.length,
    hasBackup,
  };
}
