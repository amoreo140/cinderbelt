// Sector borders, Guild Lanes and the Guild Watch in the world (sectors design §2.3, §5.2 stage 2;
// art batch C, models/borders/borders.json, models/npc/npc_ships.json). Render only – it reads the world
// seed, the current securities (a destroyed fortress turns its sector Contested, a Guild relay secures
// one), the simulation time and the live Guild Watch ships of the simulation (M4d).
//
//   - Border markers on both sides of every border between sectors of different security, every
//     60–90 u, each in the sector it announces (Guarded pylon, Quiet marker, Contested pylon, Pirate
//     "Rust markers" totem with the banner of the sector's clan), with halo sprites at the lamps.
//   - A camera-facing light fence along each side (border_fence_<security>.png, the shape differs
//     per security as on the map) and a faint flat ribbon on the border (≤ 0.35, the more dangerous
//     side's colour). Both stop short of stations.
//   - Guild Lane buoys every 120–160 u with a chase blink outward; the Guild pickets at the Guarded
//     sector entrances on the lanes (scenery, no docking).
//   - Guild Watch patrols (guildWatch.ts → src/sim/guild/watchRoutes.ts): cutters, now and then led by a
//     frigate, on the lanes and circling in sectors Guarded now near the camera, strobes double-flashing,
//     guns idle-yawing; they dip under the rocks they pass. Near the player the simulation turns
//     scheduled ships into live ones (M4d, `state.guild.watch`): those are drawn at their interpolated sim
//     pose (in patrol exactly the scheduled pose, the same batch slot – seamless) with their guns on the
//     engaged pirate, on every quality; the schedule minus the live and the lost ids is the scenery.
//
// Cost: every model goes into ONE BatchedMesh (the shared palette atlas material, one draw call
// with WEBGL_multi_draw), fences and ribbons are ONE mesh (the five textures packed into one atlas,
// camera-facing in the vertex shader) and every halo is ONE sprite batch – three draw calls in all.
// The window of planned chunks (5 × 5 around the camera aim) is planned a few chunks per frame and
// rebuilt only when the camera crosses a chunk or a security changes.
//
// Quality: High / Medium everything; Low markers, buoys, pickets and the lane patrols only (no
// fences, ribbons or halos, no sector patrols); software Low the markers, buoys and pickets in 3 × 3
// chunks – live Watch ships on every quality. Reduced motion holds every lamp steady and stops the
// scrolling and the turning parts (an engaged gun still aims).
import {
  AdditiveBlending,
  BatchedMesh,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  Color,
  DoubleSide,
  Group,
  LinearMipmapLinearFilter,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  NoColorSpace,
  Object3D,
  Quaternion,
  RepeatWrapping,
  ShaderMaterial,
  Vector3,
  type Camera,
  type Material,
} from 'three';
import type { FactionId } from '../../data/factions';
import { WATCH } from '../../data/guild';
import type { WatchShip as LiveWatch } from '../../sim/guild/types';
import { guardedNow, type GuardedAt } from '../../sim/guild/watchRoutes';
import { fnv1a32 } from '../../sim/math/fnv1a';
import { lerpAngle, normalizeAngle } from '../../sim/math/angle';
import { lerp, type Vec2 } from '../../sim/math/vec2';
import { clanAt, fortressClan } from '../../sim/pirates/clans';
import { fortressById } from '../../sim/pirates/sites';
import { securedSectors, securityOverrides } from '../../sim/pirates/sectors';
import type { Security } from '../../sim/regions/constants';
import { sectorInfo, sectorLanes, sectorSecurity } from '../../sim/regions/sectors';
import { SIM_DT, type SimState } from '../../sim/Simulation';
import { chunkCoord } from '../../sim/world/chunks';
import { PALETTE } from '../../ui/theme/tokens';
import { createModelLoader } from '../assets/gltf';
import { loadModelScene, toFloatAttributes } from '../assets/ModelLibrary';
import { loadImageAsset } from '../assets/imageAsset';
import { SpriteBatch } from '../fx/Particles';
import { vfxTexture } from '../fx/textures';
import type { QualityPreset } from '../quality';
import { mergeAll, normalizeGeometry } from '../scatter/ScatterLayer';
import { uploadBatchMatrices } from '../uploads';
import type { WarmUpZoo } from '../warmup';
import { lampLevel, type LampRhythm } from './borderLamps';
import { BorderPlanner, SECURITY_RANK, SIDE_OFFSET, type BorderMarker, type ChunkBorders, type LaneBuoy, type PicketSite } from './borderPlan';
import type { BorderPiece } from './borderTrace';
import { lanePatrols, PATROL_CELL, routeBox, routeShips, sectorPatrol, type PatrolRoute, type WatchKind, type WatchShip } from './guildWatch';

type ModelId = Security | 'buoy' | 'picket' | WatchKind;
type PartMode = 'static' | 'banner' | 'spin' | 'yaw';

const FILES: Readonly<Record<ModelId, string>> = {
  guarded: 'assets/models/borders/border_guarded.glb',
  quiet: 'assets/models/borders/border_quiet.glb',
  contested: 'assets/models/borders/border_contested.glb',
  pirate: 'assets/models/borders/border_pirate.glb',
  buoy: 'assets/models/borders/lane_buoy.glb',
  picket: 'assets/models/stations/guild_picket.glb',
  cutter: 'assets/models/npc/guild_cutter.glb',
  frigate: 'assets/models/npc/guild_frigate.glb',
};
/** Its model files – the boot list downloads them ahead of the game (assets/bootAssets.ts). */
export const BORDER_MODEL_PATHS: readonly string[] = Object.values(FILES);
/** Nodes drawn as their own batch geometry: a clan banner (one of three) or a part that turns around its +Y. */
const SPECIAL: Partial<Record<ModelId, Readonly<Record<string, PartMode>>>> = {
  pirate: { Banner_rust: 'banner', Banner_cauldron: 'banner', Banner_slantedStar: 'banner' },
  picket: { Picket_Dish: 'spin', Turret_0: 'yaw' },
  cutter: { Gun_0: 'yaw', Gun_1: 'yaw' },
  frigate: { Turret_0: 'yaw' },
};
const POINT_NODE = /^(glow|beacon|strobe|thruster)_\d+$|^fence_[lr]$/;

/** Heights of the anchors (borders.json `suggestedY`, `laneBuoy.suggestedY`) and of the patrols. */
const MARKER_Y = -0.6;
const BUOY_Y = -0.4;
const PATROL_Y = -3;
const RIBBON_Y = -0.9;
/** Chunks planned around the camera aim (2 → 5 × 5) and per frame. */
const RANGE = 2;
const RANGE_SOFTWARE = 1;
const PLAN_PER_FRAME = 3;
/** Fences / ribbon fade out toward the window edge (u from the camera aim). */
const FADE: readonly [number, number] = [300, 390];
/** Patrol routes are looked at within this distance of the camera aim (u). */
const PATROL_RANGE = 650;
const MAX_INSTANCES = 768;
const MAX_HALOS = 1024;
/** How fast an engaged Watch gun / turret turns onto its pirate (rad/s), and how far off the bow it may (a turret: all round). */
const GUN_TURN = 4;
const GUN_ARC: Readonly<Record<WatchKind, number>> = {
  cutter: Math.min(...WATCH.ships.cutter.guns.map((g) => g.arc)),
  frigate: Math.min(...WATCH.ships.frigate.guns.map((g) => g.arc)),
};

/** Fence: width (u, at the reference distance), texture repeat (u), brightness; ribbon width, repeat, opacity (borders.json). */
const FENCE = { width: 0.7, repeat: 6, gain: 1.35 } as const;
const RIBBON = { width: 14, repeat: 40, opacity: 0.3, scroll: 0.02 } as const;
/** Contested fence "flicker" scroll (repeats/s). */
const CONTESTED_SCROLL = 0.35;
/** Halo sprite size (u, at distance REF), its growth with distance (constant-ish on screen) and brightness. */
const GLOW = { marker: 2.6, buoy: 3.0, ship: 1.4, engine: 1.8, picket: 1.8, gain: 2.0 } as const;
const REF_DISTANCE = 48;

const SECURITY_COLOR: Readonly<Record<Security, string>> = { quiet: PALETTE.quiet, guarded: PALETTE.ok, contested: PALETTE.warn, pirate: PALETTE.bad };
const FENCE_ROW: Readonly<Record<Security, number>> = { guarded: 0, quiet: 1, contested: 2, pirate: 3 };
const FENCE_FILES = ['border_fence_guarded', 'border_fence_quiet', 'border_fence_contested', 'border_fence_pirate'] as const;
/** The fence atlas's images, in atlas order (the boot list downloads them ahead, assets/bootAssets.ts). */
export const BORDER_IMAGE_PATHS: readonly string[] = [...FENCE_FILES, 'border_ribbon'].map((name) => `assets/vfx/${name}.png`);
const LAMP_COLOR = {
  red: new Color('#ff4a3a'),
  green: new Color('#5dff8a'),
  white: new Color('#fff2dc'),
  amber: new Color(PALETTE.warn),
  strobe: new Color('#9ccbff'),
  engine: new Color(0.6, 0.78, 1),
  lane: new Color(PALETTE.trim),
} as const;

interface ModelPart {
  geometryId: number;
  /** Pose of the node in the model frame (identity for the merged static body). */
  base: Matrix4;
  node: string | null;
  mode: PartMode;
}

interface ModelEntry {
  parts: ModelPart[];
  /** Empties and lamp-mesh centres in the model frame (glow_<i>, beacon_<i>, strobe_<i>, thruster_<i>, fence_l/r). */
  points: Map<string, Vector3>;
  /** A Watch ship's lamps (shipLamps, from `points` on first use): rhythm, colour, size and phase shift. */
  shipLamps?: ShipLamp[];
}

/** One lamp of a Watch ship model: where, how it blinks, its colour, glow size and phase shift. */
interface ShipLamp {
  local: Vector3;
  rhythm: LampRhythm;
  color: Color;
  size: number;
  phase: number;
}

/** The lamps of a Watch ship model (beacons, strobes, engine glows) – worked out once per model, not per ship and frame. */
function shipLamps(entry: ModelEntry, kind: WatchKind): ShipLamp[] {
  if (entry.shipLamps) return entry.shipLamps;
  const out: ShipLamp[] = [];
  for (const [name, local] of entry.points) {
    let rhythm: LampRhythm = 'nav';
    let color: Color = LAMP_COLOR.white;
    let size: number = GLOW.ship;
    let phase = 0;
    if (name.startsWith('strobe_')) {
      rhythm = 'strobe';
      color = LAMP_COLOR.strobe;
      phase = name.endsWith('1') ? 0.5 : 0;
    } else if (name.startsWith('thruster_')) {
      color = LAMP_COLOR.engine;
      size = kind === 'frigate' ? GLOW.engine * 1.4 : GLOW.engine;
    } else if (name === 'beacon_0') color = LAMP_COLOR.red;
    else if (name === 'beacon_1') color = LAMP_COLOR.green;
    else if (name === 'beacon_4') color = LAMP_COLOR.amber;
    else if (!name.startsWith('beacon_')) continue;
    out.push({ local, rhythm, color, size, phase });
  }
  entry.shipLamps = out;
  return out;
}

/** A static instance group shown in the window (marker, buoy, picket). */
interface Placed {
  model: ModelId;
  matrix: Matrix4;
  ids: number[];
  parts: ModelPart[];
  lamps: { local: Vector3; rhythm: LampRhythm; phase: number; color: Color; size: number }[];
}

interface ShipSlot {
  kind: WatchKind;
  ids: number[];
  used: boolean;
  /** Gun / turret yaw drawn last frame (rad, relative to the bow) – an engaged gun turns from it. */
  yaw: number;
}

/** One Watch ship to draw this frame (scheduled scenery or live). */
interface ShipPose {
  kind: WatchKind;
  pos: Vec2;
  heading: number;
  gunYaw: number;
  phase: number;
}

const UP = new Vector3(0, 1, 0);
const tmpQ = new Quaternion();
const tmpV = new Vector3();
const tmpS = new Vector3();

/** Fence + ribbon shader: the strip opens across its tangent toward the camera (fence) or in the plane (ribbon). */
const VERTEX = /* glsl */ `
attribute vec3 aTangent;
attribute float aSide;
attribute float aU;
attribute float aRow;
attribute vec3 aColor;
attribute float aWidth;
attribute float aFlat;
attribute float aScroll;
uniform float uTime;
uniform vec3 uFocus;
uniform vec2 uFade;
uniform float uRef;
varying vec2 vUv;
varying float vRow;
varying vec3 vColor;
varying float vFade;
void main() {
  vec3 p = position;
  vec3 toCam = cameraPosition - p;
  float dist = length(toCam);
  vec3 side;
  float grow = 1.0;
  if (aFlat > 0.5) {
    side = normalize(vec3(-aTangent.z, 0.0, aTangent.x));
  } else {
    side = normalize(cross(aTangent, toCam));
    grow = clamp(pow(dist / uRef, 0.8), 1.0, 3.2);
  }
  p += side * aSide * 0.5 * aWidth * grow;
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
  vUv = vec2(aU + uTime * aScroll, aSide * 0.5 + 0.5);
  vRow = aRow;
  vColor = aColor;
  vFade = 1.0 - smoothstep(uFade.x, uFade.y, length(p.xz - uFocus.xz));
}`;

const FRAGMENT = /* glsl */ `
uniform sampler2D uMap;
varying vec2 vUv;
varying float vRow;
varying vec3 vColor;
varying float vFade;
void main() {
  // atlas rows (top down): four fences of 1/6 each, the ribbon in the last third
  bool ribbon = vRow > 3.5;
  float v0 = ribbon ? 4.0 / 6.0 : vRow / 6.0;
  float h = ribbon ? 2.0 / 6.0 : 1.0 / 6.0;
  vec4 t = texture2D(uMap, vec2(vUv.x, v0 + clamp(vUv.y, 0.03, 0.97) * h));
  float a = t.a * vFade;
  if (a < 0.003) discard;
  gl_FragColor = vec4(t.rgb * vColor * a, 1.0);
}`;

export class BorderLayer {
  readonly object = new Group();
  private planner: BorderPlanner | null = null;
  private readonly models = new Map<ModelId, ModelEntry>();
  private batch: BatchedMesh | null = null;
  private material: Material | null = null;
  private readonly halos = new SpriteBatch({ texture: vfxTexture('glow_soft'), additive: true, max: MAX_HALOS, renderOrder: 12 });
  private readonly fenceMaterial: ShaderMaterial;
  private readonly fenceMesh: Mesh;
  private fenceTexture: CanvasTexture | null = null;
  private placed: Placed[] = [];
  private shownKey = '';
  private dirty = true;
  private ships = new Map<string, ShipSlot>();
  private lanes: PatrolRoute[] | null = null;
  /** The lanes' boxes (routeBox), made with the lanes – not per lane and frame. */
  private laneBoxes: ReturnType<typeof routeBox>[] = [];
  /** routesNear's result, reused every frame (the first `nearCount` entries). */
  private readonly nearRoutes: PatrolRoute[] = [];
  private nearCount = 0;
  /** The sector-patrol cells of the last window and their routes (`i0` NaN = look up again). */
  private readonly cellWindow = { i0: NaN, i1: NaN, j0: NaN, j1: NaN, routes: [] as PatrolRoute[] };
  /** `route|slot` key strings of the scenery ships (bounded; not a new string per ship and frame). */
  private readonly shipKeys = new Map<string, string[]>();
  private readonly sectorRoutes = new Map<string, PatrolRoute | null>();
  private readonly clans = new Map<string, FactionId>();
  private secCache = new Map<string, Security>();
  private deadKey = '';
  private fences = true;
  private haloOn = true;
  private range = RANGE;
  private patrols: 'all' | 'lanes' | 'none' = 'all';
  private time = 0;
  private disposed = false;
  private counts = { markers: 0, buoys: 0, pickets: 0, ships: 0, live: 0, fenceVertices: 0 };
  private readonly m = new Matrix4();
  private readonly m2 = new Matrix4();
  private readonly anim = new Matrix4();
  private readonly v = new Vector3();
  private readonly c = new Color();
  private readonly camPos = new Vector3();

  constructor(private readonly seed: number) {
    this.object.name = 'borders';
    this.object.userData.noAO = true;
    this.fenceMaterial = new ShaderMaterial({
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      uniforms: {
        uMap: { value: null },
        uTime: { value: 0 },
        uFocus: { value: new Vector3() },
        uFade: { value: [FADE[0], FADE[1]] },
        uRef: { value: REF_DISTANCE },
      },
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      side: DoubleSide,
      forceSinglePass: true,
    });
    this.fenceMesh = new Mesh(new BufferGeometry(), this.fenceMaterial);
    this.fenceMesh.name = 'border-fences';
    this.fenceMesh.frustumCulled = false;
    this.fenceMesh.renderOrder = 11;
    this.fenceMesh.visible = false;
    this.fenceMesh.userData.noAO = true;
    this.halos.mesh.visible = false;
    this.object.add(this.fenceMesh, this.halos.mesh);
    this.ready = Promise.all([this.load(), this.loadFenceAtlas()]).then(
      () => {},
      () => {},
    );
  }

  /** The models and the fence atlas have loaded (or failed) – the shader warm-up waits for it. */
  readonly ready: Promise<void>;

  /**
   * Shader warm-up: the batch and the fence strips draw nothing until a border comes into the window,
   * so each gets a one-triangle sample with its own material (a drawn twin creates the driver variant).
   */
  warmUp(zoo: WarmUpZoo): void {
    const fence = zoo.geometry(new BufferGeometry());
    for (const [name, size] of [
      ['position', 3],
      ['aTangent', 3],
      ['aSide', 1],
      ['aU', 1],
      ['aRow', 1],
      ['aColor', 3],
      ['aWidth', 1],
      ['aFlat', 1],
      ['aScroll', 1],
    ] as const) {
      fence.setAttribute(name, new BufferAttribute(new Float32Array(3 * size), size));
    }
    fence.setIndex([0, 1, 2]);
    const strip = new Mesh(fence, this.fenceMaterial);
    strip.userData.noAO = true;
    zoo.addBackdrop(strip);
    const batch = this.batch;
    if (!batch || !this.material) return;
    const g = zoo.geometry(new BufferGeometry());
    for (const [name, attr] of Object.entries(batch.geometry.attributes)) g.setAttribute(name, new BufferAttribute(new Float32Array(3 * attr.itemSize), attr.itemSize, attr.normalized));
    g.setIndex([0, 1, 2]);
    const sample = new BatchedMesh(1, 3, 3, this.material);
    sample.addInstance(sample.addGeometry(g));
    sample.castShadow = false;
    sample.userData.noAO = true;
    zoo.addPlain(sample);
  }

  // -------------------------------------------------------------------------------------------
  // loading

  private async load(): Promise<void> {
    const loader = createModelLoader();
    const ids = Object.keys(FILES) as ModelId[];
    const scenes = await Promise.all(ids.map((id) => loadModelScene(loader, FILES[id])));
    if (this.disposed) return;
    const pending: { id: ModelId; groups: { geometry: BufferGeometry; base: Matrix4; node: string | null; mode: PartMode }[]; points: Map<string, Vector3> }[] = [];
    let material: Material | null = null;
    ids.forEach((id, i) => {
      const scene = scenes[i];
      if (!scene) return;
      scene.updateMatrixWorld(true);
      const special = SPECIAL[id] ?? {};
      const groups = new Map<Object3D | null, BufferGeometry[]>();
      const points = new Map<string, Vector3>();
      const inv = new Matrix4();
      scene.traverse((o) => {
        if (POINT_NODE.test(o.name) && !points.has(o.name)) {
          if (o instanceof Mesh) {
            const g = o.geometry as BufferGeometry;
            g.computeBoundingBox();
            points.set(o.name, g.boundingBox!.getCenter(new Vector3()).applyMatrix4(o.matrixWorld));
          } else points.set(o.name, o.getWorldPosition(new Vector3()));
        }
        if (!(o instanceof Mesh)) return;
        material ??= Array.isArray(o.material) ? o.material[0]! : o.material;
        let owner: Object3D | null = null;
        for (let n: Object3D | null = o; n && n !== scene; n = n.parent) if (special[n.name] && !owner) owner = n;
        const toOwner = owner ? inv.copy(owner.matrixWorld).invert().multiply(o.matrixWorld) : o.matrixWorld;
        const geometry = normalizeGeometry(toFloatAttributes((o.geometry as BufferGeometry).clone()).applyMatrix4(toOwner));
        groups.set(owner, [...(groups.get(owner) ?? []), geometry]);
      });
      const list: (typeof pending)[number]['groups'] = [];
      for (const [owner, geos] of groups) {
        const geometry = geos.length === 1 ? geos[0]! : mergeAll(geos);
        if (!geometry) continue;
        list.push({ geometry, base: owner ? owner.matrixWorld.clone() : new Matrix4(), node: owner?.name ?? null, mode: owner ? special[owner.name]! : 'static' });
      }
      pending.push({ id, groups: list, points });
      scene.traverse((o) => {
        if (o instanceof Mesh) (o.geometry as BufferGeometry).dispose();
      });
    });
    if (pending.length === 0 || !material) return;
    let vertices = 0;
    let indices = 0;
    for (const p of pending) for (const g of p.groups) {
      vertices += g.geometry.getAttribute('position').count;
      indices += g.geometry.index!.count;
    }
    const mat = (material as MeshStandardMaterial).clone();
    mat.vertexColors = true;
    const batch = new BatchedMesh(MAX_INSTANCES, vertices, indices, mat);
    batch.name = 'border-batch';
    batch.frustumCulled = false;
    batch.perObjectFrustumCulled = true;
    batch.sortObjects = false;
    batch.castShadow = false;
    batch.receiveShadow = false;
    batch.userData.noAO = true;
    for (const p of pending) {
      const parts = p.groups.map((g) => {
        const geometryId = batch.addGeometry(g.geometry);
        g.geometry.dispose();
        return { geometryId, base: g.base, node: g.node, mode: g.mode };
      });
      this.models.set(p.id, { parts, points: p.points });
    }
    this.material = mat;
    this.batch = batch;
    this.object.add(batch);
    this.dirty = true;
  }

  /** The five fence / ribbon textures packed into one atlas (rows of 32 px, the ribbon 64 px). */
  private async loadFenceAtlas(): Promise<void> {
    if (typeof document === 'undefined') return;
    // through the prefetch store: the shader warm-up waits for this layer (perf O14)
    const images = await Promise.all(BORDER_IMAGE_PATHS.map((path) => loadImageAsset(path)));
    if (this.disposed || images.some((i) => !i)) return;
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 192;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    images.forEach((img, i) => {
      if (i < 4) ctx.drawImage(img!, 0, i * 32, 256, 32);
      else ctx.drawImage(img!, 0, 128, 256, 64);
    });
    const tex = new CanvasTexture(canvas);
    tex.flipY = false;
    tex.colorSpace = NoColorSpace;
    tex.wrapS = RepeatWrapping;
    tex.minFilter = LinearMipmapLinearFilter;
    tex.anisotropy = 4;
    this.fenceTexture = tex;
    this.fenceMaterial.uniforms.uMap!.value = tex;
    this.dirty = true;
  }

  // -------------------------------------------------------------------------------------------
  // settings

  setQuality(preset: QualityPreset): void {
    const software = preset.particles <= 0;
    const low = preset.particles < 0.5;
    const fences = !low;
    const patrols = software || preset.traffic <= 0 ? 'none' : low ? 'lanes' : 'all';
    const range = software ? RANGE_SOFTWARE : RANGE;
    if (fences !== this.fences || range !== this.range) this.dirty = true;
    this.fences = fences;
    this.haloOn = !low;
    this.range = range;
    this.patrols = patrols;
  }

  // -------------------------------------------------------------------------------------------
  // frame

  /**
   * Once per frame: `target` = the camera aim on the plane, `simTime` = the interpolated simulation
   * time (the patrols), `dt` = frame time.
   */
  update(state: SimState, target: Vector3, camera: Camera, simTime: number, dt: number, reducedMotion: boolean): void {
    this.time += dt;
    this.planner ??= new BorderPlanner(this.seed);
    const cx = chunkCoord(target.x);
    const cy = chunkCoord(-target.z);
    // a destroyed (or rebuilt) fortress or a Guild-secured sector changes a sector's security
    let dead = '';
    for (const [id, f] of state.pirates.fortresses) if (f.destroyed !== null) dead += `${id};`;
    for (const id of securedSectors(state)) dead += `+${id};`;
    if (dead !== this.deadKey) {
      this.deadKey = dead;
      this.secCache = new Map();
      // a secured sector gets its sector patrols (the cells a static Guarded one would have)
      this.sectorRoutes.clear();
      this.cellWindow.i0 = NaN;
      this.dirty = true;
    }
    // plan the window nearest-first, a few chunks per frame
    let planned = 0;
    for (let r = 0; r <= this.range && planned < PLAN_PER_FRAME; r++) {
      for (let dx = -r; dx <= r && planned < PLAN_PER_FRAME; dx++) {
        for (let dy = -r; dy <= r && planned < PLAN_PER_FRAME; dy++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r || this.planner.planned(cx + dx, cy + dy)) continue;
          this.planner.chunk(cx + dx, cy + dy);
          this.planner.buoys(cx + dx, cy + dy);
          planned++;
          this.dirty = true;
        }
      }
    }
    const key = `${cx},${cy}`;
    if (this.batch && (this.dirty || key !== this.shownKey)) {
      this.shownKey = key;
      this.dirty = false;
      this.rebuild(cx, cy, state);
    }
    camera.getWorldPosition(this.camPos);
    const u = this.fenceMaterial.uniforms;
    u.uTime!.value = reducedMotion ? 0 : this.time;
    (u.uFocus!.value as Vector3).copy(target);
    this.fenceMesh.visible = this.fences && this.fenceTexture !== null && this.counts.fenceVertices > 0;
    const halos = this.haloOn;
    if (halos) this.halos.begin();
    this.updatePlaced(reducedMotion, halos);
    this.updateShips(state, target, simTime, dt, reducedMotion, halos);
    // the ids in use (≈ 11 of 768), only when a matrix was written (audit 2026-10-17 P9)
    if (this.batch) uploadBatchMatrices(this.batch);
    if (halos) this.halos.end();
    this.halos.mesh.visible = halos;
  }

  private security(id: string, state: SimState): Security {
    let s = this.secCache.get(id);
    if (!s) {
      s = sectorSecurity(this.seed, id, securityOverrides(state));
      this.secCache.set(id, s);
    }
    return s;
  }

  /** The clan whose banner the Rust markers of a sector fly: the fortress's own, else the territory's. */
  private clanOf(id: string): FactionId {
    let clan = this.clans.get(id);
    if (!clan) {
      const info = sectorInfo(this.seed, id);
      const fort = info?.name.kind === 'fortress' ? fortressById(this.seed, info.name.fortress) : null;
      clan = fort ? fortressClan(this.seed, fort.index) : clanAt(this.seed, info?.anchor ?? { x: 0, y: 0 });
      this.clans.set(id, clan);
    }
    return clan;
  }

  // -------------------------------------------------------------------------------------------
  // window rebuild

  private rebuild(cx: number, cy: number, state: SimState): void {
    const batch = this.batch!;
    const planner = this.planner!;
    for (const p of this.placed) for (const id of p.ids) batch.deleteInstance(id);
    this.placed = [];
    const chunks: ChunkBorders[] = [];
    const buoys: LaneBuoy[] = [];
    for (let dx = -this.range; dx <= this.range; dx++) {
      for (let dy = -this.range; dy <= this.range; dy++) {
        if (!planner.planned(cx + dx, cy + dy)) continue;
        chunks.push(planner.chunk(cx + dx, cy + dy));
        buoys.push(...planner.buoys(cx + dx, cy + dy));
      }
    }
    let markers = 0;
    for (const c of chunks) for (const m of c.markers) {
      const own = this.security(m.sector, state);
      if (own === this.security(m.other, state)) continue;
      if (this.placeMarker(m, own)) markers++;
    }
    for (const b of buoys) this.placeBuoy(b);
    const x0 = (cx - this.range) * 200;
    const x1 = (cx + this.range + 1) * 200;
    const y0 = (cy - this.range) * 200;
    const y1 = (cy + this.range + 1) * 200;
    let pickets = 0;
    for (const p of planner.pickets()) if (p.pos.x >= x0 && p.pos.x < x1 && p.pos.y >= y0 && p.pos.y < y1 && this.placePicket(p)) pickets++;
    this.counts.markers = markers;
    this.counts.buoys = buoys.length;
    this.counts.pickets = pickets;
    this.buildFences(chunks, state);
  }

  private place(model: ModelId, matrix: Matrix4, choose: (part: ModelPart) => boolean = () => true): Placed | null {
    const entry = this.models.get(model);
    const batch = this.batch!;
    if (!entry) return null;
    const parts = entry.parts.filter(choose);
    if (batch.instanceCount + parts.length > MAX_INSTANCES - 64) return null;
    const ids = parts.map((part) => {
      const id = batch.addInstance(part.geometryId);
      batch.setMatrixAt(id, this.m2.multiplyMatrices(matrix, part.base));
      return id;
    });
    const placed: Placed = { model, matrix: matrix.clone(), ids, parts, lamps: [] };
    this.placed.push(placed);
    return placed;
  }

  private placeMarker(m: BorderMarker, security: Security): boolean {
    const yaw = Math.atan2(m.into.y, m.into.x) + m.yaw;
    this.m.compose(this.v.set(m.pos.x, MARKER_Y, -m.pos.y), tmpQ.setFromAxisAngle(UP, yaw), tmpS.setScalar(m.scale));
    const banner = security === 'pirate' ? `Banner_${this.clanOf(m.sector)}` : null;
    const placed = this.place(security, this.m, (p) => p.mode !== 'banner' || p.node === banner);
    if (!placed) return false;
    const color = new Color(SECURITY_COLOR[security]);
    for (const [name, local] of this.models.get(security)!.points) {
      if (!name.startsWith('glow_')) continue;
      placed.lamps.push({ local, rhythm: security, phase: m.phase, color, size: GLOW.marker * m.scale });
    }
    return true;
  }

  private placeBuoy(b: LaneBuoy): void {
    this.m.compose(this.v.set(b.pos.x, BUOY_Y, -b.pos.y), tmpQ.setFromAxisAngle(UP, Math.atan2(b.along.y, b.along.x)), tmpS.setScalar(1));
    const placed = this.place('buoy', this.m);
    const local = this.models.get('buoy')?.points.get('glow_0') ?? this.models.get('buoy')?.points.get('beacon_0');
    if (placed && local) placed.lamps.push({ local, rhythm: 'buoy', phase: b.index, color: LAMP_COLOR.lane, size: GLOW.buoy });
  }

  private placePicket(p: PicketSite): boolean {
    this.m.compose(this.v.set(p.pos.x, 0, -p.pos.y), tmpQ.setFromAxisAngle(UP, p.angle), tmpS.setScalar(1));
    const placed = this.place('picket', this.m);
    if (!placed) return false;
    for (const [name, local] of this.models.get('picket')!.points) {
      if (name.startsWith('strobe_')) placed.lamps.push({ local, rhythm: 'strobe', phase: name.endsWith('1') ? 0.5 : 0, color: LAMP_COLOR.strobe, size: GLOW.picket });
      else if (name === 'beacon_0') placed.lamps.push({ local, rhythm: 'nav', phase: 0, color: LAMP_COLOR.red, size: GLOW.picket });
      else if (name.startsWith('beacon_')) placed.lamps.push({ local, rhythm: 'nav', phase: 0, color: LAMP_COLOR.amber, size: GLOW.picket * 0.8 });
    }
    return true;
  }

  /** Animated picket parts and every placed lamp's halo. */
  private updatePlaced(reducedMotion: boolean, halos: boolean): void {
    const batch = this.batch;
    if (!batch) return;
    const t = reducedMotion ? 0 : this.time;
    for (const p of this.placed) {
      if (p.model === 'picket') {
        p.parts.forEach((part, i) => {
          if (part.mode === 'static') return;
          const angle = part.mode === 'spin' ? t * 0.25 * Math.PI * 2 : 0.9 * Math.sin(t * 0.3);
          this.anim.makeRotationAxis(UP, angle);
          batch.setMatrixAt(p.ids[i]!, this.m2.multiplyMatrices(p.matrix, part.base).multiply(this.anim));
        });
      }
      if (!halos) continue;
      for (const lamp of p.lamps) {
        const level = lampLevel(lamp.rhythm, this.time, lamp.phase, reducedMotion);
        if (level < 0.03) continue;
        this.v.copy(lamp.local).applyMatrix4(p.matrix);
        this.addHalo(this.v, lamp.color, lamp.size, level);
      }
    }
  }

  private addHalo(at: Vector3, color: Color, size: number, level: number): void {
    const grow = Math.min(2.6, Math.max(1, Math.pow(at.distanceTo(this.camPos) / REF_DISTANCE, 0.85)));
    this.c.copy(color).multiplyScalar(GLOW.gain);
    this.halos.add(at, null, size * grow, size * grow, 0, this.c, 0.55 * level);
  }

  // -------------------------------------------------------------------------------------------
  // fences and ribbons

  private buildFences(chunks: readonly ChunkBorders[], state: SimState): void {
    const geometry = this.fenceMesh.geometry;
    if (!this.fences) {
      this.counts.fenceVertices = 0;
      return;
    }
    const planner = this.planner!;
    const shown: { piece: BorderPiece; left: Security; right: Security }[] = [];
    for (const c of chunks) for (const piece of c.pieces) {
      const left = this.security(piece.left, state);
      const right = this.security(piece.right, state);
      if (left !== right && piece.points.length >= 2) shown.push({ piece, left, right });
    }
    // neighbours across chunk edges: the normals at a joint come from both pieces (no seam)
    const byStart = new Map<string, BorderPiece>();
    const byEnd = new Map<string, BorderPiece>();
    for (const s of shown) {
      byStart.set(s.piece.startEdge, s.piece);
      byEnd.set(s.piece.endEdge, s.piece);
    }
    const pos: number[] = [];
    const tan: number[] = [];
    const side: number[] = [];
    const uu: number[] = [];
    const row: number[] = [];
    const col: number[] = [];
    const width: number[] = [];
    const flat: number[] = [];
    const scroll: number[] = [];
    const index: number[] = [];
    const strip = (centre: Vec2[], tangents: Vec2[], keep: boolean[], y: number, us: number[], r: number, color: Color, w: number, f: number, sc: number) => {
      const base = pos.length / 3;
      for (let k = 0; k < centre.length; k++) {
        for (const sd of [-1, 1]) {
          pos.push(centre[k]!.x, y, -centre[k]!.y);
          tan.push(tangents[k]!.x, 0, -tangents[k]!.y);
          side.push(sd);
          uu.push(us[k]!);
          row.push(r);
          col.push(color.r, color.g, color.b);
          width.push(w);
          flat.push(f);
          scroll.push(sc);
        }
        if (k > 0 && keep[k] && keep[k - 1]) {
          const a = base + (k - 1) * 2;
          index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
        }
      }
    };
    const color = new Color();
    for (const { piece, left, right } of shown) {
      const pts = piece.points;
      const n = pts.length;
      const prev = byEnd.get(piece.startEdge);
      const next = byStart.get(piece.endEdge);
      const before = piece.loop ? pts[n - 2]! : prev && prev.points.length >= 2 ? prev.points[prev.points.length - 2]! : null;
      const after = piece.loop ? pts[1]! : next && next.points.length >= 2 ? next.points[1]! : null;
      const tangents: Vec2[] = [];
      for (let k = 0; k < n; k++) {
        const a = k > 0 ? pts[k - 1]! : (before ?? pts[k]!);
        const b = k < n - 1 ? pts[k + 1]! : (after ?? pts[k]!);
        const l = Math.hypot(b.x - a.x, b.y - a.y) || 1;
        tangents.push({ x: (b.x - a.x) / l, y: (b.y - a.y) / l });
      }
      const keep = pts.map((p) => !planner.obstacles.nearStation(p, 10));
      // integer repeats per piece: u matches at every joint (u = n ≡ 0)
      const fenceN = Math.max(1, Math.round(piece.length / FENCE.repeat));
      const ribbonN = Math.max(1, Math.round(piece.length / RIBBON.repeat));
      const fenceU = piece.arc.map((s) => (s / Math.max(1e-6, piece.length)) * fenceN);
      const ribbonU = piece.arc.map((s) => (s / Math.max(1e-6, piece.length)) * ribbonN);
      const offset = (sign: number) => pts.map((p, k) => ({ x: p.x - tangents[k]!.y * SIDE_OFFSET * sign, y: p.y + tangents[k]!.x * SIDE_OFFSET * sign }));
      for (const [sec, sign] of [
        [left, 1],
        [right, -1],
      ] as const) {
        const y = MARKER_Y + (this.models.get(sec)?.points.get('fence_l')?.y ?? 2.4);
        color.set(SECURITY_COLOR[sec]).multiplyScalar(FENCE.gain);
        strip(offset(sign), tangents, keep, y, fenceU, FENCE_ROW[sec], color, FENCE.width, 0, sec === 'contested' ? CONTESTED_SCROLL : 0);
      }
      const danger = SECURITY_RANK[left] >= SECURITY_RANK[right] ? left : right;
      color.set(SECURITY_COLOR[danger]).multiplyScalar(RIBBON.opacity);
      strip(pts, tangents, keep, RIBBON_Y, ribbonU, 4, color, RIBBON.width, 1, RIBBON.scroll);
    }
    geometry.dispose();
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
    g.setAttribute('aTangent', new BufferAttribute(new Float32Array(tan), 3));
    g.setAttribute('aSide', new BufferAttribute(new Float32Array(side), 1));
    g.setAttribute('aU', new BufferAttribute(new Float32Array(uu), 1));
    g.setAttribute('aRow', new BufferAttribute(new Float32Array(row), 1));
    g.setAttribute('aColor', new BufferAttribute(new Float32Array(col), 3));
    g.setAttribute('aWidth', new BufferAttribute(new Float32Array(width), 1));
    g.setAttribute('aFlat', new BufferAttribute(new Float32Array(flat), 1));
    g.setAttribute('aScroll', new BufferAttribute(new Float32Array(scroll), 1));
    g.setIndex(index);
    this.fenceMesh.geometry = g;
    this.counts.fenceVertices = index.length > 0 ? pos.length / 3 : 0;
  }

  // -------------------------------------------------------------------------------------------
  // Guild Watch

  /**
   * The patrol routes near the camera aim, into `nearRoutes` (the first `nearCount`): the lanes whose box
   * reaches within PATROL_RANGE, then the sector patrols of the cells around – looked up only when the
   * window of cells moved or the sectors' security changed (audit 2026-10-17 P8: no filter, no key
   * strings, no route boxes per frame).
   */
  private routesNear(target: Vector3, state: SimState): void {
    this.nearCount = 0;
    if (this.patrols === 'none') return;
    const planner = this.planner!;
    const near = (p: Vec2) => planner.obstacles.stationsNear(p);
    if (!this.lanes) {
      this.lanes = lanePatrols(this.seed, sectorLanes(this.seed), near);
      this.laneBoxes = this.lanes.map(routeBox);
    }
    const out = this.nearRoutes;
    const x = target.x;
    const y = -target.z;
    const R = PATROL_RANGE;
    for (let k = 0; k < this.lanes.length; k++) {
      const b = this.laneBoxes[k]!;
      if (x > b.x0 - R && x < b.x1 + R && y > b.y0 - R && y < b.y1 + R) out[this.nearCount++] = this.lanes[k]!;
    }
    if (this.patrols === 'all') {
      // Guarded NOW (static Guarded + secured by a Guild relay) – the same predicate the simulation's
      // schedule uses, so live ships come from the routes drawn here
      const i0 = Math.floor((x - R) / PATROL_CELL);
      const i1 = Math.floor((x + R) / PATROL_CELL);
      const j0 = Math.floor((y - R) / PATROL_CELL);
      const j1 = Math.floor((y + R) / PATROL_CELL);
      const w = this.cellWindow;
      if (w.i0 !== i0 || w.i1 !== i1 || w.j0 !== j0 || w.j1 !== j1) {
        let guarded: GuardedAt | null = null;
        w.routes.length = 0;
        for (let i = i0; i <= i1; i++) {
          for (let j = j0; j <= j1; j++) {
            const key = `${i},${j}`;
            if (!this.sectorRoutes.has(key)) {
              if (this.sectorRoutes.size > 64) this.sectorRoutes.clear();
              guarded ??= guardedNow(state);
              this.sectorRoutes.set(key, sectorPatrol(this.seed, i, j, near, guarded));
            }
            const r = this.sectorRoutes.get(key);
            if (r) w.routes.push(r);
          }
        }
        w.i0 = i0;
        w.i1 = i1;
        w.j0 = j0;
        w.j1 = j1;
      }
      for (const r of w.routes) out[this.nearCount++] = r;
    }
  }

  /** The `route|slot` key of a scenery ship (cached strings). */
  private shipKey(route: string, slot: number): string {
    let keys = this.shipKeys.get(route);
    if (!keys) {
      if (this.shipKeys.size > 256) this.shipKeys.clear();
      keys = [];
      this.shipKeys.set(route, keys);
    }
    return (keys[slot] ??= `${route}|${slot}`);
  }

  private shipsNow: WatchShip[] = [];
  /** Scheduled poses of the live ships' slots this frame (a patrolling live ship is drawn exactly there). */
  private readonly scheduledLive = new Map<string, WatchShip>();
  private readonly liveKeys = new Set<string>();
  private readonly livePose: ShipPose = { kind: 'cutter', pos: { x: 0, y: 0 }, heading: 0, gunYaw: 0, phase: 0 };

  private updateShips(state: SimState, target: Vector3, simTime: number, dt: number, reducedMotion: boolean, halos: boolean): void {
    const batch = this.batch;
    if (!batch) return;
    for (const s of this.ships.values()) s.used = false;
    const ships = this.shipsNow;
    ships.length = 0;
    this.routesNear(target, state);
    for (let k = 0; k < this.nearCount; k++) routeShips(this.nearRoutes[k]!, simTime, ships);
    // live ships (`gw:<route>|<slot>`) leave the scenery, and so do the lost ones until they respawn
    const live = state.guild.watch;
    const lost = state.guild.lost;
    this.liveKeys.clear();
    this.scheduledLive.clear();
    for (const w of live) this.liveKeys.add(w.id.slice(3));
    const x = target.x;
    const y = -target.z;
    let shown = 0;
    for (const ship of ships) {
      const key = this.shipKey(ship.route, ship.slot);
      if (this.liveKeys.has(key)) {
        this.scheduledLive.set(key, ship);
        continue;
      }
      if (lost.size > 0 && lost.has(`gw:${key}`)) continue;
      if (Math.abs(ship.pos.x - x) > PATROL_RANGE * 0.75 || Math.abs(ship.pos.y - y) > PATROL_RANGE * 0.75) continue;
      if (this.drawShip(key, ship, state, reducedMotion ? 0 : ship.gunYaw, reducedMotion, halos)) shown++;
    }
    // the live ships at their interpolated sim pose (simTime = (tick − 1 + alpha) · SIM_DT)
    const alpha = Math.min(1, Math.max(0, simTime / SIM_DT - state.tick + 1));
    let drawn = 0;
    for (const w of live) {
      const key = w.id.slice(3);
      const pose = this.poseOfLive(w, key, state, alpha, dt, reducedMotion);
      if (this.drawShip(key, pose, state, pose.gunYaw, reducedMotion, halos)) drawn++;
    }
    // free the slots of ships that left the window
    for (const [key, slot] of this.ships) {
      if (slot.used) continue;
      for (const id of slot.ids) batch.deleteInstance(id);
      this.ships.delete(key);
    }
    // `ships` = the scenery (thinned by quality), `live` = the sim's Watch ships drawn (every quality)
    this.counts.ships = shown;
    this.counts.live = drawn;
  }

  /**
   * Where a live Watch ship is drawn: in patrol exactly its scheduled pose (when its route is in view);
   * otherwise the sim pose interpolated between the last two steps. Engaged, its guns turn onto the pirate
   * (the cutter's within their ±35° arc of the bow, the frigate's turret all round); else they idle like
   * the scenery's.
   */
  private poseOfLive(w: LiveWatch, key: string, state: SimState, alpha: number, dt: number, reducedMotion: boolean): ShipPose {
    const out = this.livePose;
    const sched = this.scheduledLive.get(key);
    out.kind = w.kind;
    if (w.mode === 'patrol' && sched) {
      out.pos = sched.pos;
      out.heading = sched.heading;
    } else {
      out.pos = lerp(w.prevBody.pos, w.body.pos, alpha);
      out.heading = lerpAngle(w.prevBody.angle, w.body.angle, alpha);
    }
    out.phase = sched?.phase ?? (fnv1a32(key) % 1000) / 1000;
    const idle = reducedMotion ? 0 : (sched?.gunYaw ?? (w.kind === 'frigate' ? this.time * 0.25 + out.phase * 6.283 : 0.6 * Math.sin(this.time * 0.45 + out.phase * 6.283)));
    let want = idle;
    const pirate = w.mode === 'engage' && w.target ? state.combat.enemies.find((e) => e.id === w.target) : undefined;
    if (pirate) {
      const at = lerp(pirate.prevBody.pos, pirate.body.pos, alpha);
      want = normalizeAngle(Math.atan2(at.y - out.pos.y, at.x - out.pos.x) - out.heading);
      const arc = GUN_ARC[w.kind];
      if (arc < Math.PI) want = Math.max(-arc, Math.min(arc, want));
    }
    const slot = this.ships.get(key);
    if (pirate && slot) {
      const step = normalizeAngle(want - slot.yaw);
      out.gunYaw = slot.yaw + Math.max(-GUN_TURN * dt, Math.min(GUN_TURN * dt, step));
    } else out.gunYaw = want;
    return out;
  }

  /** Puts one Watch ship into the batch (its slot kept by `key`) with its lamps; false when there is no room. */
  private drawShip(key: string, ship: ShipPose, state: SimState, gunYaw: number, reducedMotion: boolean, halos: boolean): boolean {
    const batch = this.batch!;
    const entry = this.models.get(ship.kind);
    if (!entry) return false;
    let slot = this.ships.get(key);
    if (slot && slot.kind !== ship.kind) {
      for (const id of slot.ids) batch.deleteInstance(id);
      this.ships.delete(key);
      slot = undefined;
    }
    if (!slot) {
      if (batch.instanceCount + entry.parts.length > MAX_INSTANCES) return false;
      slot = { kind: ship.kind, ids: entry.parts.map((p) => batch.addInstance(p.geometryId)), used: false, yaw: gunYaw };
      this.ships.set(key, slot);
    }
    slot.used = true;
    slot.yaw = gunYaw;
    // dip under the rocks on the way (scenery passes through them; a live ship is pushed out by the sim)
    let depth = 0;
    for (const c of state.world.circlesNear(ship.pos, 14)) {
      const d = Math.hypot(ship.pos.x - c.circle.pos.x, ship.pos.y - c.circle.pos.y);
      const w = 1 - Math.min(1, Math.max(0, (d - c.circle.radius - 2) / 12));
      depth = Math.max(depth, (c.circle.radius + 1.5) * w * w * (3 - 2 * w));
    }
    this.m.compose(this.v.set(ship.pos.x, PATROL_Y - depth, -ship.pos.y), tmpQ.setFromAxisAngle(UP, ship.heading), tmpS.setScalar(1));
    const parts = entry.parts;
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i]!;
      const id = slot.ids[i]!;
      batch.setVisibleAt(id, true);
      this.m2.multiplyMatrices(this.m, part.base);
      if (part.mode === 'yaw') this.m2.multiply(this.anim.makeRotationAxis(UP, gunYaw));
      batch.setMatrixAt(id, this.m2);
    }
    if (!halos) return true;
    for (const lamp of shipLamps(entry, ship.kind)) {
      // a strobe pair blinks half a period apart (lamp.phase 0.5 on strobe_1)
      const level = lampLevel(lamp.rhythm, this.time, lamp.phase === 0 ? ship.phase : ship.phase + lamp.phase, reducedMotion);
      if (level < 0.03) continue;
      this.v.copy(lamp.local).applyMatrix4(this.m);
      this.addHalo(this.v, lamp.color, lamp.size, level);
    }
    return true;
  }

  // -------------------------------------------------------------------------------------------

  /** What the layer shows (tests and tuning). */
  stats(): { loaded: boolean; markers: number; buoys: number; pickets: number; ships: number; live: number; fenceVertices: number; fences: boolean; halos: number; instances: number } {
    return {
      loaded: this.batch !== null,
      ...this.counts,
      fences: this.fenceMesh.visible,
      halos: this.halos.mesh.visible ? ((this.halos.mesh.geometry as { instanceCount?: number }).instanceCount ?? 0) : 0,
      instances: this.batch?.instanceCount ?? 0,
    };
  }

  dispose(): void {
    this.disposed = true;
    this.batch?.dispose();
    this.material?.dispose();
    this.halos.dispose();
    this.fenceMesh.geometry.dispose();
    this.fenceMaterial.dispose();
    this.fenceTexture?.dispose();
    this.placed = [];
    this.ships.clear();
    this.object.removeFromParent();
  }
}
