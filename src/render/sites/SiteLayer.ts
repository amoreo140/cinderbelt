// Derelict stations, relays, live mines and the local ion storm of a derelict (M4b plan T13). Reads the
// simulation state only.
//
// - Derelicts (`derelicts/derelict_<m>.glb`) at their angle, merged per role: the hull (one mesh per
//   material, its emission off – the station is dead), the window strips and the beacon lamps (their own
//   material per station: dark until relays are powered; a brownout flicker with one or two, the windows
//   partly back and the dock lamps blinking red / green with all three), the drifting piece (slow tumble).
// - Relays (`derelict_relay.glb`): one InstancedMesh per merged part for every relay in view. The lamp
//   and the receiver are glow sprites: dark → charging (pulse by progress, a glow on the receiver, the
//   power conduit growing towards the station) → lit (steady, the conduit stays with pulses running to
//   the station). A charge ring on the plane fills while the beam holds the receiver. The look comes
//   from `relayLook(owner)` (the Guild relay of M4d is a data change there).
// - Live mines (`props/pirate_mine.glb`): instanced shells and spinning cores on the plane, a red lamp
//   pulsing slowly, a fast blink when armed; a warning ring (the arming distance) fades in as the ship
//   comes near, and turns into the blast circle while the fuse runs; the blast is the usual explosion.
// - The derelict's local ion storm: the edge of its 400 u circle, ion motes in the space around the ship
//   and crackling arcs (near the ship and over the station's hull), fading in and out with the window.
// - Graveyard wrecks are ordinary wrecks (combat layer); their dressing is the scatter layer's.
// - Guild relay masts (M4d, `guild_relay_mast.glb`, one per lane from `guildRelaySites`): the mast and its
//   `Relay_Broken` damage overlay are two instanced parts – the overlay only on broken masts. Broken: dark,
//   the torn cable crackling; repaired: an amber standby blink (and the "aim here" twinkle on the lens);
//   charging and lit in the Guild colours (the charge ring is the relays' own); a secured mast's beacon
//   breathes. While a hold runs its circle shows as dots on the plane near the ship and a ring of lamps
//   pulses around the mast's foot (relayLook.ts `holdRing`).
//
// Budget (High): a derelict with 3 relays ≈ 7 draw calls in the main pass (hull, windows, beacons,
// drift, relays, glow sprites, charge ring); a graveyard's mines 2 + rings 1; Guild relay masts 2 (+ the
// shared glow batch). Every material is in the warm-up zoo (`warmUp`). Reduced motion: no pulses, flicker, tumble,
// pulses along conduits or arcs – steady levels that read the same states. Quality: storm motes and
// arcs scale with the preset's particles.
import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  DoubleSide,
  DynamicDrawUsage,
  Float32BufferAttribute,
  Group,
  InstancedMesh,
  LineBasicMaterial,
  LineSegments,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  Quaternion,
  RingGeometry,
  ShaderMaterial,
  Vector3,
  type Material,
} from 'three';
import { DERELICT, DERELICT_LAYOUTS, DERELICT_MODELS, MINE, RELAY, RELAY_LAYOUT, type DerelictModel } from '../../data/sites';
import { guildRelaySites } from '../../sim/guild/relaySites';
import type { GuildRelaySite } from '../../sim/guild/types';
import { length, sub, type Vec2 } from '../../sim/math/vec2';
import { clampPowered, relaysLit } from '../../sim/sites/berth';
import { siteStorms } from '../../sim/sites/derelict';
import { liveMines } from '../../sim/sites/mines';
import { forSitesNear, relayById } from '../../sim/sites/placement';
import { receiverPos, relayCharge } from '../../sim/sites/relays';
import type { DerelictSite, GraveyardSite, RelaySite } from '../../sim/sites/types';
import type { SimEvent, SimState } from '../../sim/Simulation';
import type { ModelLibrary } from '../assets/ModelLibrary';
import { loadModelScene } from '../assets/ModelLibrary';
import { createModelLoader } from '../assets/gltf';
import { simToWorld } from '../coords';
import { dashedRing } from '../FlightMarkers';
import { Effects, FX_HEIGHT } from '../fx/Effects';
import type { FxModels } from '../fx/fxModels';
import { SpriteBatch } from '../fx/Particles';
import { vfxTexture } from '../fx/textures';
import type { QualityPreset } from '../quality';
import { cloneWithRim } from '../rimLight';
import { batchKey, mergeSources, type BatchSource } from '../shipBatch';
import type { WarmUpZoo } from '../warmup';
import { arcDots, brokenSpark, dockLamp, guildRelayLamp, holdEdgeFade, holdRing, mineLamp, mineWarning, noise2, relayLamp, relayLook, stormFade, windowLevel, type GuildRelayStage, type Rgb } from './relayLook';

const PATHS = {
  relay: 'assets/models/derelicts/derelict_relay.glb',
  mine: 'assets/models/props/pirate_mine.glb',
  guildMast: 'assets/models/derelicts/guild_relay_mast.glb',
} as const;
const derelictPath = (m: DerelictModel): string => `assets/models/derelicts/derelict_${m}.glb`;
type ModelKey = DerelictModel | keyof typeof PATHS;
const pathOf = (k: ModelKey): string => (k in PATHS ? PATHS[k as keyof typeof PATHS] : derelictPath(k as DerelictModel));
/** Its model files – the boot list downloads them ahead of the game (assets/bootAssets.ts). */
export const SITE_MODEL_PATHS: readonly string[] = [...DERELICT_MODELS.map(derelictPath), ...Object.values(PATHS)];

/** Derelicts (with their relays) and graveyards whose centre lies this close to the ship are drawn. */
const VIEW_RANGE = 560;
/** The visible site list is refreshed after the ship moved this far (or every REFRESH_SECONDS). */
const REFRESH_MOVE = 20;
const REFRESH_SECONDS = 0.5;
/** Instance capacity: relays (3 per derelict) and live mines in view. */
const RELAY_CAP = 12;
const MINE_CAP = 32;
/** Guild relay masts: one per lane. */
const GUILD_CAP = 2;
/** The hold circle: dots every HOLD_DOT_GAP u within HOLD_DOT_SPAN u of arc around the point nearest the ship. */
const HOLD_DOT_GAP = 4;
const HOLD_DOT_SPAN = 150;
/** The ring of lamps around a holding mast's foot (u from the mast, lamps). */
const HOLD_FOOT_RADIUS = RELAY_LAYOUT.clearRadius + 3;
const HOLD_FOOT_LAMPS = 16;
/** Halo sizes (u) of a lit Guild mast: the lamp, the receiver lens, a secured mast's breathing beacon. */
const GUILD_LIT = { lamp: 0.9, lens: 0.7, beacon: 1.7 } as const;
/** Sparks of a broken mast's torn cable and the ember on its end. */
const SPARK: Rgb = [3.6, 2.1, 0.8];
/** The mine model's bounding radius (props.json) – scaled up to the mine's collision circle. */
const MINE_MODEL_RADIUS = 0.58;
const MINE_SCALE = MINE.radius / MINE_MODEL_RADIUS;
/** Mine core spin (rad/s) and bob (u) – the manifest's "spin around local +Y, ~30 deg/s". */
const MINE_SPIN = (30 * Math.PI) / 180;
const MINE_BOB = 0.12;
/** The warning ring fades in from this hull distance to the arming distance. */
const MINE_WARN_FROM = MINE.armRange + 32;
/** Height of the plane markers (charge ring, mine rings) – just under the flight markers. */
const MARK_Y = 0.16;
/** Where the conduits of the relays end: above the station's centre. */
const HUB_HEIGHT = 2.4;
/** Emission gain of the windows (on the atlas's der_window emission) at level 1, and of the beacons. */
const WINDOW_GAIN = 9;
const BEACON_GAIN = 14;
/** Base colour of the beacon lamps while the station has no power. */
const BEACON_DEAD = 0.22;
/** Alpha of the conduit line of a relay being charged (× the lamp pulse); pulses along a lit conduit and their speed (u/s). */
const CONDUIT_CHARGE = 0.08;
const CONDUIT_PULSES = 3;
const CONDUIT_SPEED = 18;
/** Unpowered receivers twinkle ("aim here") when the ship is this close. */
const AIM_HINT_RANGE = 110;
/** Storm look. */
const STORM_EDGE_WIDTH = 1.8;
const STORM_MOTE_CELL = 9;
const STORM_MOTE_REACH = 60;
/** Speed of the ion streaks along the storm's wind (u/s). */
const STORM_WIND_SPEED = 14;
const STORM_ARC_REACH = 42;
const ARC_CAP = 12;
const ARC_SEGMENTS = 7;
const ION: Rgb = [0.75, 1.15, 3.2];
const ION_MOTE: Rgb = [0.6, 0.75, 2.2];
const DOCK_RED: Rgb = [4, 0.5, 0.4];
const DOCK_GREEN: Rgb = [0.5, 4, 1.2];
const MINE_RED: Rgb = [4.2, 0.55, 0.35];
/** Lit windows (der_window emission #FFB45A, HDR). */
const WINDOW_WARM: Rgb = [3.2, 1.75, 0.6];
/** Window glow points per derelict model. */
const WINDOW_GLOWS = 9;
const AXIS_Y = new Vector3(0, 1, 0);

/** A merged piece of a model: geometry in the model's frame, its source material. */
interface Part {
  geometry: BufferGeometry;
  material: Material;
}

interface DerelictTemplate {
  body: Part[];
  windows: Part[];
  beacons: Part[];
  /** The drifting piece in its own frame (pivot = node origin) and where it hangs. */
  drift: { parts: Part[]; position: Vector3; quaternion: Quaternion } | null;
  /** Beacon lamp positions in the model frame (0 / 1 = dock red / green). */
  lamps: Vector3[];
  /** A few points on the window strips (model frame) – warm glows when the lights come back. */
  windowGlows: Vector3[];
}

interface DerelictEntry {
  site: DerelictSite;
  group: Group;
  real: boolean;
  windows: MeshStandardMaterial[];
  beacons: MeshStandardMaterial[];
  /** Emission of each window / beacon material at level 1. */
  windowBase: number[];
  beaconBase: number[];
  drift: Group | null;
  driftAxis: Vector3;
  driftRate: number;
  /** World positions of the dock lamps (red, green) and of the window glows. */
  dockLamps: Vector3[];
  windowGlows: Vector3[];
  hub: Vector3;
  owned: (Material | BufferGeometry)[];
}

interface Flash {
  pos: Vector3;
  color: Rgb;
  size: number;
  age: number;
  life: number;
}

interface Arc {
  a: Vector3;
  b: Vector3;
  age: number;
  life: number;
}

/** Collects the meshes of `root` that `pick` accepts into merged parts (one per material and layout), in `root`'s frame. */
function bakeParts(root: Object3D, pick: (mesh: Mesh) => boolean): Part[] {
  root.updateMatrixWorld(true);
  const toRoot = new Matrix4().copy(root.matrixWorld).invert();
  const groups = new Map<string, { material: Material; sources: BatchSource[] }>();
  root.traverse((o) => {
    if (!(o instanceof Mesh) || Array.isArray(o.material) || !pick(o)) return;
    const key = batchKey(o) ?? `solo:${o.uuid}`;
    let g = groups.get(key);
    if (!g) {
      g = { material: o.material as Material, sources: [] };
      groups.set(key, g);
    }
    g.sources.push({ geometry: o.geometry, matrix: new Matrix4().multiplyMatrices(toRoot, o.matrixWorld) });
  });
  return [...groups.values()].map((g) => {
    const geometry = mergeSources(g.sources);
    geometry.computeBoundingSphere();
    return { geometry, material: g.material };
  });
}

/**
 * Up to `count` vertex positions of the parts spread over them (each at least `gap` from the others) –
 * deterministic: walks the vertices with a fixed stride.
 */
export function spreadPoints(parts: readonly Part[], count: number, gap: number): Vector3[] {
  const out: Vector3[] = [];
  const v = new Vector3();
  for (const p of parts) {
    const pos = p.geometry.getAttribute('position');
    if (!pos) continue;
    const stride = Math.max(1, Math.floor(pos.count / (count * 2)));
    for (let i = 0; i < pos.count && out.length < count; i += stride) {
      v.fromBufferAttribute(pos, i);
      if (out.every((q) => q.distanceTo(v) >= gap)) out.push(v.clone());
    }
  }
  return out;
}

/** Position of a node in `root`'s frame. */
function nodePos(root: Object3D, node: Object3D): Vector3 {
  root.updateMatrixWorld(true);
  const toRoot = new Matrix4().copy(root.matrixWorld).invert();
  return new Vector3().setFromMatrixPosition(new Matrix4().multiplyMatrices(toRoot, node.matrixWorld));
}

const isUnder = (o: Object3D, name: RegExp): boolean => {
  for (let p: Object3D | null = o; p; p = p.parent) if (name.test(p.name)) return true;
  return false;
};

/** A copy of a palette material with its emission off (dead hulls, relay masts, mine shells – lamps are sprites). */
function darkMaterial(m: Material): Material {
  const c = cloneWithRim(m);
  if (c instanceof MeshStandardMaterial) c.emissiveIntensity = 0;
  return c;
}

const VERTEX_RING = /* glsl */ `
attribute float aFrac;
varying float vFrac;
void main() {
  vFrac = aFrac;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const FRAGMENT_RING = /* glsl */ `
uniform float uProgress;
uniform vec3 uFill;
uniform vec3 uEmpty;
uniform float uAlpha;
varying float vFrac;
void main() {
  float on = step(vFrac, uProgress);
  vec3 c = mix(uEmpty * 0.55, uFill, on);
  gl_FragColor = vec4(c, uAlpha * (0.3 + 0.7 * on));
}`;

/**
 * A dashed unit ring on the plane whose dashes carry their share of the circle (`aFrac`, 0..1 clockwise
 * from the top of the screen) – the charge ring fills dash by dash.
 */
export function progressRingGeometry(dashes: number, fill: number, inner: number, outer: number): BufferGeometry {
  const pos: number[] = [];
  const frac: number[] = [];
  const seg = 3;
  const at = (r: number, f: number): number[] => {
    // sim angle: from +y (screen up) clockwise; three: (cos a, 0, -sin a)
    const a = Math.PI / 2 - f * Math.PI * 2;
    return [Math.cos(a) * r, 0, -Math.sin(a) * r];
  };
  for (let d = 0; d < dashes; d++) {
    const f0 = d / dashes;
    const f1 = f0 + fill / dashes;
    const mid = (d + 0.5) / dashes;
    for (let s = 0; s < seg; s++) {
      const t0 = f0 + ((f1 - f0) * s) / seg;
      const t1 = f0 + ((f1 - f0) * (s + 1)) / seg;
      const a = at(inner, t0);
      const b = at(outer, t0);
      const c = at(outer, t1);
      const e = at(inner, t1);
      pos.push(...a, ...b, ...c, ...a, ...c, ...e);
      for (let k = 0; k < 6; k++) frac.push(mid);
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(pos, 3));
  g.setAttribute('aFrac', new Float32BufferAttribute(frac, 1));
  return g;
}

export interface SiteView {
  reducedMotion: boolean;
}

export interface SiteLayerStats {
  derelicts: number;
  relays: number;
  mines: number;
  rings: number;
  storms: number;
  arcs: number;
  charging: string | null;
  /** Guild relay masts drawn and how many of them show the broken overlay (M4d). */
  guildMasts: number;
  guildBroken: number;
}

export class SiteLayer {
  readonly object = new Group();
  /** Time scale of the effects (e2e screenshots slow them down). */
  timeScale = 1;
  private readonly loads = new Map<ModelKey, Promise<void>>();
  private readonly derelictTemplates = new Map<DerelictModel, DerelictTemplate>();
  private relayParts: Part[] | null = null;
  private relayLampLocal = new Vector3(0.6, 0.92, 0);
  private mineShell: Part[] | null = null;
  private mineCore: Part[] | null = null;
  private mineLampLocal = new Vector3(0, 0.42, 0);
  private guildLampLocal = new Vector3(1, 0.96, 0);
  /**
   * Where a broken Guild mast crackles (model frame): the burst edge on the battery's top (seen from the
   * flight camera; art/blender/guild_relay.py `BatBurstEdge`) and the cable's torn end (the overlay's lowest point).
   */
  private readonly guildSparkLocal = [new Vector3(0.68, 0.64, 0.34), new Vector3(-0.68, -0.45, 0.7)];
  private guildMastMeshes: InstancedMesh[] = [];
  private guildBrokenMeshes: InstancedMesh[] = [];
  /** Guild relay masts within view and the key (ids + broken or not) their instances were built for. */
  private guildSites: readonly GuildRelaySite[] = [];
  private guildKey = '';
  private readonly derelicts = new Map<string, DerelictEntry>();
  private relayMeshes: InstancedMesh[] = [];
  private mineShellMeshes: InstancedMesh[] = [];
  private mineCoreMeshes: InstancedMesh[] = [];
  /** Template-level materials and geometries (freed on dispose). */
  private readonly shared: (Material | BufferGeometry)[] = [];
  /** Dark copies of the template materials (one per source). */
  private readonly darkCopies = new Map<Material, Material>();
  private readonly glow = new SpriteBatch({ texture: vfxTexture('glow_soft'), additive: true, max: 384, renderOrder: 13 });
  private readonly chargeRing: Mesh;
  private readonly chargeMat: ShaderMaterial;
  private readonly mineRings: InstancedMesh;
  private readonly stormEdge: Mesh;
  private readonly stormEdgeMat: MeshBasicMaterial;
  private readonly arcLines: LineSegments;
  private readonly arcPos: BufferAttribute;
  private readonly arcCol: BufferAttribute;
  private readonly effects: Effects | null;
  private disposed = false;
  private time = 0;
  private particles = 1;
  private reducedMotion = false;
  // visible sets (refreshed when the ship moved)
  private lastRefresh: Vec2 | null = null;
  private refreshAge = 0;
  private visibleDerelicts: DerelictSite[] = [];
  private visibleGraveyards: GraveyardSite[] = [];
  private relaysDirty = true;
  // live state of the effects
  private readonly flashes: Flash[] = [];
  private readonly arcs: Arc[] = [];
  private arcClock = 0;
  private ringFlash: { relay: RelaySite; age: number } | null = null;
  private last: SiteLayerStats = { derelicts: 0, relays: 0, mines: 0, rings: 0, storms: 0, arcs: 0, charging: null, guildMasts: 0, guildBroken: 0 };
  private readonly v = new Vector3();
  private readonly v2 = new Vector3();
  private readonly v3 = new Vector3();
  private readonly hubTmp = new Vector3();
  private readonly c = new Color();
  private readonly m4 = new Matrix4();
  private readonly q = new Quaternion();
  private readonly s = new Vector3();

  constructor(
    private readonly library: ModelLibrary,
    fxModels: FxModels | null = null,
  ) {
    this.object.name = 'sites';
    void this.library;
    // charge ring: 20 dashes around the relay's foot
    this.chargeMat = new ShaderMaterial({
      vertexShader: VERTEX_RING,
      fragmentShader: FRAGMENT_RING,
      uniforms: { uProgress: { value: 0 }, uFill: { value: new Color() }, uEmpty: { value: new Color() }, uAlpha: { value: 0 } },
      transparent: true,
      depthTest: false,
      depthWrite: false,
      side: DoubleSide,
      forceSinglePass: true,
    });
    this.chargeRing = new Mesh(this.own(progressRingGeometry(20, 0.7, RELAY_LAYOUT.clearRadius + 0.6, RELAY_LAYOUT.clearRadius + 1.25)), this.own(this.chargeMat));
    this.chargeRing.renderOrder = 19;
    this.chargeRing.visible = false;
    this.chargeRing.frustumCulled = false;
    // mine rings: one dashed unit ring, instanced (colour × alpha, additive)
    const ringMat = this.own(
      new MeshBasicMaterial({ color: 0xffffff, transparent: true, blending: AdditiveBlending, depthTest: false, depthWrite: false, side: DoubleSide, forceSinglePass: true }),
    );
    this.mineRings = new InstancedMesh(this.own(dashedRing(28, 0.6, 0.2 / MINE.armRange)), ringMat, MINE_CAP);
    this.mineRings.instanceMatrix.setUsage(DynamicDrawUsage);
    this.mineRings.setColorAt(0, this.c.setRGB(0, 0, 0));
    this.mineRings.instanceColor!.setUsage(DynamicDrawUsage);
    this.mineRings.count = 0;
    this.mineRings.renderOrder = 19;
    this.mineRings.frustumCulled = false;
    // the storm's edge: a thin band on the plane, scaled to the storm's radius
    this.stormEdgeMat = this.own(
      new MeshBasicMaterial({ color: new Color(ION[0], ION[1], ION[2]), transparent: true, opacity: 0, blending: AdditiveBlending, depthWrite: false, side: DoubleSide, forceSinglePass: true }),
    );
    // a dashed boundary (the plane markers' language), STORM_EDGE_WIDTH wide at the storm's radius
    this.stormEdge = new Mesh(this.own(dashedRing(220, 0.55, STORM_EDGE_WIDTH / DERELICT.storm.radius)), this.stormEdgeMat);
    this.stormEdge.visible = false;
    this.stormEdge.frustumCulled = false;
    this.stormEdge.renderOrder = 12;
    this.stormEdge.userData.noShadow = true;
    // storm arcs: jagged line segments, colour × alpha per vertex (additive)
    const arcGeo = this.own(new BufferGeometry());
    this.arcPos = new BufferAttribute(new Float32Array(ARC_CAP * ARC_SEGMENTS * 2 * 3), 3).setUsage(DynamicDrawUsage);
    this.arcCol = new BufferAttribute(new Float32Array(ARC_CAP * ARC_SEGMENTS * 2 * 3), 3).setUsage(DynamicDrawUsage);
    arcGeo.setAttribute('position', this.arcPos);
    arcGeo.setAttribute('color', this.arcCol);
    arcGeo.setDrawRange(0, 0);
    this.arcLines = new LineSegments(arcGeo, this.own(new LineBasicMaterial({ vertexColors: true, transparent: true, blending: AdditiveBlending, depthWrite: false })));
    this.arcLines.frustumCulled = false;
    this.arcLines.renderOrder = 13;
    this.arcLines.userData.noShadow = true;
    this.effects = fxModels ? new Effects(fxModels) : null;
    this.object.add(this.chargeRing, this.mineRings, this.stormEdge, this.arcLines, this.glow.mesh);
    if (this.effects) this.object.add(this.effects.object);
  }

  private own<T extends Material | BufferGeometry>(x: T): T {
    this.shared.push(x);
    return x;
  }

  private dark(m: Material): Material {
    let d = this.darkCopies.get(m);
    if (!d) {
      d = this.own(darkMaterial(m));
      this.darkCopies.set(m, d);
    }
    return d;
  }

  // ---------------------------------------------------------------------------
  // models

  /** Loads a model once; resolves when it is in (or failed – then a placeholder stays). */
  private request(key: ModelKey): Promise<void> {
    const known = this.loads.get(key);
    if (known || this.disposed) return known ?? Promise.resolve();
    const load = (async () => {
      const scene = await loadModelScene(createModelLoader(), pathOf(key));
      if (!scene || this.disposed) return;
      if (key === 'relay') this.takeRelay(scene);
      else if (key === 'mine') this.takeMine(scene);
      else if (key === 'guildMast') this.takeGuildMast(scene);
      else {
        this.derelictTemplates.set(key, this.takeDerelict(scene));
        // rebuild placeholders of this model
        for (const [id, e] of [...this.derelicts]) if (!e.real && e.site.model === key) this.removeDerelict(id);
      }
    })();
    this.loads.set(key, load);
    return load;
  }

  private takeDerelict(scene: Object3D): DerelictTemplate {
    const drift = scene.getObjectByName('Derelict_Drift') ?? null;
    const isDrift = (m: Mesh) => drift !== null && isUnder(m, /^Derelict_Drift$/);
    const isWindow = (m: Mesh) => isUnder(m, /^Derelict_Windows$/);
    const isBeacon = (m: Mesh) => isUnder(m, /^beacon_\d+$/);
    const body = bakeParts(scene, (m) => !isDrift(m) && !isWindow(m) && !isBeacon(m));
    const windows = bakeParts(scene, isWindow);
    const beacons = bakeParts(scene, isBeacon);
    const lamps: Vector3[] = [];
    for (let i = 0; i < 2; i++) {
      const b = scene.getObjectByName(`beacon_${i}`);
      if (b) lamps.push(nodePos(scene, b));
    }
    let driftOut: DerelictTemplate['drift'] = null;
    if (drift) {
      const parts = bakeParts(drift, () => true);
      const at = new Matrix4();
      scene.updateMatrixWorld(true);
      at.copy(scene.matrixWorld).invert().multiply(drift.matrixWorld);
      const position = new Vector3();
      const quaternion = new Quaternion();
      at.decompose(position, quaternion, new Vector3());
      driftOut = { parts, position, quaternion };
    }
    const t: DerelictTemplate = { body, windows, beacons, drift: driftOut, lamps, windowGlows: spreadPoints(windows, WINDOW_GLOWS, 3) };
    for (const p of [...body, ...windows, ...beacons, ...(driftOut?.parts ?? [])]) this.shared.push(p.geometry);
    return t;
  }

  private takeRelay(scene: Object3D): void {
    const lamp = scene.getObjectByName('relay_lamp');
    if (lamp) this.relayLampLocal = nodePos(scene, lamp);
    this.relayParts = bakeParts(scene, () => true);
    for (const p of this.relayParts) this.shared.push(p.geometry);
    this.relayMeshes = this.relayParts.map((p) => this.instanced(p, RELAY_CAP));
    this.relaysDirty = true;
  }

  /** The Guild relay mast: the mast (repaired look) and the `Relay_Broken` overlay as separate instanced parts. */
  private takeGuildMast(scene: Object3D): void {
    const lamp = scene.getObjectByName('relay_lamp');
    if (lamp) this.guildLampLocal = nodePos(scene, lamp);
    const broken = (m: Mesh) => isUnder(m, /^Relay_Broken$/);
    const mast = bakeParts(scene, (m) => !broken(m));
    const overlay = bakeParts(scene, broken);
    // the cable hangs down below the base: its torn end is the overlay's lowest point
    const v = new Vector3();
    let low = Infinity;
    for (const p of overlay) {
      const pos = p.geometry.getAttribute('position');
      for (let i = 0; i < (pos?.count ?? 0); i++) {
        v.fromBufferAttribute(pos!, i);
        if (v.y < low) {
          low = v.y;
          this.guildSparkLocal[1]!.copy(v);
        }
      }
    }
    for (const p of [...mast, ...overlay]) this.shared.push(p.geometry);
    this.guildMastMeshes = mast.map((p) => this.instanced(p, GUILD_CAP));
    this.guildBrokenMeshes = overlay.map((p) => this.instanced(p, GUILD_CAP));
    this.guildKey = '';
  }

  private takeMine(scene: Object3D): void {
    const lamp = scene.getObjectByName('beacon_0');
    if (lamp) this.mineLampLocal = nodePos(scene, lamp);
    const core = scene.getObjectByName('Mine_Core');
    this.mineShell = bakeParts(scene, (m) => !isUnder(m, /^Mine_Core$/));
    this.mineCore = core ? bakeParts(core, () => true) : [];
    for (const p of [...this.mineShell, ...this.mineCore]) this.shared.push(p.geometry);
    this.mineShellMeshes = this.mineShell.map((p) => this.instanced(p, MINE_CAP, true));
    this.mineCoreMeshes = this.mineCore.map((p) => this.instanced(p, MINE_CAP, true));
    // a mine is ~2 u wide: its AO pre-pass draws would cost more than they show; far out (the far tier,
    // env/ShadowRig.ts) its shadow too
    for (const m of [...this.mineShellMeshes, ...this.mineCoreMeshes]) {
      m.userData.noAO = true;
      m.userData.farLite = true;
    }
  }

  /** An InstancedMesh of a part with its dark material (empty until filled). */
  private instanced(p: Part, cap: number, dynamic = false): InstancedMesh {
    const mesh = new InstancedMesh(p.geometry, this.dark(p.material), cap);
    if (dynamic) mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    mesh.count = 0;
    this.object.add(mesh);
    return mesh;
  }

  // ---------------------------------------------------------------------------
  // derelict entries

  private buildDerelict(site: DerelictSite): DerelictEntry {
    void this.request(site.model);
    void this.request('relay');
    const owned: (Material | BufferGeometry)[] = [];
    const group = new Group();
    group.name = site.id;
    simToWorld(site.pos, 0, group.position);
    group.rotation.y = site.angle;
    const t = this.derelictTemplates.get(site.model);
    const windows: MeshStandardMaterial[] = [];
    const beacons: MeshStandardMaterial[] = [];
    const windowBase: number[] = [];
    const beaconBase: number[] = [];
    let drift: Group | null = null;
    const dockLamps: Vector3[] = [];
    const windowGlows: Vector3[] = [];
    if (t) {
      for (const p of t.body) group.add(new Mesh(p.geometry, this.dark(p.material)));
      const lit = (list: Part[], mats: MeshStandardMaterial[], base: number[]) => {
        for (const p of list) {
          const m = cloneWithRim(p.material);
          owned.push(m);
          const mesh = new Mesh(p.geometry, m);
          // thin strips / small lamps on the hull: no shadow-map or AO draw of their own
          mesh.userData.noShadow = true;
          mesh.userData.noAO = true;
          group.add(mesh);
          if (m instanceof MeshStandardMaterial) {
            base.push(m.emissiveIntensity);
            m.emissiveIntensity = 0;
            mats.push(m);
          }
        }
      };
      lit(t.windows, windows, windowBase);
      lit(t.beacons, beacons, beaconBase);
      if (t.drift) {
        drift = new Group();
        drift.position.copy(t.drift.position);
        drift.quaternion.copy(t.drift.quaternion);
        for (const p of t.drift.parts) drift.add(new Mesh(p.geometry, this.dark(p.material)));
        group.add(drift);
      }
      group.updateMatrixWorld(true);
      for (const l of t.lamps) dockLamps.push(l.clone().applyMatrix4(group.matrixWorld));
      for (const w of t.windowGlows) windowGlows.push(w.clone().applyMatrix4(group.matrixWorld));
    } else {
      // placeholder until the model is in: a dark drum of the station's radius
      const r = DERELICT_LAYOUTS[site.model].radius * 0.7;
      const g = new RingGeometry(r * 0.4, r, 18).rotateX(-Math.PI / 2);
      const m = new MeshStandardMaterial({ color: 0x3a3833, roughness: 0.9 });
      owned.push(g, m);
      group.add(new Mesh(g, m));
    }
    const rnd = noise2(site.cx * 31 + 7, site.cy * 17 - 3);
    const driftAxis = new Vector3(rnd - 0.5, 1, noise2(site.cy, site.cx) - 0.5).normalize();
    return {
      site,
      group,
      real: t !== undefined,
      windows,
      beacons,
      windowBase,
      beaconBase,
      drift,
      driftAxis,
      driftRate: (0.05 + 0.06 * rnd) * (rnd < 0.5 ? -1 : 1),
      dockLamps,
      windowGlows,
      hub: simToWorld(site.pos, HUB_HEIGHT, new Vector3()),
      owned,
    };
  }

  private removeDerelict(id: string): void {
    const e = this.derelicts.get(id);
    if (!e) return;
    this.object.remove(e.group);
    this.derelicts.delete(id);
    for (const x of e.owned) x.dispose();
    this.relaysDirty = true;
  }

  // ---------------------------------------------------------------------------
  // events

  /** Effects from the step's sim events: a relay lit, a mine blown (the fuse is read from the sim). */
  onEvents(events: readonly SimEvent[]): void {
    for (const e of events) {
      switch (e.type) {
        case 'relayPowered': {
          const relay = this.relayOf(e.id);
          if (!relay) break;
          const look = relayLook(relay.owner);
          this.flashes.push({ pos: simToWorld(receiverPos(relay), RELAY_LAYOUT.powerTarget.z, new Vector3()), color: look.lit, size: 7, age: 0, life: 0.9 });
          this.ringFlash = { relay, age: 0 };
          break;
        }
        case 'mineExploded': {
          const at = simToWorld(e.pos, FX_HEIGHT, new Vector3());
          this.effects?.shipExplosion(at, new Vector3(), 2.4, 'pirate');
          this.flashes.push({ pos: at, color: MINE_RED, size: MINE.blastRadius * 1.6, age: 0, life: 0.45 });
          break;
        }
        default:
          break;
      }
    }
  }

  /** A relay in view by id (or from the seed for one just out of view). */
  private relayOf(id: string): RelaySite | null {
    for (const d of this.visibleDerelicts) for (const r of d.relays) if (r.id === id) return r;
    return this.seed === null ? null : relayById(this.seed, id);
  }

  private seed: number | null = null;

  // ---------------------------------------------------------------------------
  // per frame

  setQuality(preset: QualityPreset): void {
    this.particles = Math.max(0, preset.particles);
  }

  update(state: SimState, _alpha: number, frameDt: number, view: SiteView = { reducedMotion: false }): void {
    const dt = frameDt * this.timeScale;
    this.time += dt;
    this.seed = state.seed;
    this.reducedMotion = view.reducedMotion;
    const pos = state.player.body.pos;
    this.refresh(state, pos, dt);
    this.glow.begin();
    this.updateDerelicts(state, dt);
    this.updateRelays(state);
    this.updateGuildRelays(state);
    this.updateChargeRing(state, dt);
    const mines = this.updateMines(state);
    const storms = this.updateStorms(state, dt);
    this.updateFlashes(dt);
    this.glow.end();
    this.effects?.update(dt);
    const charge = state.sites.charge;
    this.last = {
      derelicts: this.derelicts.size,
      relays: this.relayMeshes[0]?.count ?? 0,
      mines,
      rings: this.mineRings.count,
      storms,
      arcs: this.arcs.length,
      charging: charge ? charge.id : null,
      guildMasts: this.guildMastMeshes[0]?.count ?? 0,
      guildBroken: this.guildBrokenMeshes[0]?.count ?? 0,
    };
  }

  /** The derelicts and graveyards in view (refreshed when the ship moved – the walk is cheap but not free). */
  private refresh(state: SimState, pos: Vec2, dt: number): void {
    this.refreshAge += dt;
    if (this.lastRefresh && length(sub(pos, this.lastRefresh)) < REFRESH_MOVE && this.refreshAge < REFRESH_SECONDS) return;
    this.lastRefresh = { ...pos };
    this.refreshAge = 0;
    const derelicts: DerelictSite[] = [];
    const graveyards: GraveyardSite[] = [];
    forSitesNear(state.seed, pos, VIEW_RANGE, (s) => (s.kind === 'derelict' ? derelicts.push(s) : graveyards.push(s)));
    this.visibleGraveyards = graveyards;
    // the Guild relay masts (two at most – the list is cached per seed); a running hold's circle reaches far
    const guild = guildRelaySites(state.seed).filter((g) => Math.hypot(g.pos.x - pos.x, g.pos.y - pos.y) < VIEW_RANGE || state.guild.hold?.lane === g.lane);
    if (guild.length !== this.guildSites.length || guild.some((g, i) => g !== this.guildSites[i])) this.guildSites = guild;
    if (guild.length > 0) void this.request('guildMast');
    const keep = new Set(derelicts.map((d) => d.id));
    for (const id of [...this.derelicts.keys()]) if (!keep.has(id)) this.removeDerelict(id);
    for (const d of derelicts) {
      if (this.derelicts.has(d.id)) continue;
      const e = this.buildDerelict(d);
      this.derelicts.set(d.id, e);
      this.object.add(e.group);
      this.relaysDirty = true;
    }
    if (derelicts.length !== this.visibleDerelicts.length || derelicts.some((d, i) => d.id !== this.visibleDerelicts[i]?.id)) this.relaysDirty = true;
    this.visibleDerelicts = derelicts;
    if (graveyards.length > 0) void this.request('mine');
  }

  private add(pos: Vector3, size: number, color: Rgb, alpha: number, axis: Vector3 | null = null, length = size): void {
    if (alpha <= 0.004) return;
    this.c.setRGB(color[0], color[1], color[2]);
    this.glow.add(pos, axis, axis ? length : size, size, 0, this.c, Math.min(1, alpha));
  }

  private updateDerelicts(state: SimState, dt: number): void {
    const t = this.time;
    const rm = this.reducedMotion;
    for (const e of this.derelicts.values()) {
      const site = e.site;
      const lit = relaysLit(state, site);
      const powered = clampPowered(state, site);
      const seed = site.cx * 7919 + site.cy;
      const level = windowLevel(lit, RELAY.count, t, seed, rm);
      e.windows.forEach((m, i) => (m.emissiveIntensity = (e.windowBase[i] ?? 1) * WINDOW_GAIN * level));
      // the window strips are thin and face sideways – soft warm glows make the lights read from above
      if (level > 0) e.windowGlows.forEach((p, i) => this.add(p, 1.5 + (i % 3) * 0.4, WINDOW_WARM, 0.32 * level * (rm ? 1 : 0.8 + 0.2 * noise2(i, Math.floor(t * 3)))));
      const berthed = state.sites.berth === site.id;
      e.dockLamps.forEach((p, i) => {
        if (!powered) return;
        const on = berthed ? 1 : dockLamp(t, i, rm);
        this.add(p, 1.15, i === 0 ? DOCK_RED : DOCK_GREEN, 0.6 * on);
      });
      const beacon = powered ? (berthed ? 1 : dockLamp(t, 0, rm)) : 0;
      e.beacons.forEach((m, i) => {
        m.emissiveIntensity = (e.beaconBase[i] ?? 1) * BEACON_GAIN * beacon;
        // a dead lamp's glass is dark, not red / green
        m.color.setScalar(powered ? 1 : BEACON_DEAD);
      });
      if (e.drift && !rm) e.drift.rotateOnAxis(e.driftAxis, e.driftRate * dt);
    }
  }

  /** Relay masts (instanced), their lamps and receivers, the power conduits to the station. */
  private updateRelays(state: SimState): void {
    const t = this.time;
    const rm = this.reducedMotion;
    const player = state.player.body.pos;
    if (this.relaysDirty && this.relayMeshes.length > 0) {
      let n = 0;
      for (const d of this.visibleDerelicts) {
        for (const r of d.relays) {
          if (n >= RELAY_CAP) break;
          this.m4.compose(simToWorld(r.pos, 0, this.v), this.q.setFromAxisAngle(AXIS_Y, r.angle), this.s.set(1, 1, 1));
          for (const m of this.relayMeshes) m.setMatrixAt(n, this.m4);
          n++;
        }
      }
      for (const m of this.relayMeshes) {
        m.count = n;
        m.instanceMatrix.needsUpdate = true;
        m.computeBoundingSphere();
      }
      this.relaysDirty = false;
    }
    for (const d of this.visibleDerelicts) {
      const entry = this.derelicts.get(d.id);
      const hub = entry?.hub ?? simToWorld(d.pos, HUB_HEIGHT, this.hubTmp);
      for (const r of d.relays) {
        const look = relayLook(r.owner);
        const charge = relayCharge(state, r.id);
        const lamp = relayLamp(charge, t, rm);
        // the mast lamp
        const lampPos = this.v.copy(this.relayLampLocal).applyAxisAngle(AXIS_Y, r.angle);
        lampPos.x += r.pos.x;
        lampPos.z += -r.pos.y;
        if (lamp.state !== 'dark') this.add(lampPos, lamp.state === 'lit' ? 1.3 : 1.1 + 0.6 * charge, lamp.state === 'lit' ? look.lit : look.charge, 0.85 * lamp.intensity);
        // the receiver lens
        const rec = simToWorld(receiverPos(r), RELAY_LAYOUT.powerTarget.z, this.v2);
        if (lamp.state === 'charging') {
          this.add(rec, 1.2 + 2.6 * charge, look.charge, 0.35 + 0.55 * lamp.intensity);
        } else if (lamp.state === 'lit') {
          this.add(rec, 1.1, look.lit, 0.55);
        } else if (Math.hypot(r.pos.x - player.x, r.pos.y - player.y) < AIM_HINT_RANGE) {
          // unpowered: a faint twinkle on the lens – "aim here"
          const k = rm ? 0.5 : 0.5 + 0.5 * Math.sin(t * 2.2 + r.angle * 3);
          this.add(rec, 0.9, look.charge, 0.12 + 0.18 * k);
        }
        // the power conduit to the station: grows while charging, stays (with pulses) once lit
        if (charge > 0) {
          const from = rec;
          const dir = this.v.copy(hub).sub(from);
          const full = dir.length();
          const len = full * (lamp.state === 'lit' ? 1 : charge);
          dir.normalize();
          const mid = this.v3.copy(from).addScaledVector(dir, len / 2);
          const color = lamp.state === 'lit' ? look.lit : look.charge;
          // charging: a faint line growing towards the station; lit: pulses running along it (the power
          // flows to the station) – no permanent line, so three lit relays do not web the screen
          if (lamp.state === 'charging') this.add(mid, 0.5, color, CONDUIT_CHARGE * (0.6 + 0.4 * lamp.intensity), dir, len);
          if (lamp.state === 'lit') {
            for (let k = 0; k < CONDUIT_PULSES; k++) {
              const f = rm ? (k + 0.5) / CONDUIT_PULSES : (t * (CONDUIT_SPEED / full) + k / CONDUIT_PULSES + r.angle) % 1;
              this.add(this.v3.copy(from).addScaledVector(dir, f * full), 0.9, color, (rm ? 0.25 : 0.5) * Math.sin(f * Math.PI));
            }
          } else if (lamp.state === 'charging') {
            // the tip of the growing conduit
            this.add(this.v3.copy(from).addScaledVector(dir, len), 1.4, color, 0.6 * lamp.intensity);
          }
        }
      }
    }
  }

  /** Guild relay masts (instanced, the broken overlay only on broken ones), their lamps and the hold circle. */
  private updateGuildRelays(state: SimState): void {
    const sites = this.guildSites;
    const stage = (g: GuildRelaySite): GuildRelayStage => state.guild.relays.get(g.lane)?.stage ?? 'broken';
    if (this.guildMastMeshes.length > 0) {
      let key = '';
      for (const g of sites) key += `${g.id}:${stage(g) === 'broken' ? 'b' : 'r'};`;
      if (key !== this.guildKey) {
        this.guildKey = key;
        let n = 0;
        let b = 0;
        for (const g of sites) {
          this.m4.compose(simToWorld(g.pos, 0, this.v), this.q.setFromAxisAngle(AXIS_Y, g.angle), this.s.set(1, 1, 1));
          for (const m of this.guildMastMeshes) m.setMatrixAt(n, this.m4);
          n++;
          if (stage(g) !== 'broken') continue;
          for (const m of this.guildBrokenMeshes) m.setMatrixAt(b, this.m4);
          b++;
        }
        const fill = (list: readonly InstancedMesh[], count: number) => {
          for (const m of list) {
            m.count = count;
            m.instanceMatrix.needsUpdate = true;
            if (count > 0) m.computeBoundingSphere();
          }
        };
        fill(this.guildMastMeshes, n);
        fill(this.guildBrokenMeshes, b);
      }
    }
    if (sites.length === 0) return;
    const t = this.time;
    const rm = this.reducedMotion;
    const player = state.player.body.pos;
    const look = relayLook('guild');
    const local = (p: Vector3, g: GuildRelaySite, out: Vector3): Vector3 => {
      out.copy(p).applyAxisAngle(AXIS_Y, g.angle);
      out.x += g.pos.x;
      out.z += -g.pos.y;
      return out;
    };
    for (const g of sites) {
      const st = stage(g);
      const charge = relayCharge(state, g.id);
      const lamp = guildRelayLamp(st, charge, t, rm);
      const lampPos = local(this.guildLampLocal, g, this.v);
      const rec = simToWorld(receiverPos(g.relay), RELAY_LAYOUT.powerTarget.z, this.v2);
      if (lamp.state === 'idle') this.add(lampPos, 1.0 + 0.4 * lamp.intensity, look.idle, 0.85 * lamp.intensity);
      else if (lamp.state === 'charging') {
        this.add(lampPos, 1.1 + 0.6 * charge, look.charge, 0.85 * lamp.intensity);
        this.add(rec, 1.2 + 2.6 * charge, look.charge, 0.35 + 0.55 * lamp.intensity);
      } else if (lamp.state === 'lit') {
        // the lamp and the lens glass only – small, so the mast stays readable at the flight camera
        this.add(lampPos, GUILD_LIT.lamp, look.lit, 0.8);
        this.add(rec, GUILD_LIT.lens, look.lit, 0.45);
        // a secured mast's beacon breathes slowly and faintly (the sector is the Guild's now)
        if (st === 'secured') this.add(lampPos, GUILD_LIT.beacon, look.lit, rm ? 0.12 : 0.08 + 0.07 * Math.sin(t * 1.3 + g.angle));
      }
      // a repaired mast waits for power: the lens twinkles "aim here" when the ship is near
      if (st === 'repaired' && charge <= 0 && Math.hypot(g.pos.x - player.x, g.pos.y - player.y) < AIM_HINT_RANGE) {
        const k = rm ? 0.5 : 0.5 + 0.5 * Math.sin(t * 2.2 + g.angle * 3);
        this.add(rec, 0.9, look.charge, 0.12 + 0.18 * k);
      }
      // broken: the burst battery edge and the torn cable's end glow and crackle
      if (st === 'broken') {
        this.guildSparkLocal.forEach((p, k) => {
          const end = local(p, g, this.v3);
          this.add(end, 0.45, SPARK, 0.6);
          const spark = brokenSpark(t + k * 0.37, g.id.charCodeAt(3) + k, rm);
          if (spark > 0) this.add(end, 0.55 + 0.9 * spark, SPARK, 0.9 * spark);
        });
      }
    }
    // the hold of a powered mast against the counterattack
    const hold = state.guild.hold;
    const site = hold ? sites.find((g) => g.lane === hold.lane) : undefined;
    if (!hold || !site) return;
    const ring = holdRing(hold.phase, t, rm);
    if (hold.phase !== 'idle') {
      for (let k = 0; k < HOLD_FOOT_LAMPS; k++) {
        const a = (k / HOLD_FOOT_LAMPS) * Math.PI * 2 + (rm ? 0 : t * 0.4);
        const chase = rm ? 1 : 0.55 + 0.45 * Math.max(0, Math.sin(a * 2 - t * 5));
        const at = simToWorld({ x: site.pos.x + Math.cos(a) * HOLD_FOOT_RADIUS, y: site.pos.y + Math.sin(a) * HOLD_FOOT_RADIUS }, MARK_Y, this.v);
        this.add(at, 1.2, ring.color, 0.6 * ring.alpha * chase);
      }
    }
    const fade = holdEdgeFade(Math.hypot(player.x - site.pos.x, player.y - site.pos.y), ring.radius);
    if (fade <= 0) return;
    arcDots(site.pos, ring.radius, player, HOLD_DOT_SPAN, HOLD_DOT_GAP).forEach((dot, k) => {
      const chase = rm ? 1 : 0.7 + 0.3 * Math.sin(k * 0.7 - t * 4);
      this.add(simToWorld(dot.pos, MARK_Y, this.v), 1.5, ring.color, 0.6 * fade * dot.fade * ring.alpha * chase);
    });
  }

  /** The charge ring of the relay being charged (and a short full-ring flash when it lights). */
  private updateChargeRing(state: SimState, dt: number): void {
    const charge = state.sites.charge;
    let relay: RelaySite | null = null;
    let progress = 0;
    let alpha = 0;
    if (charge) {
      relay = this.relayOf(charge.id);
      progress = Math.min(1, charge.progress / RELAY.powerSeconds);
      alpha = 0.9;
    } else if (this.ringFlash) {
      this.ringFlash.age += dt;
      const k = this.ringFlash.age / 1.2;
      if (k >= 1) this.ringFlash = null;
      else {
        relay = this.ringFlash.relay;
        progress = 1;
        alpha = this.reducedMotion ? 0.9 * (1 - k) : 0.9 * (1 - k) * (0.6 + 0.4 * Math.cos(this.ringFlash.age * 18));
      }
    }
    this.chargeRing.visible = relay !== null && alpha > 0;
    if (!relay || !this.chargeRing.visible) return;
    const look = relayLook(relay.owner);
    simToWorld(relay.pos, MARK_Y, this.chargeRing.position);
    const u = this.chargeMat.uniforms;
    u.uProgress!.value = progress;
    (u.uFill!.value as Color).set(charge ? look.ringFill : look.ringLit);
    (u.uEmpty!.value as Color).set(look.ringEmpty);
    u.uAlpha!.value = alpha;
  }

  /** Live mines of the graveyards in view; returns how many are drawn. */
  private updateMines(state: SimState): number {
    const t = this.time;
    const rm = this.reducedMotion;
    const player = state.player;
    const flying = player.dock.mode === 'flying' && !player.destroyed;
    const bR = player.props.boundingRadius;
    let n = 0;
    let rings = 0;
    // the live mines with their fuse straight from the sim (gone mines are left out)
    const live = this.visibleGraveyards.length > 0 ? liveMines(state, player.body.pos, VIEW_RANGE) : [];
    for (const mine of live) {
      if (n >= MINE_CAP) break;
      const p = mine.pos;
      const phase = noise2(mine.index * 13 + 5, Math.round(p.x) * 7 + Math.round(p.y));
      const fuse = mine.fuse;
      const bob = rm ? 0 : Math.sin((t * 0.6 + phase) * Math.PI * 2) * MINE_BOB;
      const at = simToWorld(p, bob, this.v);
      this.q.setFromAxisAngle(AXIS_Y, phase * Math.PI * 2);
      this.m4.compose(at, this.q, this.s.setScalar(MINE_SCALE));
      for (const m of this.mineShellMeshes) m.setMatrixAt(n, this.m4);
      this.q.setFromAxisAngle(AXIS_Y, phase * Math.PI * 2 + (rm ? 0 : t * MINE_SPIN * (fuse !== null ? 6 : 1)));
      this.m4.compose(at, this.q, this.s);
      for (const m of this.mineCoreMeshes) m.setMatrixAt(n, this.m4);
      // the red eye
      const lamp = mineLamp(t, phase, fuse, rm);
      const eye = this.v2.copy(this.mineLampLocal).multiplyScalar(MINE_SCALE).add(at);
      this.add(eye, fuse !== null ? 2.2 : 1.3, MINE_RED, (fuse !== null ? 0.95 : 0.7) * lamp);
      // the warning ring: the arming distance, then the blast circle while the fuse runs
      if (flying && rings < MINE_CAP) {
        const hull = Math.max(0, Math.hypot(player.body.pos.x - p.x, player.body.pos.y - p.y) - bR);
        const warn = fuse !== null ? 1 : mineWarning(hull, MINE.armRange, MINE_WARN_FROM);
        if (warn > 0.01) {
          const r = fuse !== null ? MINE.armRange + (MINE.blastRadius - MINE.armRange) * Math.min(1, fuse * 5) : MINE.armRange;
          const a = fuse !== null ? 0.35 + 0.65 * lamp : warn * (rm ? 0.75 : 0.6 + 0.15 * Math.sin(t * 4 + phase * 6));
          this.m4.compose(simToWorld(p, MARK_Y, this.v), this.q.identity(), this.s.set(r, 1, r));
          this.mineRings.setMatrixAt(rings, this.m4);
          // amber far, red close / armed (additive: colour × alpha)
          const red = fuse !== null ? 1 : warn;
          this.mineRings.setColorAt(rings, this.c.setRGB(1.0 * a, (0.55 - 0.42 * red) * a, (0.12 - 0.06 * red) * a));
          rings++;
        }
      }
      n++;
    }
    for (const m of [...this.mineShellMeshes, ...this.mineCoreMeshes]) {
      m.count = n;
      m.instanceMatrix.needsUpdate = true;
      if (n > 0) m.computeBoundingSphere();
    }
    this.mineRings.count = rings;
    if (rings > 0) {
      this.mineRings.instanceMatrix.needsUpdate = true;
      this.mineRings.instanceColor!.needsUpdate = true;
    }
    return this.mineShellMeshes.length > 0 ? n : 0;
  }

  /** The local ion storms of derelict defences near the ship; returns how many are drawn. */
  private updateStorms(state: SimState, dt: number): number {
    const player = state.player.body.pos;
    const rm = this.reducedMotion;
    const t = this.time;
    let drawn = 0;
    let edge = 0;
    let arcsWanted = false;
    for (const s of siteStorms(state)) {
      const fade = stormFade(state.tick, s.start, s.end);
      if (fade <= 0) continue;
      const d = Math.hypot(player.x - s.pos.x, player.y - s.pos.y);
      if (d > s.radius + VIEW_RANGE) continue;
      drawn++;
      // the edge band
      if (edge === 0) {
        simToWorld(s.pos, 0.1, this.stormEdge.position);
        this.stormEdge.scale.setScalar(s.radius);
        const flicker = rm ? 1 : 0.75 + 0.25 * noise2(Math.floor(t * 12), 3);
        this.stormEdgeMat.opacity = 0.22 * fade * flicker;
        edge = 1;
      }
      if (d > s.radius + STORM_MOTE_REACH) continue;
      // ion streaks blowing through the space around the ship along the storm's wind (world-fixed cells,
      // so they read as space, not as a HUD); each streak runs across its cell and fades at the ends
      const density = 0.42 * Math.min(1, this.particles);
      const wind = noise2(Math.round(s.pos.x), Math.round(s.pos.y)) * Math.PI * 2;
      const wx = Math.cos(wind);
      const wy = Math.sin(wind);
      const axis = this.v3.set(wx, 0, -wy);
      if (density > 0) {
        const c0x = Math.floor((player.x - STORM_MOTE_REACH) / STORM_MOTE_CELL);
        const c1x = Math.floor((player.x + STORM_MOTE_REACH) / STORM_MOTE_CELL);
        const c0y = Math.floor((player.y - STORM_MOTE_REACH) / STORM_MOTE_CELL);
        const c1y = Math.floor((player.y + STORM_MOTE_REACH) / STORM_MOTE_CELL);
        for (let cx = c0x; cx <= c1x; cx++) {
          for (let cy = c0y; cy <= c1y; cy++) {
            const roll = noise2(cx * 92821 + 11, cy * 68917 - 5);
            if (roll >= density) continue;
            const ox = noise2(cx, cy * 3 + 1);
            const oy = noise2(cx * 5 - 2, cy);
            const ph = noise2(cy * 7, cx * 11);
            const u = rm ? 0.5 : (t * (STORM_WIND_SPEED * (0.7 + 0.6 * ph)) / STORM_MOTE_CELL + ph) % 1;
            const run = (u - 0.5) * STORM_MOTE_CELL;
            const x = (cx + ox) * STORM_MOTE_CELL + wx * run;
            const y = (cy + oy) * STORM_MOTE_CELL + wy * run;
            if (Math.hypot(x - s.pos.x, y - s.pos.y) > s.radius) continue;
            const flick = rm ? 0.75 : Math.sin(u * Math.PI) * (0.6 + 0.4 * Math.max(0, Math.sin(t * (1.3 + ph * 2) + ph * 9)));
            this.add(simToWorld({ x, y }, -1 + ph * 4, this.v), 0.45 + ph * 0.35, ION_MOTE, 0.55 * fade * flick, axis, 2.5 + ph * 3);
          }
        }
      }
      if (!rm && this.particles > 0) {
        arcsWanted = true;
        this.arcClock += dt * fade * (3 + 3 * Math.min(1, this.particles));
        while (this.arcClock >= 1 && this.arcs.length < ARC_CAP) {
          this.arcClock -= 1;
          this.spawnArc(s.pos, player, s.radius);
        }
        if (this.arcClock >= 1) this.arcClock = 0;
      }
    }
    this.stormEdge.visible = edge > 0;
    this.updateArcs(dt, arcsWanted);
    return drawn;
  }

  /** A new arc near the ship (inside the storm) or over the station's hull when the ship is near it. */
  private spawnArc(centre: Vec2, player: Vec2, radius: number): void {
    const nearStation = Math.hypot(player.x - centre.x, player.y - centre.y) < 140;
    let a: Vec2;
    if (nearStation && Math.random() < 0.45) {
      const ang = Math.random() * Math.PI * 2;
      const r = 4 + Math.random() * 8;
      a = { x: centre.x + Math.cos(ang) * r, y: centre.y + Math.sin(ang) * r };
    } else {
      const ang = Math.random() * Math.PI * 2;
      const r = 8 + Math.random() * STORM_ARC_REACH;
      a = { x: player.x + Math.cos(ang) * r, y: player.y + Math.sin(ang) * r };
      if (Math.hypot(a.x - centre.x, a.y - centre.y) > radius) return;
    }
    const dir = Math.random() * Math.PI * 2;
    const len = 5 + Math.random() * 10;
    const ha = 0.5 + Math.random() * 4;
    const hb = Math.max(-1, ha + (Math.random() - 0.5) * 3);
    this.arcs.push({
      a: simToWorld(a, ha, new Vector3()),
      b: simToWorld({ x: a.x + Math.cos(dir) * len, y: a.y + Math.sin(dir) * len }, hb, new Vector3()),
      age: 0,
      life: 0.12 + Math.random() * 0.14,
    });
  }

  private updateArcs(dt: number, _wanted: boolean): void {
    let n = 0;
    let v = 0;
    const pos = this.arcPos.array as Float32Array;
    const col = this.arcCol.array as Float32Array;
    for (const arc of this.arcs) {
      arc.age += dt;
      if (arc.age >= arc.life) continue;
      this.arcs[n++] = arc;
      const k = 1 - arc.age / arc.life;
      // jagged: new kinks every frame (it crackles)
      let px = arc.a.x;
      let py = arc.a.y;
      let pz = arc.a.z;
      const span = arc.a.distanceTo(arc.b);
      for (let i = 1; i <= ARC_SEGMENTS; i++) {
        const f = i / ARC_SEGMENTS;
        const j = i === ARC_SEGMENTS ? 0 : span * 0.16;
        const x = arc.a.x + (arc.b.x - arc.a.x) * f + (Math.random() - 0.5) * j;
        const y = arc.a.y + (arc.b.y - arc.a.y) * f + (Math.random() - 0.5) * j * 0.5;
        const z = arc.a.z + (arc.b.z - arc.a.z) * f + (Math.random() - 0.5) * j;
        const o = v * 3;
        pos[o] = px;
        pos[o + 1] = py;
        pos[o + 2] = pz;
        pos[o + 3] = x;
        pos[o + 4] = y;
        pos[o + 5] = z;
        for (let q = 0; q < 2; q++) {
          col[o + q * 3] = ION[0] * k;
          col[o + q * 3 + 1] = ION[1] * k;
          col[o + q * 3 + 2] = ION[2] * k;
        }
        v += 2;
        px = x;
        py = y;
        pz = z;
      }
      // the flash of the discharge
      this.add(this.v.copy(arc.a).lerp(arc.b, 0.5), 3 + span * 0.4, ION, 0.35 * k);
    }
    this.arcs.length = n;
    this.arcLines.geometry.setDrawRange(0, v);
    if (v > 0) {
      this.arcPos.needsUpdate = true;
      this.arcCol.needsUpdate = true;
    }
    this.arcLines.visible = v > 0;
  }

  private updateFlashes(dt: number): void {
    let n = 0;
    for (const f of this.flashes) {
      f.age += dt;
      if (f.age >= f.life) continue;
      this.flashes[n++] = f;
      const k = 1 - f.age / f.life;
      this.add(f.pos, f.size * (0.6 + 0.4 * (1 - k)), f.color, k);
    }
    this.flashes.length = n;
  }

  // ---------------------------------------------------------------------------
  // warm-up, stats, dispose

  /**
   * Shader warm-up: every model loaded now (not at first sight), one sample of each derelict's hull /
   * windows / beacons / drift meshes with the materials the entries use, the relay and mine instances,
   * the glow batch, the rings, the storm edge and arcs and the blast effects. Resolves when the models are in.
   */
  async warmUp(zoo: WarmUpZoo): Promise<void> {
    await Promise.all([...DERELICT_MODELS.map((m) => this.request(m)), this.request('relay'), this.request('mine'), this.request('guildMast')]);
    if (this.disposed) return;
    for (const m of DERELICT_MODELS) {
      if (!this.derelictTemplates.has(m)) continue;
      const pseudo: DerelictSite = { kind: 'derelict', id: `warm:${m}`, cx: 0, cy: 0, pos: { x: 0, y: 0 }, angle: 0, model: m, depth: 2, relays: [], defence: 'none', service: 'stash' };
      const e = this.buildDerelict(pseudo);
      // lit windows and beacons compile the same program as dark ones (intensity is a uniform)
      for (const mat of [...e.windows, ...e.beacons]) mat.emissiveIntensity = 1;
      zoo.add(e.group);
    }
    for (const mesh of [...this.relayMeshes, ...this.mineShellMeshes, ...this.mineCoreMeshes, ...this.guildMastMeshes, ...this.guildBrokenMeshes]) {
      const sample = new InstancedMesh(mesh.geometry, mesh.material, 1);
      sample.setMatrixAt(0, new Matrix4());
      zoo.add(sample);
    }
    // the plane markers and the glow batch with one instance each (drawn in the hidden frame)
    const ring = new InstancedMesh(this.mineRings.geometry, this.mineRings.material, 1);
    ring.setMatrixAt(0, new Matrix4());
    ring.setColorAt(0, new Color(1, 0.5, 0.1));
    zoo.add(ring);
    zoo.add(new Mesh(this.chargeRing.geometry, this.chargeMat));
    zoo.add(new Mesh(this.stormEdge.geometry, this.stormEdgeMat));
    zoo.add(new LineSegments(this.arcLines.geometry, this.arcLines.material));
  }

  stats(): SiteLayerStats {
    return this.last;
  }

  dispose(): void {
    this.disposed = true;
    for (const id of [...this.derelicts.keys()]) this.removeDerelict(id);
    for (const m of [...this.relayMeshes, ...this.mineShellMeshes, ...this.mineCoreMeshes, ...this.guildMastMeshes, ...this.guildBrokenMeshes, this.mineRings]) m.dispose();
    this.glow.dispose();
    this.effects?.dispose();
    for (const x of this.shared) x.dispose();
    this.shared.length = 0;
    this.darkCopies.clear();
    this.derelictTemplates.clear();
    this.object.clear();
  }
}
