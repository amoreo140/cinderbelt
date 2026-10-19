import {
  BoxGeometry,
  Color,
  CylinderGeometry,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  Quaternion,
  Vector3,
  type BufferGeometry,
  type Material,
  type ShaderMaterial,
} from 'three';
import { partDef, type PartId, type Tier } from '../data/parts';
import { clamp, lerpAngle, normalizeAngle } from '../sim/math/angle';
import type { Vec2 } from '../sim/math/vec2';
import { CANNON_HALF_ARC } from '../sim/combat/weapons';
import { LASER_HALF_ARC } from '../sim/mining/laser';
import { facing, laserPivot, partCells, partCenter, rotatedSize } from '../sim/ship/grid';
import { partSize } from '../sim/ship/shape';
import { isShapeId, type ShapeId } from '../data/shapes';
import { thrustGroupOf, type ShipProperties, type ThrustGroup } from '../sim/ship/properties';
import type { HpMap, Rotation, ShipGrid } from '../sim/ship/types';
import type { FactionId } from '../data/factions';
import { cellKey, gridCellKeys, hullOutline, type HullOutline, type NavPoint } from '../sim/ship/outline';
import { tierMaterial } from './assets/catalog';
import { PALETTE_MATERIAL } from './assets/gltf';
import type { ModelLibrary } from './assets/ModelLibrary';
import { connectorPlacements, type ConnectorPlacement } from './connectors';
import { armourLocalMask, clipArmour } from './hull/clipArmour';
import { hullShellEnabled, hullShellQuality, hullShellVersion, hullTerraceEnabled } from './hull/setting';
import { shipNavPoints } from './hull/NavLights';
import { buildShell, PART_LAYOUT, shellLayoutOf, shellStyle, shellTriangles, type ShellTier } from './hull/shellGeometry';
import { plateStyle, shapePlateGeometry } from './hull/shapePlate';
import { HullDecals, type DecalPart } from './decals/HullDecals';
import { bakeHull } from './shipBatch';
import { simToWorld } from './coords';
import { advanceFlame, createFlameGeometry, createFlameMaterial, setFlameIntensity } from './fx/flame';
import { createTrailMaterial, Trail } from './fx/Trail';
import { groupThrottle } from './throttle';
import { WorkshopRig } from './parts/workshopAnim';
import type { WorkshopActivity } from '../sim/ship/workshop';

/** Height of the placeholder boxes (when a model is missing). */
const HEIGHT: Record<PartId, number> = {
  cockpit: 0.9, armor: 0.6, engine: 0.5, gyro: 0.7,
  miningLaser: 0.55, cargo: 0.75, fuelTank: 0.7, reactor: 0.8, radar: 0.5, cannon: 0.6, shield: 0.7,
  heavyLaser: 0.6, largeCargo: 0.8, battery: 0.6, tractorBeam: 0.6,
  largeReactor: 0.9, repairModule: 0.55, refinery: 0.75,
};
const UP = new Vector3(0, 1, 0);
const AXIS_X = new Vector3(1, 0, 0);
const AXIS_Y = new Vector3(0, 1, 0);
const QUARTER = Math.PI / 2;

/** Tractor head aims ±90° (art/README 2.3). */
const TRACTOR_HALF_ARC = Math.PI / 2;

/** The flame starts at the model's nozzle mouth (distance from the cell centre) and at its height. */
const FLAME_START = 0.47;
const FLAME_HEIGHT = 0;

/** Animation speeds (rad/s). */
const GYRO_OUTER_IDLE = 1.2;
const GYRO_OUTER_TURNING = 7;
const GYRO_INNER = 2.1;
const RADAR_SPIN = 0.9;
/** How fast a laser head catches up with its target angle (1/s). */
const LASER_TRACKING = 12;

interface Flame {
  group: ThrustGroup;
  mesh: Mesh;
  /** Engine trail of this nozzle (null = trails off). */
  trail: Trail | null;
  /** Smoothed throttle for the trail (no flicker). */
  power: number;
  /** Throttle last frame – a fresh burn flares (M3.8). */
  last: number;
  /** Ignition flare 1 → 0. */
  flare: number;
}

/** Ignition flare (M3.8): how long it lasts (s) and how much longer / brighter the flame gets. */
const FLARE_TIME = 0.28;
const FLARE_LENGTH = 1.1;
const FLARE_GLOW = 0.6;

/**
 * Flame length and brightness for a throttle (0..1) and an ignition flare (0..1): a burn that just
 * started kicks out a longer, hotter tongue that settles in a quarter second.
 */
export function flameShape(throttle: number, flare: number, out: { length: number; intensity: number } = { length: 0, intensity: 0 }): { length: number; intensity: number } {
  out.length = 0.55 + 1.75 * throttle + FLARE_LENGTH * flare * flare;
  out.intensity = Math.min(1.6, 0.35 + throttle + FLARE_GLOW * flare);
  return out;
}

/** flameShape's answer of the frame (ShipView.update – no object per flame per frame). */
const shapeNow = { length: 0, intensity: 0 };

/** A node that spins around its local axis (base = the model's original orientation). */
interface Spinner {
  node: Object3D;
  base: Quaternion;
  axis: Vector3;
  angle: number;
  kind: 'gyroOuter' | 'gyroInner' | 'radar';
}

interface LaserRig {
  head: Object3D | null;
  base: Quaternion;
  muzzle: Object3D | null;
  /** Part centre relative to the centre of mass (ship-local frame). */
  offset: Vec2;
  rot: Rotation;
  angle: number;
  /** Largest head deflection (laser ±60°, cannon ±90°). */
  arc: number;
  /** Part id (cannons – muzzle flash on a shot). */
  partId: number;
}

const NO_NAV_POINTS: readonly NavPoint[] = [];

const tmpQuat = new Quaternion();
const tmpVec = new Vector3();

/** Where a ship is shown (hull shell grooves and clan lip decorations only off-flight on High). */
export type ShipViewMode = 'flight' | 'hangar' | 'shipyard';

/**
 * Per-view options of the hull shell (SL2 E1, hull-shell plan).
 * Read on every build – set `ShipView.options` and call rebuild() to apply a change.
 */
export interface ShipViewOptions {
  /** Hull shell on / off for this view; undefined = the global setting (render/hull/setting.ts). */
  shell?: boolean;
  /** Where the ship is shown; default 'flight'. */
  mode?: ShipViewMode;
  /**
   * Cells that existed before, for torn edges (spec §3.7): 'firstBuild' = the cells of this view's
   * first build (pirates, wrecks); a set of cell keys (`cellKey` / `gridCellKeys` in
   * sim/ship/outline.ts) = these cells (the player: the blueprint's cells); null = none (default –
   * shipyard, hangar, parked ships).
   */
  tornFrom?: 'firstBuild' | ReadonlySet<string> | null;
}

/** What the hull shell of the last build is (tests, the perf dev hook, screenshots). */
export interface ShellInfo {
  /** The shell was built (on, swatch table loaded, at least one model part). */
  on: boolean;
  /** Shell meshes attached to part nodes. */
  pieces: number;
  triangles: number;
  /** Outline edges drawn as torn (soot, no band / lip). */
  tornEdges: number;
  /** Armour parts swapped to a clipped (bevelled) variant. */
  bevelled: number;
  /** Time of the whole build() and of the shell part of it (outline, geometry, clip, attach), ms. */
  buildMs: number;
  shellMs: number;
}

const NO_SHELL: ShellInfo = { on: false, pieces: 0, triangles: 0, tornEdges: 0, bevelled: 0, buildMs: 0, shellMs: 0 };

/** Name and marker of the shell meshes (one per owner part, a child of the part's node). */
const SHELL_MESH = 'hull-shell';

/** The part node's palette material: the first opaque AF_Palette MeshStandardMaterial, else the first opaque standard one. */
function paletteMeshOf(node: Object3D): Mesh | null {
  let named: Mesh | null = null;
  let first: Mesh | null = null;
  node.traverse((o) => {
    if (named || !(o instanceof Mesh) || o.userData.afShell === true) return;
    const m = o.material;
    if (Array.isArray(m) || !(m instanceof MeshStandardMaterial) || m.transparent) return;
    if (m.name === PALETTE_MATERIAL) named = o;
    else first ??= o;
  });
  return named ?? first;
}

/** Meshes of a part node in traversal order, without the shell piece (dress capture, livery restore). */
function partMeshes(node: Object3D): Mesh[] {
  const out: Mesh[] = [];
  node.traverse((o) => {
    if (o instanceof Mesh && o.userData.afShell !== true) out.push(o);
  });
  return out;
}

/** Engine trails (visual polish): on/off and length by the graphics quality, colour and width. */
export const SHIP_TRAILS = { enabled: true, life: 0.8, points: 40, width: 0.38 };
const TRAIL_COLOR = [0.62, 0.38, 0.22] as const;
/** The trail starts a bit behind the nozzle (inside the flame), slightly under the hull. */
const TRAIL_START = 0.55;

/** Turns a laser head or turret toward `aimLocal` (ship frame), within its arc. */
function aimHead(laser: LaserRig, aimLocal: Vec2 | null, dt: number): void {
  if (!laser.head) return;
  let target = 0;
  if (aimLocal) {
    const dx = aimLocal.x - laser.offset.x;
    const dy = aimLocal.y - laser.offset.y;
    if (dx * dx + dy * dy > 1e-6) {
      target = clamp(normalizeAngle(Math.atan2(dy, dx) - laser.rot * QUARTER), -laser.arc, laser.arc);
    }
  }
  laser.angle = lerpAngle(laser.angle, target, 1 - Math.exp(-dt * LASER_TRACKING));
  laser.head.quaternion.copy(laser.base).multiply(tmpQuat.setFromAxisAngle(AXIS_Y, laser.angle));
}

/**
 * The 3D model of a ship from its grid (Blender models, else placeholder boxes). The group's origin
 * is the centre of mass.
 */
export class ShipView {
  readonly group = new Group();
  private hull = new Group();
  private flames: Flame[] = [];
  private spinners: Spinner[] = [];
  private lasers: LaserRig[] = [];
  /** Cannon turrets (M3a) – aim like the laser heads. */
  private turrets: LaserRig[] = [];
  /** Tractor beam heads (M3.6) – aim at the held object, or rest. */
  private tractors: LaserRig[] = [];
  /** Workshop part animations (M4c: refinery, large reactor, repair module – parts/workshopAnim.ts). */
  private workshop = new WorkshopRig();
  private flameMaterial: ShaderMaterial | null = null;
  private trailMaterial: MeshBasicMaterial | null = null;
  /** Own clock of the trails (s). */
  private clock = 0;
  /** Geometries and materials the view created (not the library's shared templates). */
  private ownedGeometries: BufferGeometry[] = [];
  private ownedMaterials: Material[] = [];
  private instanced: InstancedMesh[] = [];
  /** Hull connectors of the last build (tests, editor). */
  connectorCount = 0;
  /** Parts built from the clan's own models in the last build (tests, debugging). */
  clanPartCount = 0;
  /** Damage decals by part HP (art batch B7) – created when the hull is baked, drawn once a part is hurt. */
  private decals: HullDecals | null = null;
  /** Part nodes of the last build (decals, baking). */
  private decalParts: DecalPart[] = [];
  /** Static meshes merged per material (shipBatch.ts) since the last build. */
  private baked = false;
  /** Merged meshes of the hull (tests, debugging). */
  batchCount = 0;
  /** The hull shell of the last build (tests, perf hook). */
  shellInfo: ShellInfo = NO_SHELL;
  /** Grid and properties of the last build – a self-rebuild (shell setting change) reuses them. */
  private grid: ShipGrid | null = null;
  private props: ShipProperties | null = null;
  /** `hullShellVersion()` and the shell signature (`shellSignature`) the last build was made for. */
  private shellVersion = -1;
  private shellBuilt = '';
  /** Cells of the first build (`tornFrom: 'firstBuild'`), kept for the view's life. */
  private firstCells: ReadonlySet<string> | null = null;
  /** Nav lights of the last build (group frame); empty without a shell. */
  private nav: readonly NavPoint[] = NO_NAV_POINTS;
  /** Outline of the last build when the shell is on (terrace probes). */
  private outline: HullOutline | null = null;
  /** Did the last build raise the outline's terraces (v2; `hullTerraceEnabled()` at build time)? */
  private terracesBuilt = false;
  /** Shell meshes of the last build by owner part id. */
  private shellMeshes = new Map<number, Mesh>();
  /** Part materials of the last build as cloned from the templates, per part id (traversal order). */
  private builtMaterials = new Map<number, Material[]>();
  /**
   * Materials the owner put on the part nodes after the build (liveries: pirate tint, derelict
   * shades), captured at bake time per part id: built material → worn one. A self-rebuild (shell
   * setting) puts them back, since nobody re-dresses a view that rebuilt itself.
   */
  private dress = new Map<number, Map<Material, Material>>();

  /**
   * @param clan pirate clan whose part set (and hull connectors) the ship uses, part by part falling
   *   back to the player's model (render/assets/clanParts.ts); null = the player's parts. Read on
   *   every build – set it and call rebuild() once the clan's set has loaded.
   * @param options hull shell options (ShipViewOptions); read on every build like `clan`
   */
  constructor(
    grid: ShipGrid,
    props: ShipProperties,
    private readonly library: ModelLibrary,
    public clan: FactionId | null = null,
    public options: ShipViewOptions = {},
  ) {
    this.build(grid, props);
  }

  /** Builds the view again (e.g. after the ship was edited). */
  rebuild(grid: ShipGrid, props: ShipProperties): void {
    this.dispose();
    this.build(grid, props);
  }

  /** Is the shell drawn for this view now (option, global setting, swatch table)? */
  private shellWanted(): boolean {
    return (this.options.shell ?? hullShellEnabled()) && this.library.hasSwatches === true;
  }

  /** What a build of the shell depends on besides the grid: off, or the profile (lean / showcase). */
  private shellSignature(): string {
    if (!this.shellWanted()) return 'off';
    const q = hullShellQuality();
    const showcase = q === 'high' && (this.options.mode ?? 'flight') !== 'flight';
    return `on:${q === 'low' ? 'lean' : 'full'}:${showcase ? 'showcase' : 'plain'}:${hullTerraceEnabled() ? 'terrace' : 'flat'}`;
  }

  /** The torn-edge memory of this build (OutlineOptions.tornFrom). */
  private tornCells(grid: ShipGrid): ReadonlySet<string> | null {
    const t = this.options.tornFrom ?? null;
    if (t === 'firstBuild') {
      this.firstCells ??= gridCellKeys(grid);
      return this.firstCells;
    }
    return t;
  }

  private build(grid: ShipGrid, props: ShipProperties): void {
    const t0 = performance.now();
    this.grid = grid;
    this.props = props;
    this.shellVersion = hullShellVersion();
    this.shellBuilt = this.shellSignature();
    const shellOn = this.shellBuilt !== 'off';
    // the first build's cells are remembered even while the shell is off (a later toggle shows the damage)
    const torn = this.tornCells(grid);
    // shaped edges at render detail: the band and lip meet the shaped plates' walls exactly
    const outline = shellOn ? hullOutline(grid, { tornFrom: torn, bevelArmour: this.clan === null, detail: 'render' }) : null;
    let shellMs = outline ? performance.now() - t0 : 0;
    let bevelled = 0;
    // terrace v2 (plan 2026-10-20 §2.8 rule 4): the armour under a slab is deck-clipped – nothing of it is
    // drawn under the slab, nothing pokes through
    this.terracesBuilt = outline !== null && hullTerraceEnabled() && outline.terraces.length > 0;
    const underTerrace = this.terracesBuilt ? new Set(outline!.terraces.flatMap((t) => t.cells.map((c) => cellKey(c.x, c.y)))) : null;
    this.hull = new Group();
    simToWorld({ x: -props.centerOfMass.x, y: -props.centerOfMass.y }, 0, this.hull.position);
    this.group.add(this.hull);

    // flame: a strip with flame_gradient + flame_noise (fx/flame.ts)
    const flameGeometry = this.own(createFlameGeometry());
    const flameMaterial = this.ownMaterial(createFlameMaterial());
    this.flameMaterial = flameMaterial;

    this.clanPartCount = 0;
    const decalParts: DecalPart[] = [];
    for (const p of grid.parts) {
      const center = simToWorld(partCenter(p));
      const def = partDef(p.partId, p.tier, p.variant);
      const clanTemplate = this.clan ? this.library.clans.part(this.clan, p.partId, p.tier) : null;
      if (clanTemplate) this.clanPartCount++;
      let template = clanTemplate ?? this.library.part(p.partId, tierMaterial(p.tier));
      const shape = p.shape !== undefined && isShapeId(p.shape) ? p.shape : null;
      // a shaped armour (SL2 E2): a runtime plate on the template's palette material, never clipped
      if (template && shape) template = this.shapedPlate(template, shape, p.tier, p.rot);
      const bevel = shape ? 0 : (outline?.bevels.get(p.id) ?? 0);
      if (template && bevel !== 0) {
        // the player's shaved armour corners (spec §3.3): a shared clipped variant of the template
        const c0 = performance.now();
        template = clipArmour(template, armourLocalMask(bevel, p.rot));
        shellMs += performance.now() - c0;
        bevelled++;
      } else if (template && !shape && p.partId === 'armor' && underTerrace?.has(cellKey(p.x, p.y))) {
        // inner cells are never bevelled: the two clip kinds never combine
        const c0 = performance.now();
        template = clipArmour(template, 'deck');
        shellMs += performance.now() - c0;
      }
      const node = template ? template.clone() : this.placeholder(p.partId, p.tier, p.rot, shape);
      // grid part id – per-part looks (derelict shades, combat/livery.ts)
      node.userData.afPart = p.id;
      if (template) node.userData.afModel = true;
      this.builtMaterials.set(p.id, partMeshes(node).map((m) => m.material as Material));
      node.position.copy(center);
      if (template) node.rotation.y = p.rot * QUARTER;
      this.hull.add(node);
      decalParts.push({ part: p, node });

      if (template) this.collectAnimated(node, p.partId, p.id);
      if (def.mining) {
        const head = template ? (node.getObjectByName('Laser_Head') ?? null) : null;
        // head axis: over the front cell of the 2×1 heavy laser (as in the simulation)
        const c = laserPivot(p);
        this.lasers.push({
          head,
          base: head ? head.quaternion.clone() : new Quaternion(),
          muzzle: template ? (node.getObjectByName('Muzzle') ?? null) : null,
          offset: { x: c.x - props.centerOfMass.x, y: c.y - props.centerOfMass.y },
          rot: p.rot,
          angle: 0,
          arc: LASER_HALF_ARC,
          partId: p.id,
        });
      }
      if (def.weapon) {
        const head = template ? (node.getObjectByName('Cannon_Turret') ?? null) : null;
        const c = partCenter(p);
        this.turrets.push({
          head,
          base: head ? head.quaternion.clone() : new Quaternion(),
          muzzle: template ? (node.getObjectByName('Cannon_Muzzle') ?? null) : null,
          offset: { x: c.x - props.centerOfMass.x, y: c.y - props.centerOfMass.y },
          rot: p.rot,
          angle: 0,
          arc: CANNON_HALF_ARC,
          partId: p.id,
        });
      }

      if (def.tractor) {
        const head = template ? (node.getObjectByName('Tractor_Head') ?? null) : null;
        const c = partCenter(p);
        this.tractors.push({
          head,
          base: head ? head.quaternion.clone() : new Quaternion(),
          muzzle: template ? (node.getObjectByName('Tractor_Emitter') ?? null) : null,
          offset: { x: c.x - props.centerOfMass.x, y: c.y - props.centerOfMass.y },
          rot: p.rot,
          angle: 0,
          arc: TRACTOR_HALF_ARC,
          partId: p.id,
        });
      }

      if (def.thrust) {
        const f = facing(p.rot);
        const exhaust = simToWorld({ x: -f.x, y: -f.y });
        // base at the nozzle (y = 0), tip outward (y = 1)
        const flame = new Mesh(flameGeometry, flameMaterial);
        flame.quaternion.setFromUnitVectors(UP, exhaust);
        flame.position.copy(center).addScaledVector(exhaust, FLAME_START).setY(FLAME_HEIGHT);
        flame.visible = false;
        this.hull.add(flame);
        this.flames.push({ group: thrustGroupOf(p.rot), mesh: flame, last: 0, flare: 0, trail: null, power: 0 });
      }
    }

    this.outline = outline;
    this.nav = NO_NAV_POINTS;
    let shell: { pieces: number; triangles: number } = { pieces: 0, triangles: 0 };
    if (outline) {
      const s0 = performance.now();
      shell = this.attachShell(grid, outline, decalParts);
      if (shell.pieces > 0) this.nav = shipNavPoints(grid, props.centerOfMass, outline);
      shellMs += performance.now() - s0;
    }
    // with the shell, the dot connectors give way to seam strips: corner hubs only at T / L junctions
    this.buildConnectors(outline && shell.pieces > 0 ? outline.hubs.map((h): ConnectorPlacement => ({ kind: 'corner', x: h.x, y: h.y, rot: 0 })) : connectorPlacements(grid));
    this.decalParts = decalParts;
    this.baked = false;
    this.batchCount = 0;
    let tornEdges = 0;
    if (outline && shell.pieces > 0) {
      for (const loop of outline.loops) for (const run of loop.runs) if (run.kind === 'torn') tornEdges += run.edges.length;
    }
    this.shellInfo = outline && shell.pieces > 0
      ? { on: true, pieces: shell.pieces, triangles: shell.triangles, tornEdges, bevelled, buildMs: performance.now() - t0, shellMs }
      : { ...NO_SHELL, buildMs: performance.now() - t0 };
  }

  /**
   * Hull shell (SL2 E1, spec §3.2 step 8): one piece per owner part, built in the hull frame and added
   * as a child of that part's node – with the inverse of the node's transform, so it lands in the
   * hull frame again – using the part's own palette material and the attribute layout of its meshes.
   * `bakeHull` then merges each piece into the part's batch (+0 draw calls), the part's decal probe
   * holds it and a livery dresses it with the part. Placeholder parts (no model) get no piece.
   */
  private attachShell(grid: ShipGrid, outline: HullOutline, parts: readonly DecalPart[]): { pieces: number; triangles: number } {
    const nodes = new Map<number, { node: Object3D; mesh: Mesh }>();
    for (const { part, node } of parts) {
      if (node.userData.afModel !== true) continue;
      const mesh = paletteMeshOf(node);
      if (mesh) nodes.set(part.id, { node, mesh });
    }
    const first = nodes.values().next().value;
    if (!first) return { pieces: 0, triangles: 0 };
    const cockpit = grid.parts.find((p) => p.partId === 'cockpit');
    const tier: ShellTier = cockpit?.tier ?? 1;
    const geometries = buildShell({
      outline,
      style: shellStyle(tier, this.clan),
      layout: shellLayoutOf(first.mesh.geometry),
      swatchUv: this.library.swatchUv,
      quality: hullShellQuality(),
      mode: this.options.mode ?? 'flight',
      grid,
      terraces: this.terracesBuilt,
    });
    const triangles = shellTriangles(geometries);
    const inverse = new Matrix4();
    for (const [owner, geometry] of geometries) {
      this.own(geometry);
      const target = nodes.get(owner);
      if (!target) continue;
      const mesh = new Mesh(geometry, target.mesh.material);
      mesh.name = SHELL_MESH;
      mesh.userData.afShell = true;
      mesh.castShadow = target.mesh.castShadow;
      mesh.receiveShadow = target.mesh.receiveShadow;
      target.node.updateMatrix();
      // decomposed, not a frozen matrix: bakeHull recomposes every node's matrix from its TRS
      inverse.copy(target.node.matrix).invert().decompose(mesh.position, mesh.quaternion, mesh.scale);
      target.node.add(mesh);
      this.shellMeshes.set(owner, mesh);
    }
    return { pieces: this.shellMeshes.size, triangles };
  }

  /**
   * Merges the static meshes of the hull per material (audit 2026-10-16 #4, shipBatch.ts). Runs on
   * the first update or setDamage after a build, so a livery applied right after build / rebuild
   * (combat/livery.ts – per-part derelict shades) still sees the per-part nodes.
   */
  bake(): void {
    if (this.baked) return;
    this.baked = true;
    const keep = new Set<Object3D>();
    for (const s of this.spinners) keep.add(s.node);
    this.workshop.keep(keep);
    for (const r of [...this.lasers, ...this.turrets, ...this.tractors]) {
      if (r.head) keep.add(r.head);
      if (r.muzzle) keep.add(r.muzzle);
    }
    this.captureDress();
    const baked = bakeHull(this.hull, this.decalParts.map((d) => d.node), this.instanced, keep);
    for (const b of baked.batches) this.own(b.geometry);
    this.batchCount = baked.batches.length;
    // connectors merged into a batch leave the hull
    this.instanced = this.instanced.filter((i) => {
      if (i.parent) return true;
      i.dispose();
      return false;
    });
    this.addTerraceProbes(baked.probes);
    this.decals = new HullDecals(this.hull, this.decalParts.map((d, i) => ({ part: d.part, node: baked.probes[i]! })), baked.probeRoot, this.buildSignature());
  }

  /**
   * What the probe geometry of this build depends on (HullDecals caches its placements by it): the
   * parts, the shell profile and view mode, the clan set and the torn-edge memory.
   */
  private buildSignature(): string | null {
    const grid = this.grid;
    if (!grid) return null;
    const torn = this.tornCells(grid);
    const parts = grid.parts.map((p) => `${p.id}:${p.partId}:${p.tier}:${p.variant ?? ''}:${p.shape ?? ''}:${p.x},${p.y}:${p.rot}`).join(';');
    const tornKey = torn ? [...torn].sort().join(';') : '-';
    return `${this.shellBuilt}|${this.options.mode ?? 'flight'}|${this.clan ?? '-'}:${this.clanPartCount}|${tornKey}|${parts}`;
  }

  /**
   * A terrace slab belongs to the lowest part id of its armour group, but covers the other parts'
   * cells too: their decal probes get the owner's shell piece as well, so a decal ray from above lands
   * on the slab instead of the armour under it. (Over its own cells, another part's ray meets nothing
   * else of that piece – band and lip stay on the owner's cells.)
   */
  private addTerraceProbes(probes: readonly Group[]): void {
    if (!this.terracesBuilt || !this.outline || this.shellMeshes.size === 0) return;
    const index = new Map<number, number>();
    this.decalParts.forEach((d, i) => index.set(d.part.id, i));
    const cellOwner = new Map<string, number>();
    for (const d of this.decalParts) for (const c of partCells(d.part)) cellOwner.set(`${c.x},${c.y}`, d.part.id);
    for (const t of this.outline.terraces) {
      const piece = this.shellMeshes.get(t.owner);
      if (!piece) continue;
      const covered = new Set<number>();
      for (const c of t.cells) {
        const id = cellOwner.get(`${c.x},${c.y}`);
        if (id !== undefined && id !== t.owner) covered.add(id);
      }
      for (const id of covered) {
        const probe = probes[index.get(id) ?? -1];
        if (!probe) continue;
        const copy = new Mesh(piece.geometry, piece.material);
        copy.matrixAutoUpdate = false;
        probe.add(copy);
      }
    }
  }

  /** Remembers the materials the owner swapped on the part nodes since the build (see `dress`). */
  private captureDress(): void {
    this.dress = new Map();
    for (const { part, node } of this.decalParts) {
      const built = this.builtMaterials.get(part.id);
      if (!built) continue;
      const now = partMeshes(node);
      let swap: Map<Material, Material> | null = null;
      for (let i = 0; i < now.length && i < built.length; i++) {
        const worn = now[i]!.material as Material;
        if (worn === built[i]) continue;
        swap ??= new Map();
        swap.set(built[i]!, worn);
      }
      if (swap) this.dress.set(part.id, swap);
    }
  }

  /** Puts the captured dress back on the freshly built part nodes (and their shell pieces). */
  private restoreDress(dress: ReadonlyMap<number, ReadonlyMap<Material, Material>>): void {
    if (dress.size === 0) return;
    for (const { part, node } of this.decalParts) {
      const swap = dress.get(part.id);
      if (!swap) continue;
      node.traverse((o) => {
        if (!(o instanceof Mesh) || Array.isArray(o.material)) return;
        const worn = swap.get(o.material as Material);
        if (worn) o.material = worn;
      });
    }
  }

  /**
   * Rebuilds the view on its own when the hull shell setting (or the shell quality) changed since the
   * last build – keeping the grid, the properties and the owner's dress (liveries). Called by update().
   */
  private refreshShell(): void {
    this.shellVersion = hullShellVersion();
    if (!this.grid || !this.props || this.shellSignature() === this.shellBuilt) return;
    // the dress is captured at bake time; an unbaked view still has it on its nodes
    if (!this.baked) this.captureDress();
    const dress = this.dress;
    this.rebuild(this.grid, this.props);
    this.restoreDress(dress);
  }

  /** Damage decals from the parts' HP, or 'wreck' (always some); call every frame (fresh ones cool). */
  setDamage(hp: HpMap | 'wreck', dt: number, seed = 0): void {
    // wrecks only get setDamage – they follow the shell setting here
    if (this.shellVersion !== hullShellVersion()) this.refreshShell();
    this.bake();
    this.decals?.update(hp, dt, seed);
  }

  /** Decal quads drawn (tests, debugging). */
  get decalCount(): number {
    return this.decals?.count ?? 0;
  }

  /**
   * Hull connectors: one InstancedMesh per template mesh (merged into the hull batches by bake()).
   * Without the shell the dot grid of `connectorPlacements`, with it the corner hubs of the outline.
   */
  private buildConnectors(placements: readonly ConnectorPlacement[]): void {
    this.connectorCount = placements.length;
    for (const kind of ['edge', 'corner'] as const) {
      const template = (this.clan ? this.library.clans.connector(this.clan, kind) : null) ?? this.library.connector(kind);
      const list = placements.filter((c) => c.kind === kind);
      if (!template || list.length === 0) continue;
      template.updateMatrixWorld(true);
      const meshes: Mesh[] = [];
      template.traverse((o) => {
        if (o instanceof Mesh) meshes.push(o);
      });
      const placement = new Object3D();
      const matrix = new Matrix4();
      for (const mesh of meshes) {
        const instanced = new InstancedMesh(mesh.geometry, mesh.material, list.length);
        list.forEach((c, i) => {
          simToWorld(c, 0, placement.position);
          placement.rotation.y = c.rot * QUARTER;
          placement.updateMatrix();
          instanced.setMatrixAt(i, matrix.multiplyMatrices(placement.matrix, mesh.matrixWorld));
        });
        instanced.computeBoundingSphere();
        this.instanced.push(instanced);
        this.hull.add(instanced);
      }
    }
  }

  private collectAnimated(node: Object3D, partId: PartId, partRef: number): void {
    this.workshop.collect(node, partId, partRef);
    const add = (name: string, axis: Vector3, kind: Spinner['kind']) => {
      const target = node.getObjectByName(name);
      if (target) this.spinners.push({ node: target, base: target.quaternion.clone(), axis, angle: 0, kind });
    };
    add('Gyro_Ring_Outer', AXIS_Y, 'gyroOuter');
    add('Gyro_Ring_Inner', AXIS_X, 'gyroInner');
    add('Radar_Dish', AXIS_Y, 'radar');
  }

  /**
   * The model of a shaped armour (SL2 E2, plan §2.6): a node holding the shape's runtime plate
   * (hull/shapePlate.ts) at rot 0 with the palette material, shadow flags and attribute layout of the
   * armour template's palette mesh – so it joins that template's batch (+0 draw calls, no new shader
   * program), follows liveries and is hit by the decal probes. Cloned and turned by `rot` like any part
   * model (its chevrons drawn turned back by `rot`, so they point to the bow). The plate geometry is
   * shared and cached: the view neither owns nor disposes it. Null = the template has no palette mesh
   * (a placeholder takes over).
   */
  private shapedPlate(template: Object3D, shape: ShapeId, tier: Tier, rot: Rotation): Object3D | null {
    const source = paletteMeshOf(template);
    if (!source || Array.isArray(source.material)) return null;
    const geometry = shapePlateGeometry(shape, plateStyle(tier, this.clan), shellLayoutOf(source.geometry), this.library.swatchUv, rot);
    const node = new Group();
    node.name = `Armor_${shape}`;
    const mesh = new Mesh(geometry, source.material);
    mesh.name = 'Plate';
    mesh.castShadow = source.castShadow;
    mesh.receiveShadow = source.receiveShadow;
    mesh.layers.mask = source.layers.mask;
    if (source.userData.noShadow === true) mesh.userData.noShadow = true;
    if (source.userData.noAO === true) mesh.userData.noAO = true;
    node.add(mesh);
    return node;
  }

  /** A part's placeholder shape (spec 3.5 – missing model); a shaped armour gets its plain plate. */
  private placeholder(partId: PartId, tier: Tier, rot: Rotation, shape: ShapeId | null = null): Object3D {
    const def = partDef(partId, tier);
    const node = new Group();
    const material = this.ownMaterial(new MeshStandardMaterial({ color: def.color, roughness: 0.55, metalness: 0.35 }));
    if (shape) {
      // shared plate geometry (not owned), turned like a model
      node.add(new Mesh(shapePlateGeometry(shape, plateStyle(tier, this.clan), PART_LAYOUT, this.library.swatchUv, rot), material));
      node.rotation.y = rot * QUARTER;
      return node;
    }
    const { w, h } = rotatedSize(partSize({ partId, tier }), rot);
    const height = HEIGHT[partId];
    const body = new Mesh(this.own(new BoxGeometry(w * 0.94, height, h * 0.94)), material);
    node.add(body);
    if (def.thrust) {
      const exhaust = simToWorld({ x: -facing(rot).x, y: -facing(rot).y });
      const nozzle = new Mesh(
        this.own(new CylinderGeometry(0.22, 0.32, 0.25, 12)),
        this.ownMaterial(new MeshStandardMaterial({ color: 0x2b2f3a, roughness: 0.4, metalness: 0.8 })),
      );
      nozzle.quaternion.setFromUnitVectors(UP, exhaust);
      nozzle.position.copy(exhaust).multiplyScalar(0.45);
      node.add(nozzle);
    }
    return node;
  }

  private own<T extends BufferGeometry>(geometry: T): T {
    this.ownedGeometries.push(geometry);
    return geometry;
  }

  private ownMaterial<T extends Material>(material: T): T {
    this.ownedMaterials.push(material);
    return material;
  }

  /**
   * @param aimLocal where the mouse aims, in the ship's local frame relative to the centre of mass (null = no target)
   * @param angVel the ship's angular velocity (rad/s) – gyroscopes spin faster while turning
   */
  update(dt: number, localForce: Vec2, props: ShipProperties, aimLocal: Vec2 | null, angVel = 0, tractorLocal: Vec2 | null = null): void {
    if (this.shellVersion !== hullShellVersion()) this.refreshShell();
    this.bake();
    if (this.flameMaterial) advanceFlame(this.flameMaterial, dt);
    this.clock += dt;
    const trails = SHIP_TRAILS.enabled && this.flames.length > 0;
    if (trails) this.group.updateMatrixWorld(true);
    for (const flame of this.flames) {
      const throttle = groupThrottle(flame.group, localForce, props);
      // a burn that starts from (almost) nothing flares; the flare decays on its own
      if (throttle > 0.3 && flame.last < 0.05) flame.flare = 1;
      flame.last = throttle;
      flame.flare = Math.max(0, flame.flare - dt / FLARE_TIME);
      flame.mesh.visible = throttle > 0.02;
      const shape = flameShape(throttle * (0.92 + Math.random() * 0.16), flame.flare, shapeNow);
      flame.mesh.scale.y = shape.length;
      setFlameIntensity(flame.mesh, shape.intensity);
      flame.power += (throttle - flame.power) * (1 - Math.exp(-dt * 12));
      if (trails) this.updateTrail(flame);
      else if (flame.trail) {
        flame.trail.dispose();
        flame.trail = null;
      }
    }

    const turning = clamp(Math.abs(angVel) / 1.5, 0, 1);
    for (const s of this.spinners) {
      const speed =
        s.kind === 'gyroOuter' ? GYRO_OUTER_IDLE + (GYRO_OUTER_TURNING - GYRO_OUTER_IDLE) * turning
        : s.kind === 'gyroInner' ? GYRO_INNER
        : RADAR_SPIN;
      s.angle = normalizeAngle(s.angle + speed * dt);
      s.node.quaternion.copy(s.base).multiply(tmpQuat.setFromAxisAngle(s.axis, s.angle));
    }

    this.workshop.animate(dt);

    // laser heads and turrets aim at the cursor (two loops – no merged array per frame)
    for (const laser of this.lasers) aimHead(laser, aimLocal, dt);
    for (const laser of this.turrets) aimHead(laser, aimLocal, dt);
    // tractor heads follow the held object (rest when idle)
    for (const t of this.tractors) {
      if (!t.head) continue;
      let target = 0;
      if (tractorLocal) {
        const dx = tractorLocal.x - t.offset.x;
        const dy = tractorLocal.y - t.offset.y;
        if (dx * dx + dy * dy > 1e-6) target = clamp(normalizeAngle(Math.atan2(dy, dx) - t.rot * QUARTER), -t.arc, t.arc);
      }
      t.angle = lerpAngle(t.angle, target, 1 - Math.exp(-dt * LASER_TRACKING));
      t.head.quaternion.copy(t.base).multiply(tmpQuat.setFromAxisAngle(AXIS_Y, t.angle));
    }
  }

  /** Lays the trail of one nozzle in world space (the trail mesh ignores the ship transform). */
  private updateTrail(flame: Flame): void {
    if (!flame.trail) {
      this.trailMaterial ??= this.ownMaterial(createTrailMaterial());
      flame.trail = new Trail(this.trailMaterial, SHIP_TRAILS.points, new Color(...TRAIL_COLOR), SHIP_TRAILS.width, SHIP_TRAILS.life);
      this.group.add(flame.trail.mesh);
    }
    flame.trail.life = SHIP_TRAILS.life;
    // from the nozzle along the exhaust (local +Y of the flame strip), just below the hull plane
    tmpVec.set(0, TRAIL_START, 0).applyMatrix4(flame.mesh.matrixWorld);
    tmpVec.y -= 0.12;
    flame.trail.emit(tmpVec, flame.power > 0.05 ? Math.min(1, flame.power * 1.2) : 0, this.clock);
    flame.trail.update(this.clock);
  }

  /** What the ship's on-board workshop does (M4c `player.workshop`); null = idle. */
  setWorkshop(activity: WorkshopActivity | null): void {
    this.workshop.setActivity(activity);
  }

  /** World position of the tractor emitter (first tractor beam), or null without a model. */
  tractorEmitterWorld(out: Vector3): Vector3 | null {
    const m = this.tractors[0]?.muzzle;
    return m ? m.getWorldPosition(out) : null;
  }

  /**
   * Nav lights of the last build in the ship group's local frame (sim units, centre of mass at the
   * origin, already pulled onto the lip) – the NavLights layer's input. Empty while the shell is off.
   * The same array until the next build (cheap to read every frame).
   */
  navPoints(): readonly NavPoint[] {
    return this.nav;
  }

  /** Ship has a tractor beam part. */
  get hasTractor(): boolean {
    return this.tractors.length > 0;
  }

  /** World position of laser number `index`'s muzzle (order of ShipProperties.lasers), or null without a model. */
  muzzleWorld(index: number, out: Vector3): Vector3 | null {
    const muzzle = this.lasers[index]?.muzzle;
    return muzzle ? muzzle.getWorldPosition(out) : null;
  }

  /** World position of a cannon's muzzle (part id), or null without a model. */
  cannonMuzzleWorld(partId: number, out: Vector3): Vector3 | null {
    const muzzle = this.turrets.find((t) => t.partId === partId)?.muzzle;
    return muzzle ? muzzle.getWorldPosition(out) : null;
  }

  /** World positions of every cannon muzzle (muzzle flash – the one nearest the shot). */
  cannonMuzzles(): Vector3[] {
    const out: Vector3[] = [];
    for (const t of this.turrets) if (t.muzzle) out.push(t.muzzle.getWorldPosition(new Vector3()));
    return out;
  }

  /** Frees only what the view owns – the library's templates stay. */
  dispose(): void {
    for (const g of this.ownedGeometries) g.dispose();
    for (const m of this.ownedMaterials) m.dispose();
    for (const i of this.instanced) i.dispose();
    for (const f of this.flames) f.trail?.dispose();
    this.decals?.dispose();
    this.decals = null;
    this.decalParts = [];
    this.shellMeshes = new Map();
    this.builtMaterials = new Map();
    this.outline = null;
    this.terracesBuilt = false;
    this.nav = NO_NAV_POINTS;
    this.trailMaterial = null;
    this.group.remove(this.hull);
    this.ownedGeometries = [];
    this.ownedMaterials = [];
    this.instanced = [];
    this.flames = [];
    this.spinners = [];
    this.workshop.clear();
    this.lasers = [];
    this.turrets = [];
    this.tractors = [];
    this.flameMaterial = null;
  }
}
