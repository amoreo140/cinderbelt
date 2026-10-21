// Wrecks (spec 2.3, 2.7): detached parts of ships and the remains of destroyed pirates. A wreck drifts
// (slightly damped), disappears after a while and its loot can be loaded (F at the wreck).
import { scrapResources } from '../../data/economy';
import { SHAPE_LOOT_MIN_AREA } from '../../data/shapes';
import { partKey, type PartInventory } from '../../data/parts';
import { cargoUsed, emptyCargo, RESOURCE_IDS, type Cargo } from '../../data/resources';
import { driftDamped, type Body } from '../physics/body';
import { resolveCollisions, type Circle } from '../physics/collide';
import { computeProperties, type ShipProperties } from '../ship/properties';
import { currentHp, fullEquivalentHp, fullMaxHp, maxHp } from '../ship/hp';
import { hpMultOf } from '../ship/shape';
import type { HpMap, PlacedPart } from '../ship/types';
import { gridToWorld } from './geometry';
import type { Livery, Wreck, WreckLoot } from './types';

/** A wreck disappears after 5 minutes of game time. */
export const WRECK_TTL = 5 * 60 * 60;
/** A wreck shrinks over its last frames (render) and disappears. */
export const WRECK_FADE_TICKS = 90;
/**
 * A wreck this close to the player never starts to fade (its lifetime stops counting just above the fade):
 * it would shrink and vanish in front of the player. The camera's farthest zoom-out (210) frames the
 * ground well under 250 from the ship, so the shrink happens off-screen.
 */
export const WRECK_KEEP_RANGE = 250;
/** At most this many wrecks at once – the oldest disappear first. */
export const MAX_WRECKS = 40;
/** Loot can be loaded while the gap between the ship's and the wreck's bounds is at most this. */
export const SALVAGE_RANGE = 6;
/** Drift damping (share of the velocity per second). */
const LINEAR_DAMPING = 0.12;
const ANGULAR_DAMPING = 0.25;

export const emptyLoot = (): WreckLoot => ({ cargo: emptyCargo(), parts: {} });

export function lootEmpty(loot: WreckLoot): boolean {
  return RESOURCE_IDS.every((r) => loot.cargo[r] <= 1e-9) && Object.values(loot.parts).every((n) => (n ?? 0) <= 0);
}

/** Parts as an inventory (key type:tier → count). */
export function partsInventory(parts: readonly PlacedPart[]): PartInventory {
  const inv: PartInventory = {};
  for (const p of parts) {
    const key = partKey(p.partId, p.tier, p.variant);
    inv[key] = (inv[key] ?? 0) + 1;
  }
  return inv;
}

/**
 * Whose parts a wreck holds: the player's own ship (livery `default`, not a POI wreck) or anyone else's
 * (pirates, derelicts). It decides how shaped armour drops (SL2 E2 §2.4).
 */
export type LootOwner = 'player' | 'other';

/** The loot owner of a wreck: the player's own combat wreck, or anyone else's (pirates, POI wrecks and their pieces). */
export const wreckLootOwner = (w: Pick<Wreck, 'livery' | 'poi' | 'from'>): LootOwner =>
  w.livery === 'default' && !w.poi && !w.from ? 'player' : 'other';

/**
 * Does an intact part drop as the part (else as scrap)? A full part always does, and so does the
 * player's own shaped plate (it was one item, folded); a shaped part of another wreck only with an area
 * of at least `SHAPE_LOOT_MIN_AREA` (a wedge cut from someone's hull is not a whole plate).
 */
export function dropsWhole(part: PlacedPart, owner: LootOwner): boolean {
  return part.shape === undefined || owner === 'player' || hpMultOf(part) >= SHAPE_LOOT_MIN_AREA;
}

/**
 * Scrap of a part at `hp` of its max HP. A full part scraps by its HP share as always. A shaped plate of
 * the player scraps from its full-equivalent HP (damage = the HP missing, in full-plate HP, §2.3); one of
 * another wreck from `area × full HP × hp / max`, i.e. in proportion to the plate it was cut from.
 */
export function partScrap(part: PlacedPart, hp: number, owner: LootOwner): Partial<Cargo> {
  const key = partKey(part.partId, part.tier, part.variant);
  if (part.shape === undefined) return scrapResources(key, hp, maxHp(part));
  const full = fullMaxHp(part);
  if (owner === 'player') return scrapResources(key, fullEquivalentHp(part, hp), full);
  return scrapResources(key, (hpMultOf(part) * full * hp) / maxHp(part), full);
}

/**
 * Adds a part to the loot: intact as the part, damaged (hp < max) as scrap – the storage holds only
 * parts at full HP, so a loaded damaged part would otherwise be "repaired" for free (I7). Shaped armour
 * follows `dropsWhole` / `partScrap` (SL2 E2 §2.4).
 */
export function addPartLoot(loot: WreckLoot, part: PlacedPart, hp: HpMap, owner: LootOwner): void {
  // a Guild loan part torn off the hull goes back to the Guild – nothing to salvage, not even scrap
  if (part.loan) return;
  const now = currentHp(hp, part);
  if (now >= maxHp(part) && dropsWhole(part, owner)) {
    const key = partKey(part.partId, part.tier, part.variant);
    loot.parts[key] = (loot.parts[key] ?? 0) + 1;
    return;
  }
  addScrap(loot, partScrap(part, now, owner));
}

/** Adds scrap resources to the loot. */
export function addScrap(loot: WreckLoot, scrap: Partial<Cargo>): void {
  for (const r of RESOURCE_IDS) loot.cargo[r] += scrap[r] ?? 0;
}

export interface WreckSource {
  body: Body;
  props: Pick<ShipProperties, 'centerOfMass'>;
}

/** A wreck of the parts of ship `source` – it stays exactly where the parts were. */
export function createWreck(
  id: number,
  parts: readonly PlacedPart[],
  source: WreckSource,
  motion: { vel: { x: number; y: number }; angVel: number },
  loot: WreckLoot,
  livery: Livery,
  ttl = WRECK_TTL,
): Wreck {
  const grid = { parts: parts.map((p) => ({ ...p })), nextId: Math.max(0, ...parts.map((p) => p.id)) + 1 };
  const props = computeProperties(grid);
  const pos = gridToWorld(source.body, source.props.centerOfMass, props.centerOfMass);
  const body: Body = { pos, vel: { ...motion.vel }, angle: source.body.angle, angVel: motion.angVel };
  return { id, grid, props, body, prevBody: body, loot, ttl, livery };
}

/** One drift step of a wreck; static obstacles (asteroids, stations) bounce it. */
export function stepWreck(w: Wreck, obstacles: readonly Circle[], dt: number, keep = false): void {
  w.prevBody = w.body;
  const damped = driftDamped(w.body, dt, LINEAR_DAMPING, ANGULAR_DAMPING);
  w.body = obstacles.length > 0 ? resolveCollisions(damped, w.props.cellOffsets, w.props.boundingRadius, obstacles).body : damped;
  // `keep` (near the player): the lifetime counts down only until the fade would begin
  if (!keep || w.ttl > WRECK_FADE_TICKS + 1) w.ttl--;
}

/** Is the wreck within `WRECK_KEEP_RANGE` of the player (so it must not fade)? */
export const wreckKept = (w: Wreck, pos: { x: number; y: number }): boolean =>
  (w.body.pos.x - pos.x) ** 2 + (w.body.pos.y - pos.y) ** 2 <= WRECK_KEEP_RANGE * WRECK_KEEP_RANGE;

/** The gap between the ship's and the wreck's bounds. */
export const wreckGap = (w: Wreck, pos: { x: number; y: number }, boundingRadius: number): number =>
  Math.hypot(w.body.pos.x - pos.x, w.body.pos.y - pos.y) - w.props.boundingRadius - boundingRadius;

/** The nearest wreck with loot within loading range, or null. */
export function salvageTarget(wrecks: readonly Wreck[], pos: { x: number; y: number }, boundingRadius: number): Wreck | null {
  let best: Wreck | null = null;
  let bestGap = SALVAGE_RANGE + 1e-9;
  for (const w of wrecks) {
    if (lootEmpty(w.loot)) continue;
    const gap = wreckGap(w, pos, boundingRadius);
    if (gap <= bestGap) {
      bestGap = gap;
      best = w;
    }
  }
  return best;
}

export interface SalvageResult {
  cargo: Partial<Cargo>;
  parts: PartInventory;
  /** Some resources stayed in the wreck – the cargo hold is full. */
  cargoFull: boolean;
}

/**
 * Loads the loot: resources into the cargo (up to capacity), parts into `salvage` (parts on board, moved
 * to the storage at a station). Changes `cargo`, `salvage` and the wreck's loot.
 */
export function salvageWreck(w: Wreck, cargo: Cargo, cargoCapacity: number, salvage: PartInventory): SalvageResult {
  return salvageLoot(w.loot, cargo, cargoCapacity, salvage);
}

/** Loads loot (a wreck, a container): resources into the cargo, parts on board. Changes `loot` too. */
export function salvageLoot(loot: WreckLoot, cargo: Cargo, cargoCapacity: number, salvage: PartInventory): SalvageResult {
  const w = { loot };
  let free = Math.max(0, cargoCapacity - cargoUsed(cargo));
  const taken: Partial<Cargo> = {};
  let cargoFull = false;
  for (const r of RESOURCE_IDS) {
    const have = w.loot.cargo[r];
    if (have <= 0) continue;
    const amount = Math.min(have, free);
    if (amount < have - 1e-9) cargoFull = true;
    if (amount <= 0) continue;
    cargo[r] += amount;
    w.loot.cargo[r] = have - amount < 1e-9 ? 0 : have - amount;
    free -= amount;
    taken[r] = amount;
  }
  const parts: PartInventory = {};
  for (const [key, n] of Object.entries(w.loot.parts) as [keyof PartInventory, number][]) {
    if (!n) continue;
    salvage[key] = (salvage[key] ?? 0) + n;
    parts[key] = n;
  }
  w.loot.parts = {};
  return { cargo: taken, parts, cargoFull };
}

/** Adds the loot `add` to `into` (resources and parts) and empties `add`. */
export function mergeLoot(into: WreckLoot, add: WreckLoot): void {
  for (const r of RESOURCE_IDS) {
    into.cargo[r] += add.cargo[r];
    add.cargo[r] = 0;
  }
  for (const [key, n] of Object.entries(add.parts) as [keyof PartInventory, number][]) {
    if (n > 0) into.parts[key] = (into.parts[key] ?? 0) + n;
  }
  add.parts = {};
}
