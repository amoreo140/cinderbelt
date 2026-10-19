// Combat view model for the HUD (M3a): shield, hull, the ship silhouette with HP per cell, hits with
// the direction to the attacker, threat, loot in wrecks and the death sequence. Pure functions and
// small classes over the simulation state – the UI (Preact) only draws them, texts come from i18n.
import type { PartId, PartInventory, Tier } from '../data/parts';
import { cargoUsed, RESOURCE_IDS, type Cargo } from '../data/resources';
import { lootEmpty, SALVAGE_RANGE, wreckGap } from '../sim/combat/wrecks';
import type { WreckLoot } from '../sim/combat/types';
import { salvageAt } from '../sim/salvage/salvage';
import { isHulk } from '../sim/salvage/dismantle';
import { CONTAINER_RADIUS } from '../data/salvage';
import { length, sub } from '../sim/math/vec2';
import { planDeath } from '../sim/death/death';
import type { DeathPenalty } from '../sim/settings';
import { partCells, partCenter } from '../sim/ship/grid';
import { currentHp, hullHp, maxHp } from '../sim/ship/hp';
import { missingParts } from '../sim/ship/blueprint';
import { outlineSvgPath } from '../sim/ship/outline';
import { polygonArea, shapePolygon } from '../sim/ship/shape';
import { isShapeId } from '../data/shapes';
import type { Vec2 } from '../sim/math/vec2';
import type { PlacedPart, ShipGrid } from '../sim/ship/types';
import type { SimEvent, SimState, Simulation } from '../sim/Simulation';
import type { StationId } from '../sim/world/stations';
import { TapeMemo } from './viewMemo';

export interface Meter {
  current: number;
  max: number;
  /** current / max (0..1); 0 when max is 0. */
  fraction: number;
}

const meter = (current: number, max: number): Meter => ({ current, max, fraction: max > 0 ? Math.min(1, Math.max(0, current / max)) : 0 });

/** Cell of the ship silhouette (grid coordinates: +x bow, +y port). */
export interface SilhouetteCell {
  x: number;
  y: number;
  partId: PartId;
  tier: Tier;
  /** Part id (the same for all cells of a multi-cell part). */
  part: number;
  /** The part's HP as a share of its max (0..1). */
  fraction: number;
  /** Part the ship lost compared to its blueprint (M3.8) – drawn as an empty outlined cell. */
  missing?: boolean;
  /**
   * Shaped armour (SL2 E2 U3): the part's polygon clipped to this cell, in cell units around the cell
   * centre (−½..½, +x bow, +y port, CCW, render detail like the outline). Absent for a full cell
   * (every unshaped part, the solid rear cell of a nose 2×1); [] = the shape leaves the cell empty.
   */
  poly?: readonly Vec2[];
}

export interface Silhouette {
  cells: SilhouetteCell[];
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  /** Number of damaged parts. */
  damaged: number;
  /** Parts lost compared to the blueprint (M3.8; only the flight silhouette counts them). */
  missing?: number;
  /**
   * Hull outline of the ship's current grid (SL2 E1 T10, `outlineSvgPath`): SVG path in grid units
   * (+x bow, +y port; evenodd, one subpath per loop, armour corners bevelled). Parts shot off are not
   * in it (the HUD draws their sockets outside the lip). '' for an empty grid.
   */
  outline?: string;
}

/** Sutherland–Hodgman clip of a convex polygon to the axis-aligned square [−½, ½]² around (cx, cy). */
function clipToCell(poly: readonly Vec2[], cx: number, cy: number): Vec2[] {
  let out: Vec2[] = poly.map((v) => ({ x: v.x - cx, y: v.y - cy }));
  // each plane as (axis, sign): inside when sign · v[axis] ≤ ½
  const planes: ['x' | 'y', 1 | -1][] = [['x', 1], ['x', -1], ['y', 1], ['y', -1]];
  for (const [axis, sign] of planes) {
    if (out.length === 0) break;
    const input = out;
    out = [];
    const d = (v: Vec2): number => 0.5 - sign * v[axis];
    for (let i = 0; i < input.length; i++) {
      const a = input[i]!;
      const b = input[(i + 1) % input.length]!;
      const da = d(a);
      const db = d(b);
      if (da >= 0) out.push(a);
      if ((da >= 0) !== (db >= 0)) {
        const t = da / (da - db);
        out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
      }
    }
  }
  // snap to a clean grid (no "-0", no 1e-17 noise) and drop repeated vertices
  const snap = (v: number): number => {
    const r = Math.round(v * 1e6) / 1e6;
    return r === 0 ? 0 : r;
  };
  const clean: Vec2[] = [];
  for (const v of out) {
    const p = { x: snap(v.x), y: snap(v.y) };
    const last = clean[clean.length - 1];
    if (!last || last.x !== p.x || last.y !== p.y) clean.push(p);
  }
  while (clean.length > 1 && clean[0]!.x === clean[clean.length - 1]!.x && clean[0]!.y === clean[clean.length - 1]!.y) clean.pop();
  return clean;
}

/** Cell polygons by shape, rotation and the cell's offset from the part centre (null = a full cell). */
const cellPolyCache = new Map<string, readonly Vec2[] | null>();

/** `SilhouetteCell.poly` of one cell of a placed part; null for a full cell (and every unshaped part). */
export function silhouetteCellPoly(p: PlacedPart, cell: Vec2): readonly Vec2[] | null {
  if (p.shape === undefined || !isShapeId(p.shape)) return null;
  const c = partCenter(p);
  const dx = cell.x - c.x;
  const dy = cell.y - c.y;
  const key = `${p.shape}:${p.rot}:${dx}:${dy}`;
  let poly = cellPolyCache.get(key);
  if (poly === undefined) {
    const clip = clipToCell(shapePolygon(p.shape, p.rot, 'render'), dx, dy);
    const a = clip.length >= 3 ? polygonArea(clip) : 0;
    poly = a >= 1 - 1e-6 ? null : Object.freeze(a <= 1e-6 ? [] : clip.map((v) => Object.freeze(v)));
    cellPolyCache.set(key, poly);
  }
  return poly;
}

/** One silhouette cell of a part (the polygon only for shaped cells, so full cells stay as in E1). */
function partCell(p: PlacedPart, c: Vec2, fraction: number, missing: boolean): SilhouetteCell {
  const cell: SilhouetteCell = { x: c.x, y: c.y, partId: p.partId, tier: p.tier, part: p.id, fraction };
  if (missing) cell.missing = true;
  const poly = silhouetteCellPoly(p, c);
  if (poly) cell.poly = poly;
  return cell;
}

/** Recently used outlines by grid shape – the HUD asks every frame, the grid rarely changes. */
const outlineCache = new Map<string, string>();
const OUTLINE_CACHE_SIZE = 32;

/** `outlineSvgPath` of a player grid, memoised by the shape of the grid (not by object identity). */
export function gridOutline(grid: ShipGrid): string {
  let key = '';
  for (const p of grid.parts) key += `${p.partId}:${p.tier}:${p.variant ?? ''}:${p.x}:${p.y}:${p.rot}:${p.shape ?? ''};`;
  const hit = outlineCache.get(key);
  if (hit !== undefined) {
    // most recently used last
    outlineCache.delete(key);
    outlineCache.set(key, hit);
    return hit;
  }
  const path = outlineSvgPath(grid);
  outlineCache.set(key, path);
  if (outlineCache.size > OUTLINE_CACHE_SIZE) outlineCache.delete(outlineCache.keys().next().value!);
  return path;
}

export interface SalvagePrompt {
  /** What F would load (M3.6): a wreck, a container, or a hulk too big to load (cut it first). */
  kind: 'wreck' | 'container' | 'hulk';
  /** Wreck or container id. */
  wreckId: number;
  /** Parts of a hulk (kind 'hulk'). */
  hulkParts?: number;
  /** Gap between the hulls of the ship and the wreck. */
  distance: number;
  /** F reaches it (≤ SALVAGE_RANGE). */
  inRange: boolean;
  cargo: Partial<Cargo>;
  parts: PartInventory;
}

export interface ThreatView {
  /** Pirates around (active in the simulation). */
  nearby: number;
  /** How many of them are attacking. */
  attacking: number;
  /** Nearest attacker: distance and world angle (sim: 0 = +x, counter-clockwise). */
  nearest: { distance: number; angle: number } | null;
}

export interface CombatHudView {
  /** null = the ship has no shield generator. */
  shield: Meter | null;
  hull: Meter;
  silhouette: Silhouette;
  /** Cannons on the ship and how many of them are charged. */
  cannons: { total: number; ready: number };
  threat: ThreatView;
  /** Nearest wreck with loot within 3× the range (the "F – load loot" prompt), or null. */
  salvage: SalvagePrompt | null;
  /** Parts from wrecks on board (they go to storage on docking). */
  salvageHold: PartInventory;
  destroyed: boolean;
}

/** The ship silhouette with the HP of every part. */
export function silhouette(state: Pick<SimState, 'player'>): Silhouette {
  const { grid, hp } = state.player;
  const cells: SilhouetteCell[] = [];
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  let damaged = 0;
  for (const p of grid.parts) {
    const max = maxHp(p);
    const fraction = max > 0 ? currentHp(hp, p) / max : 1;
    if (fraction < 1) damaged++;
    for (const c of partCells(p)) {
      cells.push(partCell(p, c, fraction, false));
      minX = Math.min(minX, c.x);
      maxX = Math.max(maxX, c.x);
      minY = Math.min(minY, c.y);
      maxY = Math.max(maxY, c.y);
    }
  }
  if (cells.length === 0) minX = maxX = minY = maxY = 0;
  return { cells, minX, maxX, minY, maxY, damaged, outline: gridOutline(grid) };
}

/**
 * Flight silhouette (M3.8): the ship plus the parts it lost compared to its blueprint, so the frame
 * keeps the designed shape and the gaps show where parts are missing.
 */
export function flightSilhouette(state: Pick<SimState, 'player'>): Silhouette {
  const { grid, hp, blueprint } = state.player;
  // the same object while the grid, the blueprint and every part's HP stay (the HUD asks 10× per second;
  // the ship status skips its redraw on an identical silhouette)
  return flightMemo.get(
    (push) => {
      push(grid);
      push(grid.parts.length);
      push(blueprint);
      push(hp.size);
      for (const [id, v] of hp) {
        push(id);
        push(v);
      }
    },
    () => buildFlightSilhouette(state),
  );
}

const flightMemo = new TapeMemo<Silhouette>();

function buildFlightSilhouette(state: Pick<SimState, 'player'>): Silhouette {
  const s = silhouette(state);
  const lost = missingParts(state.player.blueprint, state.player.grid);
  if (lost.length === 0) return { ...s, missing: 0 };
  const cells = [...s.cells];
  let { minX, maxX, minY, maxY } = s;
  if (s.cells.length === 0) {
    minX = minY = Infinity;
    maxX = maxY = -Infinity;
  }
  for (const p of lost) {
    for (const c of partCells(p)) {
      cells.push(partCell(p, c, 0, true));
      minX = Math.min(minX, c.x);
      maxX = Math.max(maxX, c.x);
      minY = Math.min(minY, c.y);
      maxY = Math.max(maxY, c.y);
    }
  }
  return { cells, minX, maxX, minY, maxY, damaged: s.damaged, missing: lost.length, outline: s.outline };
}

const lootCargo = (loot: WreckLoot): Partial<Cargo> => {
  const cargo: Partial<Cargo> = {};
  for (const r of RESOURCE_IDS) if (loot.cargo[r] > 1e-9) cargo[r] = loot.cargo[r];
  return cargo;
};

/**
 * F prompt at loot (M3.6): what F loads now (wreck, container, or a hulk to cut), otherwise the
 * nearest loot within 3× the loading range ("fly closer").
 */
export function salvagePrompt(state: SimState): SalvagePrompt | null {
  const { player, combat } = state;
  const pos = player.body.pos;
  const r = player.props.boundingRadius;
  const now = salvageAt(state);
  if (now) {
    if (now.kind === 'container') {
      const c = now.container;
      return { kind: 'container', wreckId: c.id, distance: 0, inRange: true, cargo: lootCargo(c.loot), parts: { ...c.loot.parts } };
    }
    const w = now.wreck;
    // while a joint is being cut the callout shows the progress – no prompt over it
    if (now.kind === 'hulk' && w.cutting) return null;
    return { kind: now.kind, wreckId: w.id, distance: 0, inRange: now.kind === 'wreck', cargo: lootCargo(w.loot), parts: { ...w.loot.parts }, ...(now.kind === 'hulk' ? { hulkParts: w.grid.parts.length } : {}) };
  }
  let best: SalvagePrompt | null = null;
  for (const w of combat.wrecks) {
    // a hulk is announced only in loading range (its callout explains cutting from afar)
    if (lootEmpty(w.loot) || isHulk(w)) continue;
    const gap = Math.max(0, wreckGap(w, pos, r));
    if (gap > SALVAGE_RANGE * 3 || (best && gap >= best.distance)) continue;
    best = { kind: isHulk(w) ? 'hulk' : 'wreck', wreckId: w.id, distance: gap, inRange: false, cargo: lootCargo(w.loot), parts: { ...w.loot.parts }, ...(isHulk(w) ? { hulkParts: w.grid.parts.length } : {}) };
  }
  for (const c of combat.containers) {
    const gap = Math.max(0, length(sub(c.body.pos, pos)) - r - CONTAINER_RADIUS);
    if (gap > SALVAGE_RANGE * 3 || (best && gap >= best.distance)) continue;
    best = { kind: 'container', wreckId: c.id, distance: gap, inRange: false, cargo: lootCargo(c.loot), parts: { ...c.loot.parts } };
  }
  return best;
}

/** Everything the HUD needs about combat in this frame. */
export function combatHudView(state: SimState): CombatHudView {
  const { player, combat } = state;
  const pos = player.body.pos;
  const hull = hullHp(player.grid, player.hp);

  let attacking = 0;
  let nearest: ThreatView['nearest'] = null;
  for (const e of combat.enemies) {
    const dx = e.body.pos.x - pos.x;
    const dy = e.body.pos.y - pos.y;
    const d = Math.hypot(dx, dy);
    if (e.ai.mode !== 'attack') continue;
    attacking++;
    if (!nearest || d < nearest.distance) nearest = { distance: d, angle: Math.atan2(dy, dx) };
  }

  const salvage = salvagePrompt(state);

  const cannons = player.props.weapons;
  return {
    shield: player.props.shield.capacity > 0 ? meter(player.shield, player.props.shield.capacity) : null,
    hull: meter(hull.current, hull.max),
    silhouette: flightSilhouette(state),
    cannons: { total: cannons.length, ready: cannons.filter((w) => !player.cooldowns.has(w.partId) && player.energy >= w.energyPerShot).length },
    threat: { nearby: combat.enemies.length, attacking, nearest },
    salvage,
    salvageHold: { ...player.salvage },
    destroyed: player.destroyed,
  };
}

// ---------------------------------------------------------------------------
// hit indicator

export interface HitIndicator {
  /** World angle from the player to the attacker (sim: 0 = +x, counter-clockwise). The camera has north
   *  up, so on screen it is the angle −angle (screen y goes down). */
  angle: number;
  /** Seconds since the hit. */
  age: number;
  /** 0..1 – fades with age. */
  intensity: number;
  /** The shield absorbed the hit. */
  shield: boolean;
}

/** How long an indicator shows (s). */
export const HIT_INDICATOR_TIME = 1.2;

/** Collects the player's hits from simulation events and returns fading direction indicators. */
export class HitTracker {
  private hits: { angle: number; at: number; shield: boolean; damage: number }[] = [];
  /** Last hit (s) – e.g. to flash the silhouette. */
  lastHitAt = -Infinity;

  /** `now` = the UI game clock in seconds. */
  push(events: readonly SimEvent[], state: Pick<SimState, 'player'>, now: number): void {
    const pos = state.player.body.pos;
    for (const e of events) {
      if (e.type !== 'projectileHit' || e.ref !== 'player') continue;
      const dx = e.from.x - pos.x;
      const dy = e.from.y - pos.y;
      this.hits.push({ angle: Math.atan2(dy, dx), at: now, shield: e.target === 'shield', damage: e.damage });
      this.lastHitAt = now;
    }
    if (this.hits.length > 16) this.hits = this.hits.slice(-16);
  }

  indicators(now: number): HitIndicator[] {
    this.hits = this.hits.filter((h) => now - h.at < HIT_INDICATOR_TIME);
    return this.hits.map((h) => {
      const age = now - h.at;
      return { angle: h.angle, age, intensity: 1 - age / HIT_INDICATOR_TIME, shield: h.shield };
    });
  }

  clear(): void {
    this.hits = [];
  }
}

// ---------------------------------------------------------------------------
// death

export interface DeathView {
  penalty: DeathPenalty;
  /** Respawn station (the UI gets its name through stationById + formatStationName). */
  respawnStationId: StationId;
  /** Free evacuation to a station with a shipyard (the UI offers the choice), or null. */
  evacuationStationId: StationId | null;
  /** What is lost by difficulty. */
  loses: {
    cargo: boolean;
    /** Amount of resources in the hold that is lost (0 when it is not). */
    cargoAmount: number;
    /** Parts from wrecks on board (lost together with the cargo). */
    salvageParts: number;
    /** Installed parts – the player gets the starter ship. */
    installedParts: boolean;
    /** Part HP after the respawn (share). */
    partHpFraction: number;
    /** Fuel after the respawn (share of the tank). */
    fuelFraction: number;
  };
  /** The player abandoned the ship: the Guild's tow fee (free = cannot pay) and the cargo left in the wreck, else null. */
  scuttle: { fee: number; free: boolean; cargoInWreck: number } | null;
  /** Hardcore → the game drops to Hard. */
  fallsToHard: boolean;
  kills: number;
  deaths: number;
}

/** Cargo the player left in the wrecks of the abandoned ship (next to the wreck position). */
function scuttleCargo(sim: Simulation): number {
  const { pos } = sim.state.player.body;
  let total = 0;
  for (const w of sim.state.combat.wrecks) {
    if (w.livery !== 'default' || w.poi || Math.hypot(w.body.pos.x - pos.x, w.body.pos.y - pos.y) > 40) continue;
    total += cargoUsed(w.loot.cargo);
  }
  return total;
}

/** Summary of the loss for the "Ship destroyed" screen (before applyDeath is called). */
export function deathView(sim: Simulation): DeathView {
  const plan = planDeath(sim);
  const { rule } = plan;
  const { player, stats } = sim.state;
  // a scuttle the player cannot pay for costs the cargo, like a free tow
  const keepCargo = rule.keepCargo && !plan.scuttle?.free;
  return {
    penalty: plan.penalty,
    respawnStationId: plan.respawnStation.id,
    evacuationStationId: plan.evacuation?.id ?? null,
    loses: {
      cargo: !keepCargo,
      cargoAmount: keepCargo ? 0 : cargoUsed(player.cargo),
      // own parts loaded from wrecks are lost on every death (saboteur report X3)
      salvageParts: Object.values(player.salvage).reduce((s, n) => s + (n ?? 0), 0),
      installedParts: rule.ship === 'starter',
      partHpFraction: rule.partHpFraction,
      fuelFraction: rule.fuelFraction,
    },
    scuttle: plan.scuttle ? { ...plan.scuttle, cargoInWreck: scuttleCargo(sim) } : null,
    fallsToHard: rule.fallTo !== null,
    kills: stats.kills,
    deaths: stats.deaths,
  };
}
