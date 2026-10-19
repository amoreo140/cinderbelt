// Micrometeor shower (M4b plan §2.2, DH §5.5 "P1+"): a stream of grains from one direction for 20–40 s.
// Every `MICROMETEORS.rayInterval` a ray crosses a band `bandWidth` u wide perpendicular to the stream
// (its offset from the stream rng); a ray that meets the ship hits the FIRST part along it. A narrow
// profile into the stream means fewer hits, armour in front means cheap ones ("turn the armour into the
// stream"). A raised shield absorbs a hit and drains `shieldDrainMult` × its damage. Cause 'hazard'.
// Everything is a pure function of (seed, sector, bucket, ray index) and the ship pose – nothing saved.
import type { RingIndex } from '../../data/economy';
import { MICROMETEORS } from '../../data/events';
import { applyRam } from '../combat/combat';
import { raycastShip, worldToGrid } from '../combat/geometry';
import { PLAYER_REF, type CombatShip } from '../combat/types';
import { TAU } from '../math/angle';
import { fnv1a32 } from '../math/fnv1a';
import { createRng } from '../math/rng';
import type { Vec2 } from '../math/vec2';
import type { SimEvent, SimState } from '../Simulation';
import { hash3 } from '../world/hash';

const TICKS = 60;
/** Ticks between two rays. */
export const RAY_TICKS = Math.round(MICROMETEORS.rayInterval * TICKS);

/** The stream seed of one shower (sector + bucket of its director roll). */
const streamSeed = (seed: number, sector: string, bucket: number): number => hash3(seed ^ MICROMETEORS.salt, fnv1a32(sector), bucket);

export interface Shower {
  /** Duration (ticks). */
  duration: number;
  /** The stream comes FROM this world direction (rad). */
  dir: number;
}

/** Duration and direction of the shower of (sector, bucket). */
export function showerOf(seed: number, sector: string, bucket: number): Shower {
  const rng = createRng(streamSeed(seed, sector, bucket));
  const [lo, hi] = MICROMETEORS.duration;
  const duration = Math.round((lo + rng() * (hi - lo)) * TICKS);
  const dir = rng() * TAU;
  return { duration, dir };
}

/** Offset of ray `i` across the band (u, −bandWidth/2 … +bandWidth/2) – independent of earlier rays. */
export function rayOffset(seed: number, sector: string, bucket: number, i: number): number {
  return (createRng(hash3(streamSeed(seed, sector, bucket), i, 1))() - 0.5) * MICROMETEORS.bandWidth;
}

export interface RayHit {
  partId: number;
  /** Where the grain enters the part's cell (world). */
  pos: Vec2;
}

/**
 * One grain: a ray along the stream (from direction `dir`, shifted `offset` u sideways from the ship's
 * centre) – the first cell of the ship it meets, or null when it misses.
 */
export function micrometeorRay(ship: Pick<CombatShip, 'grid' | 'props' | 'body'>, dir: number, offset: number): RayHit | null {
  const ux = Math.cos(dir);
  const uy = Math.sin(dir);
  const nx = -uy;
  const ny = ux;
  const reach = ship.props.boundingRadius + 2;
  const c = ship.body.pos;
  const from = { x: c.x + ux * reach + nx * offset, y: c.y + uy * reach + ny * offset };
  const to = { x: c.x - ux * reach + nx * offset, y: c.y - uy * reach + ny * offset };
  const com = ship.props.centerOfMass;
  const hit = raycastShip(ship.grid, worldToGrid(ship.body, com, from), worldToGrid(ship.body, com, to));
  if (!hit) return null;
  return { partId: hit.partId, pos: { x: from.x + (to.x - from.x) * hit.t, y: from.y + (to.y - from.y) * hit.t } };
}

/**
 * A grain hits the player's part: a raised shield absorbs it for `shieldDrainMult` × the damage (what
 * the shield cannot hold goes to the part), else the part takes the damage (cause 'hazard').
 */
export function micrometeorHit(state: SimState, hit: RayHit, depth: RingIndex, events: SimEvent[]): void {
  const player = state.player;
  const damage = MICROMETEORS.damage[depth];
  let rest = damage;
  if (player.props.shield.capacity > 0 && player.shield > 0) {
    const drain = damage * MICROMETEORS.shieldDrainMult;
    player.shieldDelay = Math.round(player.props.shield.regenDelay * TICKS);
    if (player.shield >= drain) {
      player.shield -= drain;
      rest = 0;
    } else {
      rest = damage - player.shield / MICROMETEORS.shieldDrainMult;
      player.shield = 0;
    }
  }
  events.push({ type: 'micrometeorHit', pos: hit.pos, partId: hit.partId, damage, shielded: rest <= 0 });
  if (rest > 0) applyRam(state, PLAYER_REF, player, hit.partId, rest, events, 'hazard');
}

/**
 * One step of a running shower (`start` = its first tick): a ray every `RAY_TICKS` while the player
 * flies (not berthed, not destroyed).
 */
export function stepShower(state: SimState, sector: string, bucket: number, start: number, dir: number, depth: RingIndex, events: SimEvent[]): void {
  const k = state.tick - start;
  if (k < 0 || k % RAY_TICKS !== 0) return;
  const player = state.player;
  if (player.dock.mode !== 'flying' || player.destroyed || state.sites.berth !== null) return;
  const hit = micrometeorRay(player, dir, rayOffset(state.seed, sector, bucket, k / RAY_TICKS));
  if (hit) micrometeorHit(state, hit, depth, events);
}
