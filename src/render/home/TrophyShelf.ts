// Trophies on the trophy hall's pedestals (M4c plan §2.3, T5): following `trophyShelf(state)`, a
// defeated captain stands there as a small display model of his ship – `captainGrid(level)` in his
// clan's colours (replica.ts: stepped wings, body and ridge, canopy, nozzles, guns) –
// and a destroyed fortress as the `trophy_fortress` miniature (art A1).
//
// Budget (plan T5: a full shelf ≤ 12 draw calls over all passes, ≤ 20k triangles): a replica is ONE
// mesh of ≤ REPLICA_TRIANGLES on the parts' shared AF_Palette material (no material or program of its
// own), the fortress is one mesh too, and the shelf neither casts shadows nor enters the AO normal
// pass (`userData.noShadow` / `noAO` on every pedestal holder) – one draw call per trophy.
// Replicas of the same clan and level share their geometry (cached for the layer's life); building
// one takes well under a millisecond, so it happens on the spot.
//
// The pedestals are the hall's `trophy_<i>` empties (HomeModules.trophyAnchors(): empty while the hall
// is not shown, i.e. not built or the home station out of range); each trophy hangs under its empty
// with an identity holder, so it shows, hides and moves with the hall. Nothing is built before the
// hall is in view; the shelf is re-read a few times a second and a pedestal is rebuilt only when
// what stands on it changes.
import { BufferAttribute, BufferGeometry, Group, Matrix4, Mesh, MeshStandardMaterial, Vector3, type Material, type Object3D } from 'three';
import type { FactionId } from '../../data/factions';
import { TROPHY_FORTRESS_FILE, TROPHY_PEDESTALS } from '../../data/home';
import { captainDef, captainGrid, captainLevel } from '../../sim/captains/captains';
import { trophyShelf } from '../../sim/home';
import type { TrophyId } from '../../sim/home/types';
import type { ShipGrid } from '../../sim/ship/types';
import type { SimState } from '../../sim/Simulation';
import { createModelLoader } from '../assets/gltf';
import { loadModelScene, type ModelLibrary } from '../assets/ModelLibrary';
import type { SwatchLookup } from '../hull/shellGeometry';
import type { WarmUpZoo } from '../warmup';
import type { HomeModules } from './HomeModules';
import { displayModel, mergeSoups, pedestalFit, pitchSoup, postSoup, replicaSwatches, REPLICA_PITCH, soupBounds, trophyYaw, type MeshSoup, type PedestalFit } from './replica';

/** Seconds between two reads of the shelf while nothing is pending. */
const CHECK_INTERVAL = 0.25;
export const FORTRESS_PATH = `assets/models/stations/${TROPHY_FORTRESS_FILE}.glb`;

/** What a pedestal should show. */
type Wanted = { key: string; kind: 'captain'; clan: FactionId; level: number } | { key: string; kind: 'fortress' };

/** A built replica (shared by every pedestal showing the same clan and level). */
interface Replica {
  geometry: BufferGeometry;
  material: Material;
  fit: PedestalFit;
}

interface Pedestal {
  /** Identity child of the `trophy_<i>` empty. */
  holder: Group;
  /** Turns the trophy (rotation.y). */
  spinner: Group;
  content: Object3D | null;
  key: string | null;
  turning: boolean;
}

const opaqueStandard = (m: Material): boolean => m instanceof MeshStandardMaterial && !m.transparent;

/**
 * The display model of the ship `grid` in `clan`'s colours, pitched nose-up, with its post, and how
 * it sits on a pedestal (the fit scales and lifts the soup). Null while the swatch table is missing.
 */
export function replicaSoup(grid: ShipGrid, clan: FactionId | null, swatchUv: SwatchLookup): { soup: MeshSoup; fit: PedestalFit } | null {
  const cockpit = grid.parts.find((p) => p.partId === 'cockpit');
  const swatches = replicaSwatches(clan, cockpit?.tier ?? 1, swatchUv);
  if (!swatches) return null;
  const model = pitchSoup(displayModel(grid, swatches), REPLICA_PITCH);
  const fit = pedestalFit(soupBounds(model), true);
  return { soup: mergeSoups(model, postSoup(fit, REPLICA_PITCH, swatches.metal)), fit };
}

/** A soup as a three.js geometry. */
export function soupGeometry(soup: MeshSoup): BufferGeometry {
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(soup.positions, 3));
  g.setAttribute('normal', new BufferAttribute(soup.normals, 3));
  g.setAttribute('uv', new BufferAttribute(soup.uvs, 2));
  g.setIndex(new BufferAttribute(soup.indices, 1));
  g.computeBoundingSphere();
  return g;
}

export class TrophyShelf {
  readonly object = new Group();
  private readonly pedestals: Pedestal[] = [];
  private readonly replicas = new Map<string, Replica>();
  private readonly loader = createModelLoader();
  private fortress: Object3D | null = null;
  private fortressLoad: Promise<void> | null = null;
  private fortressMaterials = new Set<Material>();
  private fortressGeometries = new Set<BufferGeometry>();
  private time = 0;
  private sinceCheck = Infinity;
  /** Re-read the shelf on the next frame (a download finished). */
  private dirty = true;
  private disposed = false;
  /** Triangles of the last build of each replica key (tests, the perf hook). */
  readonly triangles = new Map<string, number>();

  constructor(
    protected readonly library: ModelLibrary,
    /** Source of the pedestal anchors (`trophyAnchors()`). */
    protected readonly modules: HomeModules,
  ) {
    this.object.name = 'trophy-shelf';
    for (let i = 0; i < TROPHY_PEDESTALS; i++) {
      const holder = new Group();
      holder.name = `trophy-${i}`;
      // one draw call per trophy: no shadow map, no AO normal pass (ShadowRig, AoPass)
      holder.userData.noShadow = true;
      holder.userData.noAO = true;
      const spinner = new Group();
      holder.add(spinner);
      this.pedestals.push({ holder, spinner, content: null, key: null, turning: false });
    }
  }

  /**
   * Per frame: keep the pedestals in step with `trophyShelf(state)` and turn the trophies slowly
   * (still with reduced motion).
   */
  update(state: SimState, _alpha: number, dt: number, reducedMotion = false): void {
    this.time += dt;
    const anchors = this.modules.trophyAnchors();
    if (anchors.length === 0) return;
    this.sinceCheck += dt;
    if (this.dirty || this.sinceCheck >= CHECK_INTERVAL) {
      this.sinceCheck = 0;
      this.sync(state);
    }
    for (let i = 0; i < this.pedestals.length; i++) {
      const ped = this.pedestals[i]!;
      const anchor = anchors[i];
      if (!anchor) continue;
      if (ped.holder.parent !== anchor) anchor.add(ped.holder);
      ped.spinner.rotation.y = ped.turning ? trophyYaw(i, this.time, reducedMotion) : 0;
    }
  }

  /**
   * What stands on each pedestal now. A replica is built on first use; until the palette material and
   * the swatch table are there (the player's parts load first), the pedestal keeps what it had.
   */
  private sync(state: SimState): void {
    this.dirty = false;
    const shelf = trophyShelf(state);
    for (let i = 0; i < this.pedestals.length; i++) {
      const ped = this.pedestals[i]!;
      const want = this.wanted(state, shelf[i] ?? null);
      if ((want?.key ?? null) === ped.key) continue;
      if (!want) {
        this.show(ped, null, null, false);
        continue;
      }
      if (want.kind === 'fortress') {
        const model = this.fortressModel();
        if (model) this.show(ped, want.key, model, false);
        continue;
      }
      const replica = this.replica(want.key, want.clan, want.level);
      if (!replica) continue;
      const mesh = new Mesh(replica.geometry, replica.material);
      mesh.name = `trophy-replica-${want.key}`;
      mesh.scale.setScalar(replica.fit.scale);
      mesh.position.set(...replica.fit.offset);
      this.show(ped, want.key, mesh, true);
    }
  }

  /** The cached replica of `clan` at `level`, built now when missing (null without the palette yet). */
  private replica(key: string, clan: FactionId, level: number): Replica | null {
    const cached = this.replicas.get(key);
    if (cached) return cached;
    const material = this.paletteMaterial();
    const built = material ? replicaSoup(captainGrid(level), clan, this.library.swatchUv) : null;
    if (!material || !built) return null;
    const replica = { geometry: soupGeometry(built.soup), material, fit: built.fit };
    this.replicas.set(key, replica);
    this.triangles.set(key, built.soup.indices.length / 3);
    return replica;
  }

  /** The parts' shared AF_Palette material (of the first loaded part model), or null before they load. */
  private paletteMaterial(): Material | null {
    for (const id of ['armor', 'cockpit', 'engine'] as const) {
      const meshes: Mesh[] = [];
      this.library.part(id)?.traverse((o) => {
        if (o instanceof Mesh) meshes.push(o);
      });
      for (const mesh of meshes) {
        const m = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
        if (m && opaqueStandard(m)) return m;
      }
    }
    return null;
  }

  private wanted(state: SimState, id: TrophyId | null): Wanted | null {
    if (id === null) return null;
    if (id.startsWith('fort:')) return { key: 'fortress', kind: 'fortress' };
    const index = Number(id.slice('cap:'.length));
    const def = captainDef(state.seed, index);
    if (!def) return null;
    const level = captainLevel(def, state.career.captains.get(index));
    return { key: `${def.clan}:${level}`, kind: 'captain', clan: def.clan, level };
  }

  private show(ped: Pedestal, key: string | null, content: Object3D | null, turning: boolean): void {
    if (ped.content) ped.spinner.remove(ped.content);
    ped.content = content;
    ped.key = key;
    ped.turning = turning;
    if (content) ped.spinner.add(content);
  }

  /** A fresh clone of the fortress trophy (shared geometry), or null while it loads / when missing. */
  private fortressModel(): Object3D | null {
    if (this.fortress) {
      const clone = this.fortress.clone();
      clone.visible = true;
      return clone;
    }
    void this.loadFortress();
    return null;
  }

  private loadFortress(): Promise<void> {
    this.fortressLoad ??= loadModelScene(this.loader, FORTRESS_PATH).then((scene) => {
      if (!scene || this.disposed) return;
      scene.traverse((o) => {
        if (!(o instanceof Mesh)) return;
        this.fortressGeometries.add(o.geometry as BufferGeometry);
        for (const m of Array.isArray(o.material) ? o.material : [o.material]) this.fortressMaterials.add(m);
      });
      scene.updateMatrixWorld(true);
      const root = new Group();
      root.name = 'trophy-fortress';
      const fit = pedestalFit(objectBounds(scene), false);
      scene.scale.multiplyScalar(fit.scale);
      scene.position.set(...fit.offset);
      root.add(scene);
      this.fortress = root;
      this.dirty = true;
    });
    return this.fortressLoad;
  }

  /** Samples of the trophy materials for the shader warm-up: the fortress model (the replicas use the part materials). */
  async warmUp(zoo: WarmUpZoo): Promise<void> {
    await this.loadFortress();
    if (this.disposed || !this.fortress) return;
    zoo.add(this.fortress.clone());
  }

  dispose(): void {
    this.disposed = true;
    for (const ped of this.pedestals) ped.holder.removeFromParent();
    for (const r of this.replicas.values()) r.geometry.dispose();
    this.replicas.clear();
    for (const g of this.fortressGeometries) g.dispose();
    for (const m of this.fortressMaterials) m.dispose();
    this.object.removeFromParent();
  }
}

/** Bounds of every mesh vertex of `root` in its own frame (matrices up to date). */
function objectBounds(root: Object3D): { min: [number, number, number]; max: [number, number, number] } {
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  const inverse = new Matrix4().copy(root.matrixWorld).invert();
  const m = new Matrix4();
  const v = new Vector3();
  root.traverse((o) => {
    if (!(o instanceof Mesh)) return;
    m.multiplyMatrices(inverse, o.matrixWorld);
    const pos = (o.geometry as BufferGeometry).getAttribute('position');
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(m);
      min[0] = Math.min(min[0], v.x);
      min[1] = Math.min(min[1], v.y);
      min[2] = Math.min(min[2], v.z);
      max[0] = Math.max(max[0], v.x);
      max[1] = Math.max(max[1], v.y);
      max[2] = Math.max(max[2], v.z);
    }
  });
  return { min, max };
}
