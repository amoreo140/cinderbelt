// Ambush (M4b plan §2.2, DH §5.5: "2–4 pirates come out of the dark"). After the radio lead the party
// spawns `AMBUSH.spawnDistance` u from the player on a bearing that lies in a dangerous sector (like the
// hunting party, pirates.ts `stepHunt`) and attacks. Party by depth: 2 → Hammer + 1–2 Jackals (T1);
// 3 → 3 ships, the leader a Gunner (30 %) else a Hammer (T1); 4 → 3–4 ships (T2). A Hammer-led party
// may hail for a toll when it closes in (the sector's `TOLL.chance`, like a regular group). Ids
// `ab:<sector>@<bucket>:<i>` (group `ab:<sector>@<bucket>`); the party never respawns.
import type { RingIndex } from '../../data/economy';
import { AMBUSH } from '../../data/events';
import { TOLL } from '../../data/pirates';
import { AGGRO_RANGE } from '../combat/ai';
import { createEnemy } from '../combat/enemies';
import type { Enemy, EnemyKind } from '../combat/types';
import { TAU } from '../math/angle';
import { fnv1a32 } from '../math/fnv1a';
import { createRng } from '../math/rng';
import { length, sub, type Vec2 } from '../math/vec2';
import { tollAmount } from '../pirates/pirates';
import { dangerousSector, securityHere, spawnContext } from '../pirates/sectors';
import type { SimEvent, SimState } from '../Simulation';
import { hash3 } from '../world/hash';

const TICKS = 60;

/** Group of an ambush party (the toll group) and the id of its ship `i`. */
export const ambushGroup = (sector: string, bucket: number): string => `ab:${sector}@${bucket}`;
export const ambushShipId = (sector: string, bucket: number, i: number): string => `${ambushGroup(sector, bucket)}:${i}`;

export interface AmbushParty {
  /** Kinds in slot order: the leader first. */
  kinds: EnemyKind[];
  tier: 1 | 2;
  /** The first bearing tried (rad); the party comes from the first of 8 bearings in a dangerous sector. */
  bearing: number;
}

/** The party of (sector, bucket) at a depth (depth 1 – only a forced event – uses the depth-2 party). */
export function ambushParty(seed: number, sector: string, bucket: number, depth: RingIndex): AmbushParty {
  const d = Math.max(2, depth) as RingIndex;
  const rng = createRng(hash3(seed ^ AMBUSH.salt, fnv1a32(sector), bucket));
  const def = AMBUSH.party[d];
  const size = def.size[0] + Math.floor(rng() * (def.size[1] - def.size[0] + 1));
  const gunner = rng() < AMBUSH.gunnerLeaderChance;
  const bearing = rng() * TAU;
  const leader: EnemyKind = d >= 3 && gunner ? 'gunner' : 'hammer';
  const kinds: EnemyKind[] = [leader];
  for (let i = 1; i < size; i++) kinds.push('jackal');
  return { kinds, tier: def.tier, bearing };
}

/** The bearing the party comes from: the first of 8 from `a0` whose spawn point lies in a dangerous sector, else `a0`. */
export function ambushBearing(state: SimState, a0: number, from: Vec2): number {
  const ctx = spawnContext(state);
  for (let k = 0; k < 8; k++) {
    const b = a0 + (k * TAU) / 8;
    const at = { x: from.x + Math.cos(b) * AMBUSH.spawnDistance, y: from.y + Math.sin(b) * AMBUSH.spawnDistance };
    if (dangerousSector(state, at, ctx)) return b;
  }
  return a0;
}

/** AI budget (DH §12.4, ≤ 10 AI ships): fewer than `maxNearby` enemies near the player and `maxEnemies` in all. */
export function ambushBudgetOk(state: SimState): boolean {
  const enemies = state.combat.enemies;
  if (enemies.length >= AMBUSH.maxEnemies) return false;
  const pos = state.player.body.pos;
  let near = 0;
  for (const e of enemies) if (length(sub(e.body.pos, pos)) <= AMBUSH.nearbyRange) near++;
  return near < AMBUSH.maxNearby;
}

/** The living ships of a party. */
export function ambushMembers(state: SimState, sector: string, bucket: number): Enemy[] {
  const prefix = `${ambushGroup(sector, bucket)}:`;
  return state.combat.enemies.filter((e) => e.id.startsWith(prefix));
}

/** Spawns the party around the player (attack mode). Returns the spawn point and the leader, or null when nothing spawned. */
export function spawnAmbush(state: SimState, sector: string, bucket: number, depth: RingIndex): { pos: Vec2; count: number; leader: EnemyKind; bearing: number } | null {
  const party = ambushParty(state.seed, sector, bucket, depth);
  const home = { ...state.player.body.pos };
  const a = ambushBearing(state, party.bearing, home);
  const at = { x: home.x + Math.cos(a) * AMBUSH.spawnDistance, y: home.y + Math.sin(a) * AMBUSH.spawnDistance };
  const alive = new Set(state.combat.enemies.map((e) => e.id));
  let count = 0;
  party.kinds.forEach((kind, i) => {
    const id = ambushShipId(sector, bucket, i);
    if (alive.has(id) || state.combat.defeated.has(id)) return;
    const pos = i === 0 ? at : { x: at.x + Math.cos(a + 1.6 + i) * 12, y: at.y + Math.sin(a + 1.6 + i) * 12 };
    const e = createEnemy({ id, kind, tier: party.tier, pos, angle: a + Math.PI, home, orbit: i % 2 === 0 ? 1 : -1 });
    e.ai.mode = 'attack';
    state.combat.enemies.push(e);
    count++;
  });
  return count > 0 ? { pos: at, count, leader: party.kinds[0]!, bearing: a } : null;
}

/**
 * The party's toll hail (once per party, `hailKey` in `director.fired`): when a Hammer leader first comes
 * within its aggro range of the flying player, it hails with the sector's `TOLL.chance` – unless a toll
 * is already running or the group was tolled / paid. The pirate step (pirates.ts `stepToll`) then runs
 * the demand like a regular group's.
 */
export function stepAmbushHail(state: SimState, key: string, sector: string, bucket: number, events: SimEvent[]): void {
  const fired = state.director.fired;
  const group = ambushGroup(sector, bucket);
  const members = ambushMembers(state, sector, bucket);
  const p = state.pirates;
  // safety net: a member left hailing without a running toll of its group fights instead
  for (const m of members) if (m.ai.mode === 'hail' && p.toll?.group !== group) m.ai.mode = 'attack';
  const hailKey = `${key}#hail`;
  if (fired.has(hailKey)) return;
  const player = state.player;
  if (player.dock.mode !== 'flying' || player.destroyed) return;
  const leader = members.find((m) => m.id === ambushShipId(sector, bucket, 0));
  if (!leader || leader.kind !== 'hammer') return;
  if (length(sub(leader.body.pos, player.body.pos)) > AGGRO_RANGE.hammer) return;
  fired.set(hailKey, state.tick);
  if (p.toll || (p.tolled.get(group) ?? -1) > state.tick || (p.paid.get(group) ?? -1) > state.tick) return;
  const chance = TOLL.chance[securityHere(state, player.body.pos)];
  if (createRng(hash3(state.seed ^ AMBUSH.salt, fnv1a32(group), 7))() >= chance) return;
  const amount = tollAmount(state);
  p.toll = { group, amount, until: state.tick + TOLL.seconds * TICKS };
  for (const m of members) m.ai.mode = 'hail';
  events.push({ type: 'tollDemanded', group, amount, until: p.toll.until, pos: { ...leader.body.pos } });
}
