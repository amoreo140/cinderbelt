// Guild loan – the only free help (saboteur report, rules 1–3; replaces the home
// emergency kit of bot report F2). A player who lost every mining laser – or every forward engine –
// and whose reachable wealth cannot buy the missing part gets a T1 part lent by the Guild, mounted on
// the hull for free, at any station with a shipyard. Loan parts work like any other part but can
// never leave the hull (no sale, scrap, storage, courier or crafting – see ship/loan.ts), so the help
// never turns into value: abusing it gains nothing a player would otherwise have to mine or earn.
import { INSTALL_FEE, partBuyPrice, partSellPrice, resourcePrice, scrapResources } from '../../data/economy';
import { parsePartKey, partDefOf, partKey, type PartInventory, type PartKey } from '../../data/parts';
import { RESOURCE_IDS } from '../../data/resources';
import type { SimEvent, SimState } from '../Simulation';
import { partCells } from '../ship/grid';
import { currentHp, fullEquivalentHp, fullMaxHp, maxHp } from '../ship/hp';
import { isLoanPart } from '../ship/loan';
import { computeProperties } from '../ship/properties';
import type { HpMap, PlacedPart, ShipGrid } from '../ship/types';
import { blockedOutputs } from '../shipyard/design';
import { hullBudgetOf } from '../ship/budget';
import { applyEditorOp } from '../shipyard/editor';
import type { StationDef, StationId } from '../world/stations';
import { rebuiltDockPose } from './dock';
import { stationStorage } from './storage';

export const LOAN_LASER_KEY: PartKey = 'miningLaser:1';
export const LOAN_ENGINE_KEY: PartKey = 'engine:1';

const isMiningKey = (key: string): boolean => !!partDefOf(key as PartKey).mining;
const isEngineKey = (key: string): boolean => parsePartKey(key as PartKey).partId === 'engine';
const keyOf = (p: PlacedPart): PartKey => partKey(p.partId, p.tier, p.variant);

/**
 * What the player could raise right here, right now: credits + every owned part a removal-only draft
 * can take off the hull (I4: not the cockpit, nor the cheapest line of parts that keeps a forward engine
 * on it – the shipyard refuses a draft without one) at what liquidating it yields here (intact parts at
 * the buy-back price, damaged ones as scrap at this station's resource prices) + the parts in this
 * station's storage and on board + the cargo and this station's stored resources at this station's
 * sell price. Parts at other stations or in courier shipments are not reachable and do not count (S2).
 */
export function reachableWorth(state: SimState, station: StationDef): number {
  const { player } = state;
  const sell = (r: (typeof RESOURCE_IDS)[number]): number => resourcePrice(r, station.ring, station.priceJitter[r]).sell;
  const value = (p: PlacedPart): number => (p.partId === 'cockpit' ? 0 : liquidValue(p, player.hp, sell));
  const kept = keptForFlight(player.grid, value);
  let worth = storedWorth(state, station);
  for (const p of player.grid.parts) if (!kept.has(p.id)) worth += value(p);
  for (const [key, n] of Object.entries(player.salvage) as [PartKey, number][]) worth += partSellPrice(key) * (n ?? 0);
  for (const r of RESOURCE_IDS) worth += player.cargo[r] * sell(r);
  return worth;
}

/**
 * Credits + this station's storage (parts at the buy-back price, resources at its sell price) + the
 * ships stored in its hangar (M4a): every part as dismantling and selling it yields (intact at the
 * buy-back price, damaged as scrap at this station's prices) and their cargo at the sell price.
 */
export function storedWorth(state: SimState, station: StationDef): number {
  const storage = stationStorage(state, station.id);
  const sell = (r: (typeof RESOURCE_IDS)[number]): number => resourcePrice(r, station.ring, station.priceJitter[r]).sell;
  let worth = state.credits;
  for (const [key, n] of Object.entries(storage.parts) as [PartKey, number][]) worth += partSellPrice(key) * (n ?? 0);
  for (const r of RESOURCE_IDS) worth += storage.resources[r] * sell(r);
  for (const ship of state.fleet.stored) {
    if (ship.stationId !== station.id) continue;
    for (const p of ship.grid.parts) worth += liquidValue(p, ship.hp, sell);
    for (const r of RESOURCE_IDS) worth += ship.cargo[r] * sell(r);
  }
  return worth;
}

/**
 * What a part yields when taken off and sold: intact at the buy-back price, damaged as scrap (no loan).
 * A shaped plate (SL2 E2) is one folded inventory item – its scrap counts the full-equivalent HP, like
 * repair and scrapping do.
 */
function liquidValue(p: PlacedPart, hp: HpMap, sell: (r: (typeof RESOURCE_IDS)[number]) => number): number {
  if (isLoanPart(p)) return 0;
  const now = currentHp(hp, p);
  if (now >= maxHp(p)) return partSellPrice(keyOf(p));
  const scrap = scrapResources(keyOf(p), fullEquivalentHp(p, now), fullMaxHp(p));
  return RESOURCE_IDS.reduce((s, r) => s + (scrap[r] ?? 0) * sell(r), 0);
}

/**
 * Parts a removal-only draft must keep (I4): with forward thrust, the cockpit and the line of parts to
 * the forward engine that is cheapest to keep (by `value`); a ship without forward thrust may be
 * stripped to the cockpit (removalOnlyFromStranded in the shipyard).
 */
export function keptForFlight(grid: ShipGrid, value: (p: PlacedPart) => number): Set<number> {
  const cockpit = grid.parts.find((p) => p.partId === 'cockpit');
  if (!cockpit) return new Set();
  if (computeProperties(grid).thrust.forward <= 0) return new Set([cockpit.id]);
  const owner = new Map<string, PlacedPart>();
  for (const p of grid.parts) for (const c of partCells(p)) owner.set(`${c.x},${c.y}`, p);
  const neighbours = (p: PlacedPart): PlacedPart[] => {
    const out = new Set<PlacedPart>();
    for (const c of partCells(p)) {
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const n = owner.get(`${c.x + dx},${c.y + dy}`);
        if (n && n !== p) out.add(n);
      }
    }
    return [...out];
  };
  const forward = (p: PlacedPart): boolean => !!partDefOf(keyOf(p)).thrust && p.rot === 0;
  // Dijkstra over the parts from the cockpit, the cost of a part = what keeping it forgoes
  const cost = new Map<number, number>([[cockpit.id, 0]]);
  const prev = new Map<number, PlacedPart>();
  const open = new Set<PlacedPart>([cockpit]);
  const done = new Set<number>();
  while (open.size > 0) {
    let at: PlacedPart | null = null;
    for (const p of open) if (!at || cost.get(p.id)! < cost.get(at.id)! || (cost.get(p.id) === cost.get(at.id) && p.id < at.id)) at = p;
    open.delete(at!);
    done.add(at!.id);
    if (forward(at!)) {
      const keep = new Set<number>();
      for (let p: PlacedPart | undefined = at!; p; p = prev.get(p.id)) keep.add(p.id);
      return keep;
    }
    for (const n of neighbours(at!)) {
      if (done.has(n.id)) continue;
      const c = cost.get(at!.id)! + value(n);
      if (c < (cost.get(n.id) ?? Infinity)) {
        cost.set(n.id, c);
        prev.set(n.id, at!);
        open.add(n);
      }
    }
  }
  return new Set([cockpit.id]);
}

/**
 * A part of this kind is in reach: in this station's storage, on board (salvage), or on a ship stored
 * in this station's hangar (M4a – it can be dismantled into storage).
 */
function spareInReach(state: SimState, station: StationDef, match: (key: string) => boolean): boolean {
  const inStock = [stationStorage(state, station.id).parts, state.player.salvage].some((inv) =>
    Object.entries(inv).some(([key, n]) => (n ?? 0) > 0 && match(key)),
  );
  return inStock || state.fleet.stored.some((s) => s.stationId === station.id && s.grid.parts.some((p) => !isLoanPart(p) && match(keyOf(p))));
}

/** A ship that can fly forward stands in this station's hangar: the player can switch to it (M4a). */
export const flyableStoredHere = (state: SimState, station: StationDef): boolean =>
  state.fleet.stored.some((s) => s.stationId === station.id && computeProperties(s.grid).thrust.forward > 0);

/** Price of a part here, install included (Infinity when it is not sold here). */
export const priceHere = (key: PartKey, station: StationDef): number => {
  const price = partBuyPrice(key, station.ring);
  return price === null ? Infinity : price + INSTALL_FEE;
};

/** What the Guild would lend right now at this station (empty = nothing). */
export function guildLoanOffer(state: SimState, station: StationDef): PartKey[] {
  if (!station.services.shipyard || state.player.destroyed) return [];
  const { props } = state.player;
  const needLaser = props.lasers.length === 0 && !spareInReach(state, station, isMiningKey);
  // engines on the hull may only push sideways or backwards – a spare one can be mounted facing aft
  const needEngine = props.thrust.forward <= 0 && !spareInReach(state, station, isEngineKey);
  if (!needLaser && !needEngine) return [];
  // "Switch to a ship in the hangar": a flyable ship of the player's own stands here
  if (flyableStoredHere(state, station)) return [];
  const worth = reachableWorth(state, station);
  const offer: PartKey[] = [];
  if (needLaser && worth < priceHere(LOAN_LASER_KEY, station)) offer.push(LOAN_LASER_KEY);
  if (needEngine && worth < priceHere(LOAN_ENGINE_KEY, station)) offer.push(LOAN_ENGINE_KEY);
  return offer;
}

/** Free cells next to the hull (also used by the training loans, sim/training). */
export function freeNeighbours(grid: ShipGrid): { x: number; y: number }[] {
  const cells = grid.parts.flatMap((p) => partCells(p));
  const occupied = new Set(cells.map((c) => `${c.x},${c.y}`));
  const out = new Map<string, { x: number; y: number }>();
  for (const cell of cells) {
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const c = { x: cell.x + dx, y: cell.y + dy };
      const k = `${c.x},${c.y}`;
      if (!occupied.has(k)) out.set(k, c);
    }
  }
  return [...out.values()];
}

/**
 * Mounts a loan part (facing forward) where it works: a laser at the bow, an engine at the stern,
 * preferably without covering any exhaust or laser. Null when it fits nowhere.
 */
export function mountLoan(grid: ShipGrid, key: PartKey): ShipGrid | null {
  const engine = isEngineKey(key);
  const cells = freeNeighbours(grid).sort((a, b) => (engine ? a.x - b.x : b.x - a.x) || Math.abs(a.y) - Math.abs(b.y) || a.y - b.y);
  const blockedBefore = blockedOutputs(grid).length;
  let fallback: ShipGrid | null = null;
  for (const c of cells) {
    const r = applyEditorOp(grid, { op: 'place', key, x: c.x, y: c.y, rot: 0 });
    if (!r.ok) continue;
    const placed: ShipGrid = { nextId: r.grid.nextId, parts: r.grid.parts.map((p) => (p.id === grid.nextId ? { ...p, loan: true as const } : p)) };
    const props = computeProperties(placed);
    if (engine ? props.thrust.forward <= 0 : props.lasers.length === 0) continue;
    // the loan respects the hull budget (M18): a hull over it could not be changed in the shipyard
    if (hullBudgetOf(placed).over) continue;
    if (blockedOutputs(placed).length <= blockedBefore) return placed;
    fallback ??= placed;
  }
  return fallback;
}

/** Called every step: the Guild lends the missing part(s) while the ship is docked at a shipyard. */
export function stepGuildLoan(state: SimState, events: SimEvent[], station: (id: StationId) => StationDef | null): void {
  const { player } = state;
  if (player.dock.mode !== 'docked' || player.destroyed) return;
  const at = station(player.dock.stationId);
  if (!at) return;
  const offer = guildLoanOffer(state, at);
  if (offer.length === 0) return;
  let grid = player.grid;
  const lent: PartInventory = {};
  for (const key of offer) {
    const next = mountLoan(grid, key);
    if (!next) continue;
    grid = next;
    lent[key] = (lent[key] ?? 0) + 1;
  }
  if (grid === player.grid) return;
  const oldCoM = player.props.centerOfMass;
  const props = computeProperties(grid);
  player.grid = grid;
  player.gridVersion++;
  player.props = props;
  player.fuel = Math.min(player.fuel, props.fuelCapacity);
  player.energy = props.batteryCapacity;
  player.shield = props.shield.capacity;
  player.body = rebuiltDockPose(at, player.body, oldCoM, props.centerOfMass, props.boundingRadius);
  player.prevBody = player.body;
  state.stats.lastEmergencyKit = state.tick;
  events.push({ type: 'guildLoan', stationId: at.id, parts: lent });
}
