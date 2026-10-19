// On-board workshop (M4c): refineries turn ice into fuel or
// raw ore into refined ore, repair modules heal an edge neighbour from the cargo. In flight only.
//
// Energy: the workshop is the lowest-priority consumer. It runs after lasers, cannons, tractor and shields
// took theirs and only spends what is above `WORKSHOP_MIN_BATTERY` of the battery – repair modules first
// (in part-id order), refineries from what is left, so the refineries stop first. When less than a full
// step's energy is left the parts run at that share of their rate (no on/off flicker at the threshold,
// and no hidden state: the behaviour depends only on the saved state).
//
// Repair material: the station repair formula (`repairCost` with the part's `hpMultOf`: Fe for T1 parts,
// Ti for T2 parts) per HP, from the ship's cargo only, drawn one whole unit at a time into the saved HP
// bank `player.repair` (no credits). The bank belongs to one part; when a module needs it for another
// part of the same material it is converted at the two parts' rates (lossless). Switching to a part of
// the other material never burns the bank (saboteur B1): a module whose weakest neighbour changed
// material keeps repairing the bank's part from the bank alone (no new unit) until it is empty, and a
// module of the other material waits while any module repairs with the bank's material. Only the
// remainder (< 1 unit) of a part that reached full HP is dropped when a part of the other material
// takes the bank over – the same whole-unit rounding as the station repair.
import { FUEL_PER_ICE, RECIPES, repairMaterial, REPAIR_MATERIAL_FACTOR, saleValue } from '../../data/economy';
import { partDef, partKey, type RefinerySpec, type RepairSpec } from '../../data/parts';
import { RESOURCE_IDS, type Cargo, type ResourceId } from '../../data/resources';
import { DEMAND_BONUS } from '../../data/sector';
import { REFINED_BONUS, REFINED_CEILING, WORKSHOP_MIN_BATTERY } from '../../data/workshop';
import type { PlayerShip, SimEvent, SimState } from '../Simulation';
import { partCells } from './grid';
import { currentHp, maxHp } from './hp';
import { hpMultOf } from './shape';
import type { PlacedPart, ShipGrid } from './types';

/** Why the refineries / the repair modules do nothing (the `workshopIdle` event and the HUD lamps). */
export type WorkshopIdleReason = 'energy' | 'material' | 'nothing';

/**
 * What the workshop does this step (transient, never saved – rebuilt by `stepWorkshop`): read by the
 * renderer (crusher spin, repair arm) and the HUD lamps. The object is replaced only when it changes.
 */
export interface WorkshopActivity {
  /** What the refineries do: top up fuel from ice, refine ore, or nothing. */
  refining: 'fuel' | 'ore' | null;
  /** Repair modules at work: module part id → target part id (in module id order). */
  repairing: { module: number; target: number }[];
  /**
   * Why the ship's refineries do nothing this step (set only while flying with a refinery that does
   * nothing): 'energy' = the battery is at the workshop floor, 'material' = the fuel is low but there is
   * no ice (and no ore to refine), 'nothing' = the tank is topped up and all ore is refined.
   */
  refineryIdle?: WorkshopIdleReason;
  /**
   * Why no repair module works this step (set only while flying with a repair module and none working):
   * 'energy', 'material' (a damaged neighbour but no Fe / Ti in the cargo), 'nothing' (no damaged neighbour).
   */
  repairIdle?: WorkshopIdleReason;
}

export const idleWorkshop = (): WorkshopActivity => ({ refining: null, repairing: [] });

/**
 * The repair material bank (saved): HP already paid for with whole units of material for `part`, so no
 * fraction is lost or gained across save/load. Its worth is below one unit of the part's material
 * (`bank × repairMaterialPerHp(part).perHp < 1`, up to rounding); null = empty.
 */
export interface RepairBank {
  part: number;
  bank: number;
}

export interface RefineryMount {
  partId: number;
  spec: RefinerySpec;
}

export interface RepairMount {
  partId: number;
  spec: RepairSpec;
  /** Ids of the parts sharing an edge with the module (sorted; the module itself never). */
  neighbours: number[];
}

export interface WorkshopMounts {
  /** In part-id order. */
  refineries: RefineryMount[];
  /** In part-id order. */
  repairs: RepairMount[];
}

const EDGES = [[1, 0], [-1, 0], [0, 1], [0, -1]] as const;

/** Refineries and repair modules of a grid; repair neighbours are per cell (shapes do not change them). */
export function workshopMounts(grid: ShipGrid): WorkshopMounts {
  const cells = new Map<string, number>();
  for (const p of grid.parts) for (const c of partCells(p)) cells.set(`${c.x},${c.y}`, p.id);
  const out: WorkshopMounts = { refineries: [], repairs: [] };
  for (const p of [...grid.parts].sort((a, b) => a.id - b.id)) {
    const def = partDef(p.partId, p.tier, p.variant);
    if (def.refinery) out.refineries.push({ partId: p.id, spec: def.refinery });
    if (def.repair) {
      const near = new Set<number>();
      for (const c of partCells(p)) {
        for (const [dx, dy] of EDGES) {
          const id = cells.get(`${c.x + dx},${c.y + dy}`);
          if (id !== undefined && id !== p.id) near.add(id);
        }
      }
      out.repairs.push({ partId: p.id, spec: def.repair, neighbours: [...near].sort((a, b) => a - b) });
    }
  }
  return out;
}

const mountCache = new WeakMap<ShipGrid, { version: number; mounts: WorkshopMounts }>();

/** `workshopMounts` of the player's ship, recomputed only when the grid (or its version) changes. */
export function playerMounts(player: Pick<PlayerShip, 'grid' | 'gridVersion'>): WorkshopMounts {
  const hit = mountCache.get(player.grid);
  if (hit && hit.version === player.gridVersion) return hit.mounts;
  const mounts = workshopMounts(player.grid);
  mountCache.set(player.grid, { version: player.gridVersion, mounts });
  return mounts;
}

/**
 * Repair material of a part and its amount per HP: exactly the station repair (`repairCost(key, hp, max,
 * ring, hpMultOf(p))` without its rounding up) – Fe for T1 parts, Ti for T2 parts,
 * `REPAIR_MATERIAL_FACTOR × recipe amount × hpMult / maxHp`. 0 per HP = the recipe has none: free.
 */
export function repairMaterialPerHp(p: PlacedPart): { material: ResourceId; perHp: number } {
  const key = partKey(p.partId, p.tier, p.variant);
  const material = repairMaterial(key);
  const amount = RECIPES[key]?.resources[material] ?? 0;
  return { material, perHp: (hpMultOf(p) * REPAIR_MATERIAL_FACTOR * amount) / maxHp(p) };
}

/** Fixed refining order of the ore (the most valuable first); ice is never refined. */
export const REFINE_ORDER: readonly ResourceId[] = ['titanium', 'copper', 'iron'];

const EPS = 1e-9;
/** The refineries top up the tank from ice while the fuel is more than this below full (plan §2.4). */
const FUEL_TOP_UP_GAP = 1;
/** After this many steps of work in a row an idle reason is reported again even if it is the same as before. */
const IDLE_REARM_STEPS = 60;

const isFlying = (state: SimState): boolean =>
  state.player.dock.mode === 'flying' && !state.player.destroyed && state.sites.berth === null;

/** Edge memory of the `workshopIdle` events (transient: it shapes events only, never the state). */
interface IdleEdge {
  seen: boolean;
  last: WorkshopIdleReason | null;
  work: number;
}
const freshEdge = (): IdleEdge => ({ seen: false, last: null, work: 0 });
function resetEdge(memo: IdleEdge): void {
  memo.seen = false;
  memo.last = null;
  memo.work = 0;
}
const edgeMemo = new WeakMap<SimState, { refinery: IdleEdge; repair: IdleEdge }>();

/**
 * Reports `workshopIdle` when the workshop stops (or stops for another reason). The first status after
 * undocking or a load is adopted silently, and a reason that flickers with short bursts of work (the
 * battery at the floor, ore trickling in from the laser) is reported once until the parts have worked
 * for `IDLE_REARM_STEPS` steps in a row. `now` null = no such part or not flying.
 */
function edge(memo: IdleEdge, what: 'refinery' | 'repair', now: 'working' | WorkshopIdleReason | null, events: SimEvent[]): void {
  if (now === null) {
    resetEdge(memo);
    return;
  }
  if (now === 'working') {
    memo.seen = true;
    if (++memo.work >= IDLE_REARM_STEPS) memo.last = null;
    return;
  }
  memo.work = 0;
  if (memo.seen && memo.last !== now) events.push({ type: 'workshopIdle', what, reason: now });
  memo.seen = true;
  memo.last = now;
}

/** Share (0..1) of a full step's work the energy above the floor allows for a part needing `need`. */
function share(left: number, need: number): number {
  if (need <= 0) return 1;
  return left <= EPS ? 0 : Math.min(1, left / need);
}

/**
 * HP the material bank can pay for `target` (≤ `need`), drawing whole units of its material from the
 * cargo into the bank – none when `drain` (the module only empties the bank before re-targeting).
 * `busy` = the materials some repair module repairs with this step.
 */
function fund(player: PlayerShip, target: PlacedPart, need: number, busy: ReadonlySet<ResourceId>, drain: boolean): number {
  const { material, perHp } = repairMaterialPerHp(target);
  if (perHp <= 0) return need;
  let hp = 0;
  const bank = player.repair;
  if (bank && bank.part === target.id) hp = bank.bank;
  else if (bank) {
    const old = player.grid.parts.find((p) => p.id === bank.part);
    const was = old ? repairMaterialPerHp(old) : null;
    if (was && was.material === material && was.perHp > 0) hp = (bank.bank * was.perHp) / perHp;
    // the other material's bank is still in use (its part or a part of its material): wait for it
    else if (was && busy.has(was.material)) return 0;
  }
  const cargo = player.cargo;
  while (!drain && hp < need - EPS && cargo[material] >= 1 - EPS) {
    const rest = cargo[material] - 1;
    cargo[material] = rest < EPS ? 0 : rest;
    hp += 1 / perHp;
  }
  // the bank now belongs to the target (an unused other-material bank is dropped here)
  player.repair = hp > EPS ? { part: target.id, bank: hp } : null;
  return Math.min(need, hp);
}

/** Spends `hp` of the target's bank (after `fund`). */
function spend(player: PlayerShip, target: PlacedPart, hp: number): void {
  if (!player.repair || player.repair.part !== target.id) return;
  const left = player.repair.bank - hp;
  player.repair = left > EPS ? { part: target.id, bank: left } : null;
}

interface RepairTarget {
  part: PlacedPart;
  /** Repair from the bank only: the bank's part is kept until its bank is spent (hysteresis, saboteur B1). */
  drain: boolean;
}

/**
 * The damaged edge neighbour with the lowest HP fraction (ties by part id), or null – except while the
 * bank belongs to a damaged neighbour of the other material: then that part, from its bank only, so a
 * change of material never drops HP already paid for.
 */
function repairTarget(player: PlayerShip, m: RepairMount, byId: ReadonlyMap<number, PlacedPart>): RepairTarget | null {
  let best: PlacedPart | null = null;
  let bestFraction = 1 - EPS;
  for (const id of m.neighbours) {
    // a destroyed part is no longer in the grid
    const p = byId.get(id);
    if (!p) continue;
    const fraction = currentHp(player.hp, p) / maxHp(p);
    if (fraction < bestFraction) {
      best = p;
      bestFraction = fraction;
    }
  }
  if (!best) return null;
  const bank = player.repair;
  if (bank && bank.part !== best.id && m.neighbours.includes(bank.part)) {
    const held = byId.get(bank.part);
    if (held && currentHp(player.hp, held) < maxHp(held) - EPS && repairMaterialPerHp(held).material !== repairMaterialPerHp(best).material) {
      return { part: held, drain: true };
    }
  }
  return { part: best, drain: false };
}

const sameActivity = (a: WorkshopActivity, b: WorkshopActivity): boolean =>
  a.refining === b.refining &&
  a.refineryIdle === b.refineryIdle &&
  a.repairIdle === b.repairIdle &&
  a.repairing.length === b.repairing.length &&
  a.repairing.every((r, i) => r.module === b.repairing[i]!.module && r.target === b.repairing[i]!.target);

const NO_MOUNTS: WorkshopMounts = { refineries: [], repairs: [] };

/**
 * One workshop step of the player's ship (called every step after combat, so lasers, cannons, tractor
 * and shields took their energy first). Does nothing unless the ship is flying (not docked, docking,
 * berthed or destroyed).
 */
export function stepWorkshop(state: SimState, events: SimEvent[], dt: number): void {
  const { player } = state;
  let memo = edgeMemo.get(state);
  if (!memo) edgeMemo.set(state, (memo = { refinery: freshEdge(), repair: freshEdge() }));
  // a bank whose part is gone (destroyed, removed in the shipyard, another ship) is worth nothing
  const bank = player.repair;
  if (bank && !player.grid.parts.some((p) => p.id === bank.part)) player.repair = null;

  const mounts = isFlying(state) ? playerMounts(player) : NO_MOUNTS;
  if (mounts.repairs.length === 0 && mounts.refineries.length === 0) {
    // no workshop at work (most ships, docked, berthed, destroyed): no allocation per step
    resetEdge(memo.repair);
    resetEdge(memo.refinery);
    const w = player.workshop;
    if (w.refining !== null || w.repairing.length > 0 || w.refineryIdle !== undefined || w.repairIdle !== undefined) player.workshop = idleWorkshop();
    return;
  }
  const next = idleWorkshop();
  const floor = WORKSHOP_MIN_BATTERY * player.props.batteryCapacity;
  const spendEnergy = (e: number): void => {
    player.energy -= e;
  };

  // --- repair modules: each heals its weakest damaged edge neighbour
  if (mounts.repairs.length > 0) {
    const byId = new Map(player.grid.parts.map((p) => [p.id, p]));
    const targets = mounts.repairs.map((m) => repairTarget(player, m, byId));
    const busy = new Set<ResourceId>();
    for (const t of targets) {
      if (!t) continue;
      const { material, perHp } = repairMaterialPerHp(t.part);
      if (perHp > 0) busy.add(material);
    }
    let lackEnergy = false;
    let lackMaterial = false;
    for (const [i, m] of mounts.repairs.entries()) {
      const picked = targets[i];
      if (!picked) continue;
      const target = picked.part;
      const fullHp = m.spec.hpPerSecond * dt;
      const fullEnergy = m.spec.energyPerSecond * dt;
      const k = share(player.energy - floor, fullEnergy);
      if (k <= 0) {
        lackEnergy = true;
        continue;
      }
      const before = currentHp(player.hp, target);
      const hp = fund(player, target, Math.min(fullHp * k, maxHp(target) - before), busy, picked.drain);
      if (hp <= EPS) {
        lackMaterial = true;
        continue;
      }
      spend(player, target, hp);
      spendEnergy((fullEnergy * hp) / fullHp);
      if (before + hp >= maxHp(target) - EPS) {
        player.hp.delete(target.id);
        events.push({ type: 'partRepaired', partId: target.id });
      } else {
        player.hp.set(target.id, before + hp);
      }
      next.repairing.push({ module: m.partId, target: target.id });
    }
    if (next.repairing.length === 0) next.repairIdle = lackEnergy ? 'energy' : lackMaterial ? 'material' : 'nothing';
  }

  // --- refineries: ice → fuel while the tank is low, else raw ore → refined ore (Ti → Cu → Fe)
  if (mounts.refineries.length > 0) {
    const { cargo, refined } = player;
    const capacity = player.props.fuelCapacity;
    const unrefined = (r: ResourceId): number => Math.max(0, cargo[r] - refined[r]);
    const fuelLow = player.fuel < capacity - FUEL_TOP_UP_GAP;
    const mode = fuelLow && cargo.ice > EPS ? 'fuel' : REFINE_ORDER.some((r) => unrefined(r) > EPS) ? 'ore' : null;
    let lackEnergy = false;
    if (mode !== null) {
      for (const m of mounts.refineries) {
        const full = (mode === 'fuel' ? m.spec.icePerSecond : m.spec.orePerSecond) * dt;
        const fullEnergy = m.spec.energyPerSecond * dt;
        const k = share(player.energy - floor, fullEnergy);
        if (k <= 0) {
          lackEnergy = true;
          continue;
        }
        let done = 0;
        if (mode === 'fuel') {
          const ice = Math.min(full * k, cargo.ice, (capacity - player.fuel) / FUEL_PER_ICE);
          if (ice > EPS) {
            const rest = cargo.ice - ice;
            cargo.ice = rest < EPS ? 0 : rest;
            player.fuel = Math.min(capacity, player.fuel + ice * FUEL_PER_ICE);
            done = ice;
          }
        } else {
          for (const r of REFINE_ORDER) {
            const amount = Math.min(full * k - done, unrefined(r));
            if (amount <= EPS) continue;
            refined[r] += amount;
            done += amount;
          }
        }
        if (done <= EPS) continue;
        spendEnergy((fullEnergy * done) / full);
        next.refining = mode;
      }
    }
    if (next.refining === null) next.refineryIdle = lackEnergy ? 'energy' : mode === null && fuelLow ? 'material' : 'nothing';
  }

  edge(memo.repair, 'repair', mounts.repairs.length === 0 ? null : next.repairing.length > 0 ? 'working' : next.repairIdle!, events);
  edge(memo.refinery, 'refinery', mounts.refineries.length === 0 ? null : next.refining !== null ? 'working' : next.refineryIdle!, events);
  if (!sameActivity(player.workshop, next)) player.workshop = next;
}

/**
 * Keeps the refined sub-account inside the cargo (`refined[r] ≤ cargo[r]`, never refined ice). Runs
 * after every command and at the end of every step, so any outflow of the cargo takes raw units first.
 */
export function clampRefined(cargo: Cargo, refined: Cargo): void {
  for (const r of RESOURCE_IDS) {
    const max = r === 'ice' ? 0 : Math.max(0, cargo[r]);
    if (refined[r] > max) refined[r] = max;
    else if (refined[r] < 0) refined[r] = 0;
  }
}

/**
 * Price of one refined unit of `resource` where the raw ore sells for `unitSell`: `unitSell × (1 +
 * REFINED_BONUS)`, capped by the W1 ceiling `REFINED_CEILING` (a refined unit never sells above the cheapest
 * buy price of its resource anywhere – M4d plan §2.6), never below the raw price. Ice is never refined.
 */
export function refinedUnit(resource: ResourceId, unitSell: number): number {
  if (resource === 'ice') return unitSell;
  return Math.max(unitSell, Math.min(unitSell * (1 + REFINED_BONUS), REFINED_CEILING[resource]));
}

/** The refined bonus actually paid where the raw ore sells for `unitSell` (0.15 unless the ceiling bites). */
export const refinedBonusAt = (resource: ResourceId, unitSell: number): number => (unitSell > 0 ? refinedUnit(resource, unitSell) / unitSell - 1 : 0);

/**
 * Credits for selling `qty` units of `resource` from the ship of which `refined` are refined: refined units
 * go first at `refinedUnit(resource, unitSell)`, the rest at `unitSell`; rounded down once like `saleValue`.
 */
export function refinedSaleValue(resource: ResourceId, qty: number, refined: number, unitSell: number): number {
  const fine = Math.min(Math.max(0, refined), qty);
  return Math.max(0, Math.floor(fine * refinedUnit(resource, unitSell) + (qty - fine) * unitSell + 1e-9));
}

/**
 * A sale from the ship with `demand` units inside the sector demand (`demandSale`, `1 + DEMAND_BONUS`) and
 * `refined` refined units: the two bonuses never stack (0.8 × 1.45 = 1.16 × base < the 1.25 × base buy
 * price) – the demand units sell at the demand price, the refined units fill the rest of the sale first.
 * Without refined units this equals `demandSale`'s value. The refined units take the W1 ceiling
 * (`refinedUnit`); the demand price is not capped. The trade UI and convoys quote through this.
 */
export function shipSaleValue(resource: ResourceId, qty: number, refined: number, demand: number, unitSell: number): number {
  const d = Math.min(Math.max(0, demand), qty);
  if (d <= 0) return refinedSaleValue(resource, qty, refined, unitSell);
  return saleValue(d, unitSell * (1 + DEMAND_BONUS)) + refinedSaleValue(resource, qty - d, refined, unitSell);
}
