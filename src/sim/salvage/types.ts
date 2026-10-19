// Salvage and dismantling events (M3.6): tractor beam, cutting joints, ripping off parts, containers.
import type { PartInventory } from '../../data/parts';
import type { Cargo } from '../../data/resources';
import type { TowRef } from '../combat/types';
import type { Vec2 } from '../math/vec2';

export type TractorFailReason = 'noTractor' | 'noTarget' | 'tooHeavy' | 'joint' | 'energy';
export type TractorReleaseReason = 'manual' | 'range' | 'energy' | 'lost' | 'loaded' | 'stolen';

export type SalvageEvent =
  | { type: 'tractorLocked'; target: TowRef; pos: Vec2; rip: boolean }
  | { type: 'tractorReleased'; reason: TractorReleaseReason }
  | { type: 'tractorFailed'; reason: TractorFailReason }
  /** The laser cut a wreck joint (blast > 0 = a fuel tank / reactor exploded). */
  | { type: 'wreckCut'; wreckId: number; partId: number; pos: Vec2; pieces: number[]; blast: number }
  /** The explosion from cutting hit the player's ship. */
  | { type: 'cutBlast'; pos: Vec2; damage: number }
  /** The tractor beam ripped a loose part off a wreck. */
  | { type: 'partRipped'; wreckId: number; partId: number; pos: Vec2; piece: number }
  /** F at a big wreck – it has to be cut up first. */
  | { type: 'salvageBlocked'; wreckId: number; parts: number }
  | { type: 'containerLoaded'; containerId: number; pos: Vec2; cargo: Partial<Cargo>; parts: PartInventory; cargoFull: boolean };
