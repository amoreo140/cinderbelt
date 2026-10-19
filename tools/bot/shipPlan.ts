// Ship refits for the balance bot: turns a goal (target composition) into editor operations through the
// shipyard draft API (createDraft → applyStroke → draftOps / draftBaseHash) and evaluates them with
// the same evaluateDesign the game uses, so the commit is checked exactly like in the shipyard.
import { partDef, partKey, type PartId, type PartKey } from '../../src/data/parts';
import type { SimState } from '../../src/sim/Simulation';
import { hullBudgetOf, hullPoints, sizeHullPoints } from '../../src/sim/ship/budget';
import { facing, partCells } from '../../src/sim/ship/grid';
import { computeProperties } from '../../src/sim/ship/properties';
import type { PlacedPart, Rotation, ShipGrid } from '../../src/sim/ship/types';
import { draftBaseHash } from '../../src/sim/shipyard/commit';
import { evaluateDesign, shipyardContext, type DesignReport } from '../../src/sim/shipyard/design';
import { applyStroke, createDraft, draftOps, type ShipyardDraft } from '../../src/sim/shipyard/draft';
import { applyEditorOp, HANGAR_MAX, HANGAR_MIN, type EditorOp } from '../../src/sim/shipyard/editor';
import { stationStorage } from '../../src/sim/station/storage';
import type { StationDef } from '../../src/sim/world/stations';
import { BOT_GOALS, type BotGoal, type PartRequirement } from './goals';
import type { BotOptions } from './pilot';

/**
 * The refiner persona's workshop (M4c plan T13): a T1 refinery and a T1 repair module (with the reactor of the
 * M3 weapons package) in place of the two cannons and the shield – the same 4 hull points, so its mining
 * capacity stays the standard bot's and the P2 income difference is the workshop's. The two Archive nodes
 * (Mining 2 / Construction 2) need a level-1 node of their branch first (Battery, Large cargo hold).
 */
export const REFINER_WORKSHOP: BotGoal = {
  id: 'workshop',
  label: 'Refinery + repair module + reactor T1 (refiner persona, in place of the M3 weapons)',
  reqs: [
    { part: 'reactor', tier: 1, count: 3 },
    // the repair module first: it takes the free cell beside a bow laser before the refinery does
    { part: 'repairModule', tier: 1, count: 1 },
    { part: 'refinery', tier: 1, count: 1 },
  ],
  archive: ['battery', 'refinery', 'largeCargo', 'repairModule'],
  botOnly: true,
};

/** The goal list of a persona: the econ model's main path; the refiner swaps the M3 weapons for the workshop. */
export function personaGoals(persona: BotOptions['persona']): readonly BotGoal[] {
  if (persona !== 'refiner') return BOT_GOALS;
  return BOT_GOALS.map((g) => (g.id === 'weapons' ? REFINER_WORKSHOP : g));
}

const cellKey = (x: number, y: number): string => `${x},${y}`;

function occupancy(grid: ShipGrid): Map<string, number> {
  const owner = new Map<string, number>();
  for (const p of grid.parts) for (const c of partCells(p)) owner.set(cellKey(c.x, c.y), p.id);
  return owner;
}

/** Engines and lasers whose output cell is covered (same rule as the shipyard warnings). */
export function blockedCount(grid: ShipGrid): number {
  const owner = occupancy(grid);
  let n = 0;
  for (const p of grid.parts) {
    const isEngine = p.partId === 'engine';
    if (!isEngine && !partDef(p.partId, p.tier, p.variant).mining) continue;
    const f = facing(p.rot);
    const dir = isEngine ? { x: -f.x, y: -f.y } : f;
    if (partCells(p).some((c) => { const o = owner.get(cellKey(c.x + dir.x, c.y + dir.y)); return o !== undefined && o !== p.id; })) n++;
  }
  return n;
}

/** Cells in front of a mining laser (its firing lane) – the bot keeps them free. */
function laserLanes(grid: ShipGrid): Set<string> {
  const lanes = new Set<string>();
  for (const p of grid.parts) {
    if (!partDef(p.partId, p.tier, p.variant).mining) continue;
    const f = facing(p.rot);
    for (let k = 1; k <= 3; k++) lanes.add(cellKey(p.x + f.x * k, p.y + f.y * k));
  }
  return lanes;
}

/** Cells behind an engine (its exhaust lane). */
function exhaustLanes(grid: ShipGrid): Set<string> {
  const lanes = new Set<string>();
  for (const p of grid.parts) {
    if (p.partId !== 'engine') continue;
    const f = facing(p.rot);
    for (let k = 1; k <= 2; k++) lanes.add(cellKey(p.x - f.x * k, p.y - f.y * k));
  }
  return lanes;
}

/**
 * Does the part `added` (already in `grid`) touch another part? The shipyard places freely (Shipyard 2.0),
 * so the bot itself keeps new parts attached – a loose part would fail the `disconnected` check.
 */
function attached(grid: ShipGrid, added: PlacedPart, owner: Map<string, number>): boolean {
  if (grid.parts.length === 1) return true;
  return partCells(added).some((c) =>
    [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => {
      const o = owner.get(cellKey(c.x + dx!, c.y + dy!));
      return o !== undefined && o !== added.id;
    }),
  );
}

/** Best free spot for a new part (touching the ship); null when nothing fits. */
export function findPlacement(grid: ShipGrid, key: PartKey, part: PartId, rot: Rotation): { op: EditorOp; grid: ShipGrid } | null {
  const com = computeProperties(grid).centerOfMass;
  const blocked0 = blockedCount(grid);
  const lanes = laserLanes(grid);
  const exhaust = exhaustLanes(grid);
  const owner = occupancy(grid);
  let best: { op: EditorOp; grid: ShipGrid; score: number } | null = null;
  for (let x = HANGAR_MIN; x <= HANGAR_MAX; x++) {
    for (let y = HANGAR_MIN; y <= HANGAR_MAX; y++) {
      const op: EditorOp = { op: 'place', key, x, y, rot };
      const r = applyEditorOp(grid, op);
      if (!r.ok || !attached(r.grid, r.grid.parts.at(-1)!, owner)) continue;
      if (blockedCount(r.grid) > blocked0) continue;
      const k = cellKey(x, y);
      let score = Math.hypot(x - com.x, y - com.y);
      if (part === 'miningLaser' || part === 'heavyLaser') {
        // lasers at the bow, close to the centre line
        score = -3 * x + 0.8 * Math.abs(y - com.y);
      } else if (part === 'engine' && rot === 0) {
        // forward-thrust engines at the stern
        score = 3 * x + 0.8 * Math.abs(y - com.y);
      } else if (part === 'repairModule') {
        // beside the mining lasers: the bow takes the ram damage, and the module heals its edge neighbours
        const beside = [[1, 0], [-1, 0], [0, 1], [0, -1]].filter(([dx, dy]) => {
          const o = owner.get(cellKey(x + dx!, y + dy!));
          const n = o === undefined ? undefined : grid.parts.find((q) => q.id === o);
          return !!n && !!partDef(n.partId, n.tier, n.variant).mining;
        }).length;
        score = -6 * beside + 0.5 * Math.hypot(x - com.x, y - com.y) + (lanes.has(k) ? 6 : 0);
      } else if (lanes.has(k)) {
        score += 6;
      }
      if (exhaust.has(k)) score += 6;
      if (!best || score < best.score - 1e-9) best = { op, grid: r.grid, score };
    }
  }
  return best ? { op: best.op, grid: best.grid } : null;
}

const atLeast = (p: PlacedPart, req: PartRequirement): boolean => p.partId === req.part && p.tier >= req.tier;

/** Does the ship already satisfy all non-optional requirements of the goal? */
export function goalSatisfied(grid: ShipGrid, goal: BotGoal): boolean {
  return goal.reqs.every((r) => r.optional || grid.parts.filter((p) => atLeast(p, r)).length >= r.count);
}

/**
 * Editor operations for a goal on top of `grid`: upgrades in place first (remove + place the higher
 * tier on the same cells), then new parts at the best free spots, within the hull budget.
 */
export function planGoalOps(grid: ShipGrid, goal: BotGoal): { ops: EditorOp[]; grid: ShipGrid; skipped: string[] } {
  let g = grid;
  const ops: EditorOp[] = [];
  const skipped: string[] = [];
  const apply = (op: EditorOp): boolean => {
    const r = applyEditorOp(g, op);
    if (!r.ok) return false;
    g = r.grid;
    ops.push(op);
    return true;
  };
  for (const req of goal.reqs) {
    const key = partKey(req.part, req.tier);
    let have = g.parts.filter((p) => atLeast(p, req)).length;
    // upgrades in place (lowest tier first, stable by id)
    const lower = g.parts.filter((p) => p.partId === req.part && p.tier < req.tier).sort((a, b) => a.tier - b.tier || a.id - b.id);
    for (const p of lower) {
      if (have >= req.count) break;
      const saved = { g, n: ops.length };
      if (apply({ op: 'remove', id: p.id }) && apply({ op: 'place', key, x: p.x, y: p.y, rot: p.rot })) have++;
      else {
        g = saved.g;
        ops.length = saved.n;
      }
    }
    // new parts
    const points = sizeHullPoints(partDef(req.part, req.tier).size);
    while (have < req.count) {
      const budget = hullBudgetOf(g).budget ?? 0;
      if (hullPoints(g) + points > budget) {
        skipped.push(`${goal.id}: ${key} x${req.count - have} (hull budget ${hullPoints(g)}/${budget})`);
        break;
      }
      const spot = findPlacement(g, key, req.part, req.rot ?? 0);
      if (!spot) {
        skipped.push(`${goal.id}: ${key} x${req.count - have} (no free cell)`);
        break;
      }
      g = spot.grid;
      ops.push(spot.op);
      have++;
    }
  }
  return { ops, grid: g, skipped };
}

/** Shipyard draft of the editor ops on the docked ship + the design report (exactly what the shipyard shows). */
export interface DraftPlan {
  draft: ShipyardDraft;
  ops: EditorOp[];
  baseHash: string;
  report: DesignReport;
}

export function planFromOps(state: SimState, station: StationDef, ops: readonly EditorOp[]): DraftPlan {
  const inventory = stationStorage(state, station.id).parts;
  const base = createDraft(station.id, state.player.grid, state.player.hp, inventory);
  const draft = applyStroke(base, ops).draft;
  const report = evaluateDesign({ base: draft.base, grid: draft.grid, acquire: draft.acquire }, shipyardContext(state, station));
  return { draft, ops: draftOps(draft), baseHash: draftBaseHash(draft), report };
}

/**
 * Parts of the last committed design that the ship lost in flight (pirates, ramming), placed back on
 * their old cells. Several passes, because a part may only touch the ship through another lost part.
 */
export function restoreOps(grid: ShipGrid, design: ShipGrid): EditorOp[] {
  const have = new Set(grid.parts.map((p) => p.id));
  let missing = design.parts.filter((p) => !have.has(p.id));
  const ops: EditorOp[] = [];
  let g = grid;
  while (missing.length) {
    const rest: PlacedPart[] = [];
    for (const p of missing) {
      const op: EditorOp = { op: 'place', key: partKey(p.partId, p.tier, p.variant), x: p.x, y: p.y, rot: p.rot };
      const r = applyEditorOp(g, op);
      if (r.ok) {
        g = r.grid;
        ops.push(op);
      } else rest.push(p);
    }
    if (rest.length === missing.length) break;
    missing = rest;
  }
  return ops;
}

/** The ship cannot earn: no forward thrust or no mining laser. */
export const crippled = (grid: ShipGrid): boolean => {
  const props = computeProperties(grid);
  return props.thrust.forward <= 0 || props.lasers.length === 0;
};

/**
 * Parts a broke pilot can strip and sell, outermost first: weapons, shields, armour and radar, then
 * (deep) all but one cargo hold, fuel tank and reactor.
 */
export function stripOps(grid: ShipGrid, deep = false): EditorOp[] {
  const strip = new Set<PartId>(['cannon', 'shield', 'armor', 'radar']);
  const com = computeProperties(grid).centerOfMass;
  const keepOne = new Set<PartId>(deep ? ['cargo', 'fuelTank', 'reactor'] : []);
  const kept = new Set<PartId>();
  const byDist = [...grid.parts].sort((a, b) => Math.hypot(a.x - com.x, a.y - com.y) - Math.hypot(b.x - com.x, b.y - com.y));
  const extra = new Set<number>();
  for (const p of byDist) {
    if (!keepOne.has(p.partId)) continue;
    if (kept.has(p.partId)) extra.add(p.id);
    else kept.add(p.partId);
  }
  return grid.parts
    .filter((p) => strip.has(p.partId) || extra.has(p.id))
    .sort((a, b) => Math.hypot(b.x - com.x, b.y - com.y) - Math.hypot(a.x - com.x, a.y - com.y))
    .map((p) => ({ op: 'remove', id: p.id }) as EditorOp);
}
