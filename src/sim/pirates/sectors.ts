// Pirates by sector (sectors design §6.1, stage 1a): the spawn context of a game state and "is the
// ship in a dangerous sector" (Contested or Pirate, or the awake depth-1 corner) – what used to be
// "in the outer belts" (ring ≥ 2). Derived from the saved state only (no new state, §6.7).
import type { Vec2 } from '../math/vec2';
import { dangerousAt, regionWorld, sectorIdAt, sectorSecurity, type Security, type SecurityOverrides, type SpawnContext } from '../regions';
import type { LaneId, RelayRecord } from '../guild/types';
import { sectorEpoch } from '../sector/sector';
import type { SimState } from '../Simulation';

/** Fortresses destroyed right now (their sectors are Contested until rebuilt). */
export function destroyedFortresses(state: SimState): Set<string> {
  const out = new Set<string>();
  for (const [id, f] of state.pirates.fortresses) if (f.destroyed !== null) out.add(id);
  return out;
}

const NO_SECURED: ReadonlySet<string> = new Set();

/** Last answer per relay map: the same Set while the secured sectors stay the same (stable identity). */
const securedCache = new WeakMap<ReadonlyMap<LaneId, RelayRecord>, { key: string; set: ReadonlySet<string> }>();

/**
 * Sectors secured by a Guild relay (M4d plan §2.1): the sectors of the lanes whose relay chain reached
 * stage `secured` (`guild.relays`) – the one source of truth, folded into `securityOverrides`.
 */
export function securedSectors(state: SimState): ReadonlySet<string> {
  const relays = state.guild.relays;
  if (relays.size === 0) return NO_SECURED;
  let key = '';
  for (const r of relays.values()) if (r.stage === 'secured') key += `${r.sector};`;
  if (key === '') return NO_SECURED;
  const hit = securedCache.get(relays);
  if (hit?.key === key) return hit.set;
  const set = new Set<string>();
  for (const r of relays.values()) if (r.stage === 'secured') set.add(r.sector);
  securedCache.set(relays, { key, set });
  return set;
}

/** Does `set` hold exactly the fortresses destroyed now? */
function sameDestroyed(state: SimState, set: ReadonlySet<string>): boolean {
  let n = 0;
  for (const [id, f] of state.pirates.fortresses) {
    if (f.destroyed === null) continue;
    if (!set.has(id)) return false;
    n++;
  }
  return n === set.size;
}

/**
 * The last answers of `securityOverrides` / `spawnContext` – asked several times a step; the same object
 * while the destroyed fortresses, the secured sectors (stable identity), the training and the epoch stay
 * (perf audit 2026-10-17, P4). Read-only answers.
 */
let lastOverrides: SecurityOverrides | null = null;
let lastContext: SpawnContext | null = null;

/** What changes the security of sectors now: the destroyed fortresses and the Guild-secured sectors. */
export function securityOverrides(state: SimState): SecurityOverrides {
  const secured = securedSectors(state);
  if (lastOverrides && lastOverrides.secured === secured && sameDestroyed(state, lastOverrides.destroyedFortresses)) return lastOverrides;
  lastOverrides = { destroyedFortresses: destroyedFortresses(state), secured };
  return lastOverrides;
}

/** Spawn context of the game: Guild training running, sector epoch, the security overrides. */
export function spawnContext(state: SimState): SpawnContext {
  const training = state.career.training.status === 'active';
  const epoch = sectorEpoch(state.tick);
  const o = securityOverrides(state);
  const c = lastContext;
  if (c && c.training === training && c.epoch === epoch && c.destroyedFortresses === o.destroyedFortresses && c.secured === o.secured) return c;
  lastContext = { training, epoch, ...o };
  return lastContext;
}

/**
 * The security of the sector at `pos` NOW (M4b, M4d §2.1): `currentSecurity` with the security overrides
 * (destroyed fortresses, Guild-secured sectors). The one security read of the events director, ambushes
 * and other live logic. Site PLACEMENT never uses it (static security, §2.1).
 */
export const securityHere = (state: SimState, pos: Vec2): Security =>
  sectorSecurity(state.seed, sectorIdAt(state.seed, pos.x, pos.y), securityOverrides(state));

/** The point lies in a dangerous sector (attention, toll and hunting parties). */
export const dangerousSector = (state: SimState, pos: Vec2, ctx: SpawnContext = spawnContext(state)): boolean =>
  dangerousAt(regionWorld(state.seed), pos.x, pos.y, ctx);
