// Game settings chosen at creation – they do not change after the start
// (exception: the fall from hardcore to Hard).
import { fnv1a32 } from './math/fnv1a';

/** Death penalty = difficulty; the slots are split by it (4 for each). */
export type DeathPenalty = 'none' | 'mild' | 'hard' | 'hardcore';
export type EnemyDensity = 'low' | 'normal' | 'high';
export type MiningYield = 0.5 | 1 | 2;

export const DEATH_PENALTIES: readonly DeathPenalty[] = ['none', 'mild', 'hard', 'hardcore'];
export const ENEMY_DENSITIES: readonly EnemyDensity[] = ['low', 'normal', 'high'];
export const MINING_YIELDS: readonly MiningYield[] = [0.5, 1, 2];

export interface GameSettings {
  /** What the player entered as the seed (or a generated text) – for display and sharing only. */
  seedText: string;
  deathPenalty: DeathPenalty;
  /** Already saved in M2, takes effect with the pirates (M3). */
  enemyDensity: EnemyDensity;
  miningYield: MiningYield;
  /** The game started as hardcore and fell to Hard after a death ("fallen hero"). */
  fallenFromHardcore: boolean;
}

export type DifficultyPresetId = 'calm' | 'standard' | 'hard' | 'hardcore';
export type DifficultyChoice = Pick<GameSettings, 'deathPenalty' | 'enemyDensity' | 'miningYield'>;

/** Presets of the New game screen. */
export const DIFFICULTY_PRESETS: Record<DifficultyPresetId, DifficultyChoice> = {
  calm: { deathPenalty: 'none', enemyDensity: 'low', miningYield: 2 },
  standard: { deathPenalty: 'mild', enemyDensity: 'normal', miningYield: 1 },
  hard: { deathPenalty: 'hard', enemyDensity: 'high', miningYield: 1 },
  hardcore: { deathPenalty: 'hardcore', enemyDensity: 'high', miningYield: 1 },
};

export const DIFFICULTY_PRESET_IDS: readonly DifficultyPresetId[] = ['calm', 'standard', 'hard', 'hardcore'];

/** Which preset the choices correspond to (null = "Custom"). */
export function matchingPreset(choice: DifficultyChoice): DifficultyPresetId | null {
  for (const id of DIFFICULTY_PRESET_IDS) {
    const p = DIFFICULTY_PRESETS[id];
    if (p.deathPenalty === choice.deathPenalty && p.enemyDensity === choice.enemyDensity && p.miningYield === choice.miningYield) {
      return id;
    }
  }
  return null;
}

export const DEFAULT_SETTINGS: GameSettings = {
  seedText: '',
  ...DIFFICULTY_PRESETS.standard,
  fallenFromHardcore: false,
};

/** Seed text → uint32: purely numeric text (≤ 2³² − 1) directly, otherwise FNV-1a. */
export function seedFromText(text: string): number {
  const t = text.trim();
  if (/^\d+$/.test(t)) {
    const n = Number(t);
    if (Number.isSafeInteger(n) && n <= 0xffff_ffff) return n;
  }
  return fnv1a32(t);
}
