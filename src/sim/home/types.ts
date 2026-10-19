// Home station state (M4c "Home and Workshop", the home-station plan
// §2.1–2.3, §3): the modules built at home and the trophies pinned on the hall's pedestals.
import type { HomeModuleId } from '../../data/home';
import type { PartKey } from '../../data/parts';
import type { PaintId } from '../../data/paints';

/**
 * A trophy: `cap:<captain>` = a defeated named captain (`TrophyEntry.captain`, the captain's index in
 * the seed), `fort:<siteId>` = a Rust fortress destroyed at least once.
 */
export type TrophyId = `cap:${number}` | `fort:${string}`;

export interface HomeState {
  /** Built modules (only buildable ones – never a `since` module). */
  modules: Set<HomeModuleId>;
  /** Trophies the player pinned on the pedestals, in pin order (≤ TROPHY_PEDESTALS, unique, resolvable). */
  trophyPins: TrophyId[];
}

/**
 * One trophy, derived from the career and the pirates state (never stored twice): captains in defeat
 * order, then fortresses by id.
 */
export interface TrophyItem {
  id: TrophyId;
  kind: 'captain' | 'fortress';
  /** Captain index (kind 'captain'), else null. */
  captain: number | null;
  /** Fortress site id (kind 'fortress'), else null. */
  fortress: string | null;
  /** The player's part replicas the captain carried (empty for a fortress). */
  replicas: PartKey[];
  /** Position in `trophiesOf` (0 = the oldest captain). */
  order: number;
}

/** Events of the home actions (part of `SimEvent`). */
export type HomeEvent =
  | { type: 'homeModuleBuilt'; module: HomeModuleId }
  | { type: 'shipPainted'; shipId: number; paint: PaintId }
  | { type: 'trophyPinned'; id: TrophyId; pinned: boolean };
