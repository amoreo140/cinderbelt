// Home modules on the home station model (M4c plan §1, T4): each built module (`state.home.modules`)
// is loaded through `createModelLoader()` and placed on the station's `attach_<slot>` empty (module
// +X along the empty's +X, art/README.md §2.7.10), visible in the hub and in flight while the home
// station has a view. The paint shop's gantry slides after `shipPainted`; the trophy hall's
// `trophy_0..5` empties go to the TrophyShelf (T5).
//
// Draw calls: a module model is a body mesh with lamps and animated child meshes. It is rebuilt into
// at most three meshes – the static body, the merged lamps (own material, blinking) and one mesh per
// animated node (the M4c modules have at most one) – see `prepareModule`.
import { Group, Matrix4, Mesh, Object3D, type BufferGeometry, type Material } from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { HOME_MODULES, HOME_MODULE_IDS, isBuildableModule, type HomeModuleId } from '../../data/home';
import type { SimEvent, SimState } from '../../sim/Simulation';
import { HOME_STATION_ID, homeStation } from '../../sim/world/stations';
import { createModelLoader } from '../assets/gltf';
import { loadModelScene, toFloatAttributes, type ModelLibrary } from '../assets/ModelLibrary';
import { simToWorld } from '../coords';
import type { StationLayer } from '../StationView';
import { beaconLevel } from '../stationAnim';
import type { WarmUpZoo } from '../warmup';
import { gantryOffset, slotPose } from './moduleLook';

/** Animated nodes of the module models (art/README.md §2.3): each keeps its own mesh. */
export const MODULE_ANIMATED_NODES: readonly string[] = ['Paint_Gantry', 'Refinery_Rotor', 'Obs_Dome', 'Lab_Relic', 'DroneHub_Radar'];

/** Spin of the animated nodes about their local +Y (rad/s); the gantry slides instead. */
const SPIN: Readonly<Record<string, number>> = { Refinery_Rotor: 0.9, Obs_Dome: 0.08, Lab_Relic: 0.5, DroneHub_Radar: 1.6 };

const modelPath = (id: HomeModuleId): string => `assets/models/stations/${HOME_MODULES[id].file}.glb`;
/** Its model files – the boot list downloads them ahead of the game (assets/bootAssets.ts). */
export const HOME_MODULE_PATHS: readonly string[] = HOME_MODULE_IDS.filter(isBuildableModule).map(modelPath);

type EmissiveMaterial = Material & { emissiveIntensity: number };
const hasEmissive = (m: Material): m is EmissiveMaterial => 'emissiveIntensity' in m;

/** A module model rebuilt for drawing (≤ 3 meshes). */
export interface PreparedModule {
  root: Object3D;
  /** The merged lamps (`beacon_<i>`) with their own material, or null. */
  beacons: Mesh | null;
  /** Animated nodes by name (they carry their merged mesh as a child). */
  nodes: Map<string, Object3D>;
  /** Named empties (`trophy_<i>`, `paint_bay`, …) by name. */
  empties: Map<string, Object3D>;
  /** Geometries and materials made here (freed with the layer). */
  geometries: BufferGeometry[];
  materials: Material[];
}

const firstMaterial = (m: Mesh): Material => (Array.isArray(m.material) ? m.material[0]! : m.material);

/** One geometry of `meshes` in the frame of `anchor`, or null when they cannot be merged. */
function mergeInto(anchor: Object3D, meshes: readonly Mesh[]): BufferGeometry | null {
  const inverse = new Matrix4().copy(anchor.matrixWorld).invert();
  const parts = meshes.map((m) => toFloatAttributes(m.geometry.clone()).applyMatrix4(new Matrix4().multiplyMatrices(inverse, m.matrixWorld)));
  // only the attributes every part has (mergeGeometries wants the same set)
  const names = Object.keys(parts[0]!.attributes).filter((n) => parts.every((g) => g.getAttribute(n) !== undefined));
  for (const g of parts) for (const n of Object.keys(g.attributes)) if (!names.includes(n)) g.deleteAttribute(n);
  const mixed = parts.some((g) => g.index) && parts.some((g) => !g.index);
  const merged = mergeGeometries(mixed ? parts.map((g) => (g.index ? g.toNonIndexed() : g)) : parts, false);
  for (const g of parts) g.dispose();
  merged?.computeBoundingSphere();
  return merged;
}

/** A mesh node becomes a plain node with the same name, transform and children. */
function replaceWithNode(mesh: Mesh): Object3D {
  const node = new Object3D();
  node.name = mesh.name;
  node.position.copy(mesh.position);
  node.quaternion.copy(mesh.quaternion);
  node.scale.copy(mesh.scale);
  while (mesh.children.length > 0) node.add(mesh.children[0]!);
  const parent = mesh.parent;
  if (parent) {
    parent.add(node);
    parent.remove(mesh);
  }
  return node;
}

/**
 * Rebuilds a loaded module model for drawing: all static meshes merge into one body mesh, the
 * `beacon_<i>` lamps into one mesh with a material of their own (so they can blink without touching
 * the body), and every animated node (`MODULE_ANIMATED_NODES`) with its child meshes into one mesh
 * under that node. Empties and the node hierarchy stay. A group whose meshes use different materials
 * is left as it was (never the case for the AF_Palette modules).
 */
export function prepareModule(scene: Object3D): PreparedModule {
  scene.updateMatrixWorld(true);
  const groups = new Map<Object3D | 'beacons', Mesh[]>();
  const add = (key: Object3D | 'beacons', mesh: Mesh): void => {
    const list = groups.get(key);
    if (list) list.push(mesh);
    else groups.set(key, [mesh]);
  };
  const animatedOf = (o: Object3D): Object3D | null => {
    for (let p: Object3D | null = o; p && p !== scene; p = p.parent) if (MODULE_ANIMATED_NODES.includes(p.name)) return p;
    return null;
  };
  const empties = new Map<string, Object3D>();
  scene.traverse((o) => {
    if (o instanceof Mesh) {
      if (/^beacon_\d+$/.test(o.name)) add('beacons', o);
      else add(animatedOf(o) ?? scene, o);
    } else if (o !== scene && o.name && o.children.length === 0) empties.set(o.name, o);
  });

  const out: PreparedModule = { root: scene, beacons: null, nodes: new Map(), empties, geometries: [], materials: [] };
  const old = new Set<BufferGeometry>();
  const replaced = new Map<Object3D, Object3D>();
  const built: { anchor: Object3D; mesh: Mesh; key: Object3D | 'beacons' }[] = [];
  for (const [key, meshes] of groups) {
    const material = firstMaterial(meshes[0]!);
    if (meshes.some((m) => firstMaterial(m) !== material)) continue;
    const anchor = key === 'beacons' ? scene : key;
    const geometry = mergeInto(anchor, meshes);
    if (!geometry) continue;
    out.geometries.push(geometry);
    let own = material;
    if (key === 'beacons') {
      own = material.clone();
      out.materials.push(own);
    }
    const mesh = new Mesh(geometry, own);
    mesh.name = key === 'beacons' ? 'module_beacons' : `${anchor.name || 'module'}_mesh`;
    built.push({ anchor, mesh, key });
    for (const m of meshes) {
      old.add(m.geometry);
      replaced.set(m, replaceWithNode(m));
    }
  }
  for (const { anchor, mesh, key } of built) {
    const parent = replaced.get(anchor) ?? anchor;
    parent.add(mesh);
    if (key === 'beacons') out.beacons = mesh;
    else if (key !== scene) out.nodes.set(parent.name, parent);
  }
  // the loaded geometries were never drawn: the merged copies replace them
  for (const g of old) g.dispose();
  return out;
}

interface Entry {
  id: HomeModuleId;
  module: PreparedModule;
  /** The empty the module was last placed on (null = the slot table, placeholder station). */
  anchor: Object3D | null;
  placed: boolean;
  /** Paint_Gantry and its parked x. */
  gantry: { node: Object3D; x: number } | null;
  spins: { node: Object3D; speed: number }[];
  beacon: { material: EmissiveMaterial; base: number } | null;
}

export class HomeModules {
  readonly object = new Group();
  private readonly entries = new Map<HomeModuleId, Entry>();
  private readonly loading = new Map<HomeModuleId, Promise<void>>();
  private readonly loader = createModelLoader();
  /** Body materials of the loaded models (freed with the layer; the atlas textures are shared). */
  private readonly modelMaterials = new Set<Material>();
  private time = 0;
  /** Layer time of the last `shipPainted` (the gantry works for GANTRY_TIME after it). */
  private paintedAt = -Infinity;
  private disposed = false;

  constructor(
    protected readonly library: ModelLibrary,
    protected readonly stations: StationLayer,
  ) {
    this.object.name = 'home-modules';
  }

  /** Starts loading a module's model once (never rejects; a missing file leaves the slot empty). */
  private load(id: HomeModuleId): Promise<void> {
    let p = this.loading.get(id);
    if (!p) {
      p = loadModelScene(this.loader, modelPath(id)).then((scene) => {
        if (!scene || this.disposed) return;
        scene.traverse((o) => {
          if (o instanceof Mesh) for (const m of Array.isArray(o.material) ? o.material : [o.material]) this.modelMaterials.add(m);
        });
        this.entries.set(id, this.entry(id, prepareModule(scene)));
      });
      this.loading.set(id, p);
    }
    return p;
  }

  private entry(id: HomeModuleId, module: PreparedModule): Entry {
    const root = module.root;
    root.name = `home-module-${id}`;
    root.visible = false;
    this.object.add(root);
    const gantryNode = module.nodes.get('Paint_Gantry');
    const spins: Entry['spins'] = [];
    for (const [name, node] of module.nodes) {
      const speed = SPIN[name];
      if (speed) spins.push({ node, speed });
    }
    let beacon: Entry['beacon'] = null;
    if (module.beacons) {
      const m = firstMaterial(module.beacons);
      if (hasEmissive(m)) beacon = { material: m, base: Math.max(m.emissiveIntensity, 0.5) };
    }
    return { id, module, anchor: null, placed: false, gantry: gantryNode ? { node: gantryNode, x: gantryNode.position.x } : null, spins, beacon };
  }

  /** Puts the module on its slot: the station model's empty, or the slot table for a placeholder. */
  private place(e: Entry, anchor: Object3D | null): void {
    const root = e.module.root;
    if (anchor) {
      anchor.updateWorldMatrix(true, false);
      anchor.matrixWorld.decompose(root.position, root.quaternion, root.scale);
    } else {
      const pose = slotPose(homeStation(), HOME_MODULES[e.id].slot);
      simToWorld(pose.pos, pose.height, root.position);
      root.quaternion.identity();
      root.rotation.set(0, pose.yaw, 0);
      root.scale.setScalar(1);
    }
    e.anchor = anchor;
    e.placed = true;
  }

  /** Per frame: show the built modules at the home station's attach points and animate them. */
  update(state: SimState, _alpha: number, dt: number): void {
    this.time += dt;
    const owned = state.home.modules;
    for (const id of owned) if (!this.loading.has(id)) void this.load(id);
    // the home station's view exists only while its chunk is active
    const points = this.stations.attachPoints(HOME_STATION_ID);
    for (const e of this.entries.values()) {
      const root = e.module.root;
      root.visible = points !== null && owned.has(e.id);
      if (!root.visible) continue;
      const anchor = points!.get(HOME_MODULES[e.id].slot) ?? null;
      if (!e.placed || anchor !== e.anchor) this.place(e, anchor);
      if (e.gantry) e.gantry.node.position.x = e.gantry.x + gantryOffset(this.time - this.paintedAt);
      for (const s of e.spins) s.node.rotation.y = (s.node.rotation.y + s.speed * dt) % (Math.PI * 2);
      if (e.beacon) e.beacon.material.emissiveIntensity = e.beacon.base * beaconLevel(this.time, 5 + HOME_MODULE_IDS.indexOf(e.id));
    }
  }

  /** Simulation events of the last step (`shipPainted` → the gantry). */
  onEvents(events: readonly SimEvent[]): void {
    for (const e of events) if (e.type === 'shipPainted') this.paintedAt = this.time;
  }

  /** The trophy hall's pedestal empties `trophy_0..5` (empty while the hall is not shown). */
  trophyAnchors(): readonly Object3D[] {
    const hall = this.entries.get('trophyHall');
    if (!hall || !hall.module.root.visible) return [];
    const out: Object3D[] = [];
    for (let i = 0; ; i++) {
      const node = hall.module.empties.get(`trophy_${i}`);
      if (!node) break;
      out.push(node);
    }
    return out;
  }

  /** Samples of every buildable module's materials for the shader warm-up (waits for the models). */
  async warmUp(zoo: WarmUpZoo): Promise<void> {
    await Promise.all(HOME_MODULE_IDS.filter(isBuildableModule).map((id) => this.load(id)));
    if (this.disposed) return;
    for (const e of this.entries.values()) {
      const sample = e.module.root.clone();
      sample.visible = true;
      zoo.add(sample);
    }
  }

  dispose(): void {
    this.disposed = true;
    for (const e of this.entries.values()) {
      for (const g of e.module.geometries) g.dispose();
      for (const m of e.module.materials) m.dispose();
    }
    for (const m of this.modelMaterials) m.dispose();
    this.entries.clear();
    this.object.removeFromParent();
  }
}
