import { partDef, type ShieldSpec, type Tier, type TractorSpec, type WeaponSpec } from '../../data/parts';
import { isShapeId, type ShapeId } from '../../data/shapes';
import { length, sub, type Vec2 } from '../math/vec2';
import { facing, laserPivot, partCells, partCenter, rotatedSize } from './grid';
import { effectiveArcs, type Arc } from '../combat/arcs';
import { BLOCKED_EXHAUST_THRUST, blockedExhausts, type ExhaustBurn } from './exhaust';
import { massMultOf, partSize, polygonCentroid, shapePolygon } from './shape';
import type { PlacedPart, Rotation, ShipGrid } from './types';

export type ThrustGroup = 'forward' | 'backward' | 'left' | 'right';

export interface LaserMount {
  /** Id of the placed part. */
  partId: number;
  /** The laser head's axis (centre of the front cell) relative to the centre of mass (ship frame). */
  offset: Vec2;
  facing: Vec2;
  range: number;
  rate: number;
  energyPerSecond: number;
  /** Heavy laser (deep titanium veins, spec 2.1.1). */
  heavy: boolean;
}

/** A cannon mounted on the ship (M3a). */
export interface WeaponMount extends WeaponSpec {
  /** Effective arcs relative to the facing (±60° minus the own hull, combat/arcs.ts). */
  arcs: Arc[];
  /** Id of the placed part. */
  partId: number;
  /** The part's centre relative to the centre of mass (ship frame). */
  offset: Vec2;
  facing: Vec2;
  tier: Tier;
}

/** A tractor beam mounted on the ship (M3.6). */
export interface TractorMount extends TractorSpec {
  partId: number;
  /** The part's centre relative to the centre of mass (ship frame). */
  offset: Vec2;
  facing: Vec2;
  tier: Tier;
}

/** The ship's combined shield; capacity 0 = the ship has no shield generator. */
export type ShipShield = ShieldSpec;

export interface ShipProperties {
  mass: number;
  /** Centre of mass in the grid's local coordinates. */
  centerOfMass: Vec2;
  /** Moment of inertia around the centre of mass. */
  inertia: number;
  /** Engine thrust summed by the direction it pushes the ship. */
  thrust: Record<ThrustGroup, number>;
  torque: number;
  /** The cockpit's manoeuvring thrusters (RCS): force in each direction that has no engines (control.ts). */
  rcsThrust: number;
  cargoCapacity: number;
  fuelCapacity: number;
  batteryCapacity: number;
  energyGen: number;
  radarRange: number;
  lasers: LaserMount[];
  weapons: WeaponMount[];
  /** Tractor beams (M3.6). */
  tractors: TractorMount[];
  shield: ShipShield;
  /** Centres of all cells relative to the centre of mass – for collisions. */
  cellOffsets: Vec2[];
  /** Radius of the circle around the centre of mass that covers the whole ship. */
  boundingRadius: number;
  /** Fuel use against the base engines (variants averaged by thrust; 1 = base). */
  fuelUseMult: number;
  /** Scanner pulse recharge multiplier (scout cockpit 0.7). */
  pulseCooldownMult: number;
  /** Engines whose nozzle is covered by another part (half thrust, they burn that part – exhaust.ts). */
  exhaustBurns: ExhaustBurn[];
}

const GROUP_BY_ROT: readonly ThrustGroup[] = ['forward', 'left', 'backward', 'right'];

export function thrustGroupOf(rot: Rotation): ThrustGroup {
  return GROUP_BY_ROT[rot]!;
}

// Shaped armour (SL2 E2, spec 2026-10-19 §2.7): mass × the shape's area, placed at the polygon centroid;
// inertia = that point mass + the footprint rectangle's own moment × the area. A part without a (known)
// shape takes the original arithmetic unchanged, so ships without shapes are bit-identical (the fast path,
// fastPath.test.ts). Collision cells and the bounding radius stay per cell.

/** Part-centred centroids of the sim-detail shape polygons, by shape and rotation. */
const centroidCache = new Map<string, Vec2>();

function shapeCentroid(shape: ShapeId, rot: Rotation): Vec2 {
  const key = `${shape}:${rot}`;
  let c = centroidCache.get(key);
  if (!c) {
    c = polygonCentroid(shapePolygon(shape, rot, 'sim'));
    centroidCache.set(key, c);
  }
  return c;
}

/** The part's known shape, or undefined (no shape, or an unknown value – treated as the full part). */
const knownShape = (p: PlacedPart): ShapeId | undefined => (p.shape !== undefined && isShapeId(p.shape) ? p.shape : undefined);

/** Where the part's mass sits (grid frame): the polygon centroid of a shaped part, else the part centre. */
function massCentre(p: PlacedPart): Vec2 {
  const c = partCenter(p);
  const shape = knownShape(p);
  if (shape === undefined) return c;
  const local = shapeCentroid(shape, p.rot);
  return { x: c.x + local.x, y: c.y + local.y };
}

export function computeProperties(grid: ShipGrid): ShipProperties {
  if (grid.parts.length === 0) throw new Error('The ship has no parts');

  let mass = 0;
  let mx = 0;
  let my = 0;
  let torque = 0;
  let rcsThrust = 0;
  let cargoCapacity = 0;
  let fuelCapacity = 0;
  let batteryCapacity = 0;
  let energyGen = 0;
  let radarRange = 0;
  let thrustTotal = 0;
  let fuelWeighted = 0;
  let pulseCooldownMult = 1;
  const shield: ShipShield = { capacity: 0, regen: 0, regenDelay: 0, energyPerPoint: 0 };
  const thrust: Record<ThrustGroup, number> = { forward: 0, backward: 0, left: 0, right: 0 };
  const blocked = blockedExhausts(grid);
  const blockedIds = new Set(blocked.map((b) => b.engineId));
  const exhaustBurns: ExhaustBurn[] = [];

  for (const p of grid.parts) {
    const def = partDef(p.partId, p.tier, p.variant);
    const c = massCentre(p);
    const m = knownShape(p) === undefined ? def.mass : def.mass * massMultOf(p);
    mass += m;
    mx += m * c.x;
    my += m * c.y;
    if (def.thrust) {
      // a covered nozzle gives half thrust (design 3.4.2)
      const engineThrust = blockedIds.has(p.id) ? def.thrust * BLOCKED_EXHAUST_THRUST : def.thrust;
      thrust[thrustGroupOf(p.rot)] += engineThrust;
      thrustTotal += engineThrust;
      fuelWeighted += engineThrust * (def.fuelUse ?? 1);
      const b = blocked.find((x) => x.engineId === p.id);
      if (b) exhaustBurns.push({ ...b, group: thrustGroupOf(p.rot) });
    }
    if (def.pulseCooldown !== undefined) pulseCooldownMult = Math.min(pulseCooldownMult, def.pulseCooldown);
    torque += def.torque ?? 0;
    rcsThrust = Math.max(rcsThrust, def.rcsThrust ?? 0);
    cargoCapacity += def.cargo ?? 0;
    fuelCapacity += def.fuel ?? 0;
    batteryCapacity += def.battery ?? 0;
    energyGen += def.energyGen ?? 0;
    radarRange = Math.max(radarRange, def.radarRange ?? 0);
    if (def.shield) {
      const first = shield.capacity === 0;
      shield.capacity += def.shield.capacity;
      shield.regen += def.shield.regen;
      shield.regenDelay = first ? def.shield.regenDelay : Math.min(shield.regenDelay, def.shield.regenDelay);
      shield.energyPerPoint = first ? def.shield.energyPerPoint : Math.max(shield.energyPerPoint, def.shield.energyPerPoint);
    }
  }

  const centerOfMass = { x: mx / mass, y: my / mass };

  let inertia = 0;
  const lasers: LaserMount[] = [];
  const weapons: WeaponMount[] = [];
  const tractors: TractorMount[] = [];
  const cellOffsets: Vec2[] = [];
  let boundingRadius = 0;

  for (const p of grid.parts) {
    const def = partDef(p.partId, p.tier, p.variant);
    const c = partCenter(p);
    const dx = c.x - centerOfMass.x;
    const dy = c.y - centerOfMass.y;
    if (knownShape(p) === undefined) {
      const { w, h } = rotatedSize(def.size, p.rot);
      // point mass at the part's centre + the rectangle's own moment
      inertia += def.mass * (dx * dx + dy * dy) + (def.mass * (w * w + h * h)) / 12;
    } else {
      // point mass at the polygon centroid + the footprint rectangle's own moment × the area
      const mult = massMultOf(p);
      const mc = massCentre(p);
      const mdx = mc.x - centerOfMass.x;
      const mdy = mc.y - centerOfMass.y;
      const { w, h } = rotatedSize(partSize(p), p.rot);
      inertia += def.mass * mult * (mdx * mdx + mdy * mdy) + ((def.mass * (w * w + h * h)) / 12) * mult;
    }

    if (def.mining) {
      const pivot = laserPivot(p);
      lasers.push({
        partId: p.id,
        offset: { x: pivot.x - centerOfMass.x, y: pivot.y - centerOfMass.y },
        facing: facing(p.rot),
        range: def.mining.range,
        rate: def.mining.rate,
        energyPerSecond: def.mining.energyPerSecond,
        heavy: def.mining.heavy === true,
      });
    }
    if (def.weapon) {
      weapons.push({ partId: p.id, offset: { x: dx, y: dy }, facing: facing(p.rot), tier: p.tier, ...def.weapon, arcs: effectiveArcs(grid, p) });
    }
    if (def.tractor) {
      tractors.push({ partId: p.id, offset: { x: dx, y: dy }, facing: facing(p.rot), tier: p.tier, ...def.tractor });
    }
    for (const cell of partCells(p)) {
      const offset = sub(cell, centerOfMass);
      cellOffsets.push(offset);
      boundingRadius = Math.max(boundingRadius, length(offset) + Math.SQRT1_2);
    }
  }

  return {
    mass, centerOfMass, inertia, thrust, torque, rcsThrust,
    cargoCapacity, fuelCapacity, batteryCapacity, energyGen, radarRange,
    lasers, weapons, tractors, shield, cellOffsets, boundingRadius,
    fuelUseMult: thrustTotal > 0 ? fuelWeighted / thrustTotal : 1,
    pulseCooldownMult,
    exhaustBurns,
  };
}
