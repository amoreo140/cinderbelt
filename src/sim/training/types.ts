// Guild Training state (M3.7) – part of the career, saved with it (save V10).
import type { PartInventory } from '../../data/parts';
import type { TrainingStepId } from '../../data/training';
import type { Vec2 } from '../math/vec2';
import type { StationId } from '../world/stations';

export type TrainingStatus = 'active' | 'done' | 'skipped';

/** Where the training takes place (picked once at the start from the world around home). */
export interface TrainingSites {
  /** First buoy – fly to it. */
  buoyA: Vec2;
  /** Second buoy – stop at it. */
  buoyB: Vec2;
  /** The training rock (an iron asteroid with veins) and its position. */
  rock: string;
  rockPos: Vec2;
}

export interface TrainingState {
  status: TrainingStatus;
  /** Index of the current step (data/training.ts). */
  step: number;
  /** Counter base at the start of the step (iron mined). */
  base: number;
  /** Step flags (sold something, checklist bits). */
  flags: number;
  /** Station whose storage holds the latest reward parts. */
  rewardAt: StationId;
  /** Null when the training never ran (skipped at the New Game screen, an old save). */
  sites: TrainingSites | null;
}

export type TrainingEvent =
  /** A step done: its reward was paid (parts into the storage of `stationId`). */
  | { type: 'trainingStep'; step: TrainingStepId; index: number; credits: number; parts: PartInventory; kit: boolean; stationId: StationId; done: boolean }
  /** The player skipped the rest of the training: the remaining parts went to `stationId`; `assembled` = the Guild fitted the starter ship. */
  | { type: 'trainingSkipped'; stationId: StationId; parts: PartInventory; assembled: boolean };
