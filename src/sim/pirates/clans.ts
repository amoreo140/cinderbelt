// Which Rust clan a pirate ship belongs to (readability plan §3). Derived, never saved:
// captains carry their clan (captains.ts); every other pirate flies under the clan whose territory
// its home lies in. Territory = the wedge around the centre owned by the nearest fortress (by angle),
// each fortress belongs to one clan (rotated per seed). Escorts of a captain (hunting party, raid)
// share the captain's home and fly his colours.
import { CAPTAIN_CLANS } from '../../data/captains';
import type { FactionId } from '../../data/factions';
import { captainDef, captainIndexOf } from '../captains/captains';
import type { Enemy } from '../combat/types';
import { normalizeAngle } from '../math/angle';
import type { Vec2 } from '../math/vec2';
import { hash3 } from '../world/hash';
import { fortressSites } from './sites';

const CLAN_SALT = 0xc1a4_5e7d;

/** Clan of the fortress with index `index` (the fortresses' clans rotate with the seed). */
export function fortressClan(seed: number, index: number): FactionId {
  const offset = hash3(seed ^ CLAN_SALT, 0, 0) % CAPTAIN_CLANS.length;
  return CAPTAIN_CLANS[(index + offset) % CAPTAIN_CLANS.length]!;
}

/** Clan whose territory contains `pos`: the fortress nearest by angle around the centre. */
export function clanAt(seed: number, pos: Vec2): FactionId {
  const sites = fortressSites(seed);
  if (sites.length === 0) return CAPTAIN_CLANS[0]!;
  const a = Math.atan2(pos.y, pos.x);
  let best = 0;
  let bestGap = Infinity;
  for (const site of sites) {
    const gap = Math.abs(normalizeAngle(Math.atan2(site.pos.y, site.pos.x) - a));
    if (gap < bestGap) {
      bestGap = gap;
      best = site.index;
    }
  }
  return fortressClan(seed, best);
}

type ClanShip = Pick<Enemy, 'id' | 'home'>;

/**
 * Clan of a pirate ship: a named captain's own clan; an escort flying with a captain (same home
 * point) takes the captain's clan; any other ship the clan of its home territory.
 */
export function enemyClan(seed: number, ship: ClanShip, fleet: readonly ClanShip[] = []): FactionId {
  const own = captainIndexOf(ship.id);
  if (own !== null) return captainDef(seed, own)?.clan ?? clanAt(seed, ship.home);
  for (const other of fleet) {
    const captain = captainIndexOf(other.id);
    if (captain === null || other.home.x !== ship.home.x || other.home.y !== ship.home.y) continue;
    const def = captainDef(seed, captain);
    if (def) return def.clan;
  }
  return clanAt(seed, ship.home);
}
