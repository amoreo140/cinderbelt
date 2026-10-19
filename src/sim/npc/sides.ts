// Side rules of combat (M4d plan §2.3 "Pirates' response", §2.4 without offences) – OWNED BY T4.
//
// Target table (user decision 2026-10-16 – NO friendly fire, no offence / hostility / fines):
//   player → pirate yes; pirate → player yes; guild → pirate yes; pirate → guild yes;
//   pirate → convoy ship yes (an escorted one takes damage, a scheduled one stops the shot unharmed –
//   the owner module decides, `onConvoyHit`);
//   player → guild / convoy NEVER (the shot passes through); guild → player never; guild → convoy never;
//   pirate → pirate never; convoys never shoot; a ship never hits itself;
//   every shot stops at the Guild relay mast (`gr:` – a structure, a spent hit like a derelict relay).
import { PLAYER_REF, type ShipRef } from '../combat/types';
import { NPC_PREFIX, type Side } from './types';

/** The side of a ship ref / projectile owner by its id prefix. */
export function sideOf(ref: ShipRef): Side {
  if (ref === PLAYER_REF) return 'player';
  if (ref.startsWith(NPC_PREFIX.watch)) return 'guild';
  if (ref.startsWith(NPC_PREFIX.convoy) || ref.startsWith(NPC_PREFIX.escort)) return 'convoy';
  return 'pirate';
}

/** Who a shot of each side may hit (the relay mast and self-hits are handled before the table). */
const HITS: Record<Side, Record<Side, boolean>> = {
  player: { player: false, pirate: true, guild: false, convoy: false },
  pirate: { player: true, pirate: false, guild: true, convoy: true },
  guild: { player: false, pirate: true, guild: false, convoy: false },
  convoy: { player: false, pirate: false, guild: false, convoy: false },
};

/** May a shot of `owner` hit `target`? The projectile hit predicate (`stepProjectiles`, `npcProjectiles`). */
export function canHit(owner: ShipRef, target: ShipRef): boolean {
  if (target === owner) return false;
  // the Guild relay mast is a structure: it stops every shot (no damage – a spent hit)
  if (target.startsWith(NPC_PREFIX.relay)) return true;
  return HITS[sideOf(owner)][sideOf(target)];
}
