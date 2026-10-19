// Dismantling wrecks (long-term design 5.3.1, M3.6): a larger POI wreck has a grid of parts, some of
// them intact (valuable). A joint = a part whose removal splits the wreck (BFS as when ships break up,
// spec 2.3). The laser cuts a joint (a fuel tank and a reactor blow when cut), the tractor beam rips a
// loose part. The pieces are towed to the ship and F loads them. A seed wreck (POI or M4b graveyard)
// remembers its cut parts (saved).
import { scrapResources } from '../../data/economy';
import { partKey } from '../../data/parts';
import { CUT_BLAST, CUT_BLAST_RADIUS, LOAD_MAX_PARTS, PIECE_SCRAP_HP } from '../../data/salvage';
import { applyRam } from '../combat/combat';
import { components } from '../combat/damage';
import { cellOwners, gridToWorld, worldToGrid } from '../combat/geometry';
import type { Wreck, WreckLoot } from '../combat/types';
import { addScrap, createWreck, dropsWhole, emptyLoot, lootEmpty, partScrap, wreckLootOwner, type LootOwner } from '../combat/wrecks';
import { add, length, normalize, rotate, scale, sub, type Vec2 } from '../math/vec2';
import { partCells, partCenter } from '../ship/grid';
import { maxHp } from '../ship/hp';
import { computeProperties } from '../ship/properties';
import type { PlacedPart, ShipGrid } from '../ship/types';
import type { SimEvent, SimState } from '../Simulation';
import { isSeedWreckKey } from '../sites/graveyardKeys';

const jointCache = new WeakMap<ShipGrid, Set<number>>();

/** Joints: parts whose removal splits the rest of the grid into more pieces. */
export function jointParts(grid: ShipGrid): Set<number> {
  let out = jointCache.get(grid);
  if (out) return out;
  out = new Set();
  if (grid.parts.length >= 3) {
    for (const p of grid.parts) {
      if (components(grid.parts.filter((q) => q !== p)).length > 1) out.add(p.id);
    }
  }
  jointCache.set(grid, out);
  return out;
}

/** A dismantlable wreck too big to load. */
export const isHulk = (w: Pick<Wreck, 'dismantle' | 'grid'>): boolean => w.dismantle !== undefined && w.grid.parts.length > LOAD_MAX_PARTS;

/** Can the wreck be loaded (F)? It has loot and is not a big wreck to dismantle. */
export const loadable = (w: Wreck): boolean => !lootEmpty(w.loot) && !isHulk(w);

/** Parts next to part `p` (through its cells). */
export function neighborParts(grid: ShipGrid, p: PlacedPart): number[] {
  const owners = cellOwners(grid);
  const out = new Set<number>();
  for (const c of partCells(p)) {
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const id = owners.get(`${c.x + dx},${c.y + dy}`);
      if (id !== undefined && id !== p.id) out.add(id);
    }
  }
  return [...out].sort((a, b) => a - b);
}

/** The wreck's part under a world point (or the nearest part within 1.5 cells), else null. */
export function partAt(w: Pick<Wreck, 'grid' | 'body' | 'props'>, point: Vec2): PlacedPart | null {
  const g = worldToGrid(w.body, w.props.centerOfMass, point);
  let best: PlacedPart | null = null;
  let bestD = 1.5;
  for (const p of w.grid.parts) {
    for (const c of partCells(p)) {
      const d = Math.max(Math.abs(c.x - g.x), Math.abs(c.y - g.y));
      if (d < bestD) {
        bestD = d;
        best = p;
      }
    }
  }
  return best;
}

/**
 * Loot of a piece: intact parts as parts, the others as scrap (30–70 % HP). Shaped armour (SL2 E2 §2.4):
 * an intact one drops whole when `dropsWhole` says so (always for the player's own plates, from another
 * wreck only with area ≥ 0.75), otherwise it scraps by `partScrap` – intact at its max HP, the rest at
 * PIECE_SCRAP_HP of it.
 */
export function pieceLoot(parts: readonly PlacedPart[], intact: ReadonlySet<number>, owner: LootOwner = 'other'): WreckLoot {
  const loot = emptyLoot();
  for (const p of parts) {
    const key = partKey(p.partId, p.tier, p.variant);
    if (intact.has(p.id) && dropsWhole(p, owner)) {
      loot.parts[key] = (loot.parts[key] ?? 0) + 1;
      continue;
    }
    if (p.shape !== undefined) {
      addScrap(loot, partScrap(p, intact.has(p.id) ? maxHp(p) : PIECE_SCRAP_HP * maxHp(p), owner));
      continue;
    }
    addScrap(loot, scrapResources(key, PIECE_SCRAP_HP, 1));
  }
  return loot;
}

/** Inventory of the intact parts the wreck still holds. */
export function intactInventory(w: Pick<Wreck, 'grid' | 'dismantle'>): WreckLoot['parts'] {
  const intact = new Set(w.dismantle?.intact ?? []);
  return pieceLoot(
    w.grid.parts.filter((p) => intact.has(p.id)),
    intact,
  ).parts;
}

/** Remembers the cut parts of a seed wreck (when the player returns, the wreck is rebuilt without them). */
function rememberCut(state: SimState, w: Wreck, ids: readonly number[]): void {
  if (!isSeedWreckKey(w.poi) || ids.length === 0) return;
  const list = state.discovery.cut.get(w.poi) ?? [];
  for (const id of ids) if (!list.includes(id)) list.push(id);
  list.sort((a, b) => a - b);
  state.discovery.cut.set(w.poi, list);
}

/**
 * Removes the parts `gone` (destroyed) and `rip` (ripped whole as a piece) from the wreck. The wreck keeps
 * the piece with the lowest part id, the other connected parts become pieces of their own. Returns the new pieces.
 */
export function detach(state: SimState, w: Wreck, gone: ReadonlySet<number>, rip: number | null = null): Wreck[] {
  const { combat } = state;
  const intact = new Set(w.dismantle?.intact ?? []);
  // a POI wreck already loaded (F) is stripped: its pieces carry nothing – no second copy of the
  // intact parts, no scrap of what was already taken (C3)
  const stripped = !!w.poi && state.discovery.opened.has(w.poi);
  const ripped = rip === null ? null : (w.grid.parts.find((p) => p.id === rip) ?? null);
  const left = w.grid.parts.filter((p) => !gone.has(p.id) && p.id !== rip);
  const comps = components(left);
  const minId = Math.min(...left.map((p) => p.id));
  const keep = comps.find((c) => c.some((p) => p.id === minId)) ?? [];
  const loose = [...comps.filter((c) => c !== keep), ...(ripped ? [[ripped]] : [])];
  const source = { body: w.body, props: { centerOfMass: w.props.centerOfMass } };
  const pieces: Wreck[] = [];
  const removedIds: number[] = [...gone, ...(rip !== null ? [rip] : [])];
  for (const piece of loose) {
    const center = piece.reduce((s, p) => add(s, partCenter(p)), { x: 0, y: 0 });
    const local = scale(center, 1 / piece.length);
    const out = normalize(sub(gridToWorld(w.body, w.props.centerOfMass, local), w.body.pos));
    const motion = { vel: add(w.body.vel, scale(out, 0.8)), angVel: w.body.angVel + (piece.length === 1 ? 0.4 : 0.15) };
    const pw = createWreck(combat.nextId++, piece, source, motion, stripped ? emptyLoot() : pieceLoot(piece, intact, wreckLootOwner(w)), w.livery);
    if (isSeedWreckKey(w.poi) || w.from) pw.from = w.poi ?? w.from;
    if (w.ship !== undefined) pw.ship = w.ship;
    pieces.push(pw);
    removedIds.push(...piece.map((p) => p.id));
    combat.wrecks.push(pw);
  }
  rememberCut(state, w, removedIds);
  if (keep.length === 0) {
    combat.wrecks = combat.wrecks.filter((x) => x !== w);
    if (isSeedWreckKey(w.poi)) state.discovery.opened.add(w.poi);
    return pieces;
  }
  // the wreck stays in place: the body's position is the centre of mass – it moves by the change of it
  const grid = { parts: keep, nextId: w.grid.nextId };
  const props = computeProperties(grid);
  const shift = rotate(sub(props.centerOfMass, w.props.centerOfMass), w.body.angle);
  w.body = { ...w.body, pos: add(w.body.pos, shift) };
  w.prevBody = { ...w.prevBody, pos: add(w.prevBody.pos, shift) };
  w.grid = grid;
  w.props = props;
  delete w.cutting;
  if (w.dismantle) {
    const ids = new Set(keep.map((p) => p.id));
    w.dismantle = { intact: w.dismantle.intact.filter((id) => ids.has(id)) };
    w.loot.parts = intactInventory(w);
  }
  return pieces;
}

/**
 * A cut joint: the part is gone; a fuel tank or a reactor blows – it destroys the neighbouring parts
 * and hits the player's ship within the blast.
 */
export function cutJoint(state: SimState, w: Wreck, partId: number, events: SimEvent[]): void {
  const part = w.grid.parts.find((p) => p.id === partId);
  if (!part) return;
  const pos = gridToWorld(w.body, w.props.centerOfMass, partCenter(part));
  const blast = CUT_BLAST[part.partId] ?? 0;
  const gone = new Set([partId]);
  if (blast > 0) for (const id of neighborParts(w.grid, part)) gone.add(id);
  const pieces = detach(state, w, gone);
  events.push({ type: 'wreckCut', wreckId: w.id, partId, pos, pieces: pieces.map((p) => p.id), blast });
  if (blast > 0) blastPlayer(state, pos, blast, events);
}

/** A blast by the player's ship: the damage falls with the distance (half at the edge of the reach). */
function blastPlayer(state: SimState, pos: Vec2, damage: number, events: SimEvent[]): void {
  const player = state.player;
  if (player.dock.mode !== 'flying' || player.destroyed) return;
  const d = length(sub(player.body.pos, pos)) - player.props.boundingRadius;
  if (d > CUT_BLAST_RADIUS) return;
  const amount = Math.round(damage * (1 - 0.5 * Math.max(0, d) / CUT_BLAST_RADIUS));
  const local = worldToGrid(player.body, player.props.centerOfMass, pos);
  let best: PlacedPart | null = null;
  let bestD = Infinity;
  for (const p of player.grid.parts) {
    const c = partCenter(p);
    const dd = Math.hypot(c.x - local.x, c.y - local.y);
    if (dd < bestD) {
      bestD = dd;
      best = p;
    }
  }
  events.push({ type: 'cutBlast', pos: { ...pos }, damage: amount });
  applyRam(state, 'player', player, best?.id ?? null, amount, events, 'hazard');
}

/** Rips a loose part (not a joint) out of the wreck as a piece of its own. Returns the piece, or null. */
export function ripPart(state: SimState, w: Wreck, partId: number, events: SimEvent[]): Wreck | null {
  const part = w.grid.parts.find((p) => p.id === partId);
  if (!part || w.grid.parts.length < 2 || jointParts(w.grid).has(partId)) return null;
  const pos = gridToWorld(w.body, w.props.centerOfMass, partCenter(part));
  const pieces = detach(state, w, new Set(), partId);
  const piece = pieces.find((p) => p.grid.parts.some((q) => q.id === partId)) ?? null;
  if (piece) events.push({ type: 'partRipped', wreckId: w.id, partId, pos, piece: piece.id });
  return piece;
}
