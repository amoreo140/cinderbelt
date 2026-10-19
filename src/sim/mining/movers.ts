// Moving mining targets (M4b): a comet nucleus and its tail
// shards are mined on the move. The contract between the sim step and `runMining` (mining.ts, T2):
// `miningMovers(state)` (src/sim/sites) lists the movers within reach, `runMining` raycasts its lasers
// against them as well (no vein bonus, heat as on rock), puts the ore into the cargo by `mix` and reports
// `moverExtractions`; `applyMoverExtractions(state, result, events)` books the per-pass budgets and
// rolls nuggets. Generic: nothing here knows about comets.
import type { Cargo, ResourceId } from '../../data/resources';
import type { Vec2 } from '../math/vec2';

export interface MiningMover {
  /** Stable id, e.g. `cm:3` (nucleus) or `cm:3#12` (tail shard 12). */
  id: string;
  pos: Vec2;
  /** Velocity (u/s) – the beam end follows the target. */
  vel: Vec2;
  radius: number;
  /** Main resource (beam colour, sound). */
  resource: ResourceId;
  /** Ore mix of one rock unit (shares sum to 1), e.g. { ice: 0.6, titanium: 0.4 }. */
  mix: Partial<Record<ResourceId, number>>;
  /** Rock units left (this pass); the laser takes nothing at 0. */
  left: number;
  /** Ore grade (cargo gets taken × grade, like a rock). */
  grade: number;
  /** Rich target: extractions roll nuggets (Mining 2.0). */
  nuggets: boolean;
}

/** One laser taking rock units out of a mover in this step. */
export interface MoverExtraction {
  laser: number;
  mover: string;
  /** Rock units left before this laser took its share. */
  before: number;
  /** Rock units taken (the cargo got `ore`). */
  taken: number;
  ore: Partial<Cargo>;
  grade: number;
  /** Where the beam hit. */
  to: Vec2;
  /** The laser's rock units per second (rate × difficulty yield). */
  laserRate: number;
}
