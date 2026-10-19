// The player's sector charts (sectors design §4, §6.7; stage 2, save V15): everything about sectors
// that cannot be derived from the seed and `world.explored` – the survey points the scanner marked, the
// charts bought from and sold to the Guild, and per-sector cooldowns (none yet, the field is reserved
// so a future repeatable bonus never needs a new save version).
import { REGION_GEN_ID, type RegionGenId } from './constants';

export interface RegionsState {
  /** Region generator of the game (frozen REGION_GEN = 1). */
  gen: RegionGenId;
  /** Sector id → bit mask of its marked survey points (bit i = point i of `surveyPoints`). */
  points: Map<string, number>;
  /** Sectors whose chart the player bought from the Guild (Charted, never sellable, no Data). */
  bought: Set<string>;
  /** Sectors whose chart the player sold to the Guild – once per game (also through a `chart` contract). */
  sold: Set<string>;
  /** Sector id → tick of a future per-sector cooldown (empty today). */
  cooldowns: Map<string, number>;
}

export const createRegionsState = (): RegionsState => ({ gen: REGION_GEN_ID, points: new Map(), bought: new Set(), sold: new Set(), cooldowns: new Map() });
