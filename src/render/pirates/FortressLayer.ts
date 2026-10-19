// Rust fortresses and clan beacons in the scene (M3.6): the fortress model with blinking mast lamps,
// pirate cannons on the four turret mounts aiming at the player, a shield dome over the core while
// the generators stand (flashes when hit), generators and turrets that disappear when destroyed and
// the core that goes dark with the fortress. Clan beacons spin their lamp. Models load through
// createModelLoader when a fortress or beacon is first in view.
import {
  AdditiveBlending,
  BackSide,
  CylinderGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Quaternion,
  SphereGeometry,
  Vector3,
  type BufferGeometry,
  type Material,
  type Object3D,
} from 'three';
import { FORTRESS } from '../../data/pirates';
import { clamp, normalizeAngle } from '../../sim/math/angle';
import { length, sub } from '../../sim/math/vec2';
import { coreShielded, fortressAlive, fortressStatus } from '../../sim/pirates/fortress';
import { FORTRESS_LAYOUT, fortressSites, fortressToWorld, type FortressSite } from '../../sim/pirates/sites';
import type { SimEvent, SimState } from '../../sim/Simulation';
import { tierMaterial } from '../assets/catalog';
import type { ModelLibrary } from '../assets/ModelLibrary';
import { fetchAsset } from '../assets/ModelLibrary';
import { createModelLoader, guardPaletteMaterials } from '../assets/gltf';
import { assetUrl } from '../assets/url';
import { applyLivery } from '../combat/livery';
import { simToWorld } from '../coords';
import type { WarmUpZoo } from '../warmup';

const MODELS = {
  fortress: 'assets/models/pirates/hrdzava_pevnost.glb',
  beacon: 'assets/models/pirates/pirate_beacon.glb',
} as const;
/** Its model files – the boot list downloads them ahead of the game (assets/bootAssets.ts). */
export const FORTRESS_MODEL_PATHS: readonly string[] = Object.values(MODELS);
type ModelKey = keyof typeof MODELS;

const VIEW_RANGE = 700;
/** Turret guns are pirate cannons, scaled to the fortress. */
const TURRET_SCALE = 2.4;
const TURRET_ARC = (100 * Math.PI) / 180;
const BEACON_SCALE = 2.6;
const DOME_RADIUS = 12.5;
const SHIELD = 0x7cc8ff;
const AXIS_Y = new Vector3(0, 1, 0);
const tmpQ = new Quaternion();

interface TurretRig {
  holder: Object3D;
  head: Object3D | null;
  base: Quaternion;
  angle: number;
}

interface FortressEntry {
  group: Group;
  real: boolean;
  core: Object3D | null;
  gens: (Object3D | null)[];
  turrets: TurretRig[];
  lamps: Object3D[];
  dome: Mesh;
  domeMat: MeshBasicMaterial;
  flash: number;
  /** Geometries/materials built for this fortress alone (dome material, placeholders) – released with it. */
  owned: Owned[];
}

type Owned = BufferGeometry | Material;

interface BeaconEntry {
  group: Group;
  real: boolean;
  spin: Object3D | null;
  lamp: Object3D | null;
  owned: Owned[];
}

/** The fortress shield dome (one per fortress). */
const domeMaterial = (): MeshBasicMaterial =>
  new MeshBasicMaterial({ color: SHIELD, transparent: true, opacity: 0.12, blending: AdditiveBlending, depthWrite: false, side: BackSide });

export class FortressLayer {
  readonly object = new Group();
  private readonly templates = new Map<ModelKey, Object3D>();
  private readonly loads = new Map<ModelKey, Promise<void>>();
  private readonly fortresses = new Map<string, FortressEntry>();
  private readonly beacons = new Map<string, BeaconEntry>();
  private readonly geometries = new Set<BufferGeometry>();
  private readonly materials = new Set<Material>();
  private disposed = false;
  private time = 0;
  private readonly domeGeo: BufferGeometry;
  /** While a fortress or beacon is being built: what `own()` / `ownMat()` create for it. */
  private collecting: Owned[] | null = null;

  constructor(private readonly library: ModelLibrary) {
    this.object.name = 'fortresses';
    this.domeGeo = this.own(new SphereGeometry(DOME_RADIUS, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2));
  }

  private own<T extends BufferGeometry>(g: T): T {
    this.geometries.add(g);
    this.collecting?.push(g);
    return g;
  }

  /**
   * Shader warm-up: the fortress and beacon models (loaded now, not at first sight), the shield dome
   * and the placeholders. Resolves when the models are in.
   */
  async warmUp(zoo: WarmUpZoo): Promise<void> {
    zoo.add(new Mesh(this.domeGeo, domeMaterial()));
    await Promise.all([this.request('fortress'), this.request('beacon')]);
    for (const key of ['fortress', 'beacon'] as const) {
      const t = this.templates.get(key);
      if (t) zoo.add(t.clone(true));
    }
  }

  private ownMat<T extends Material>(m: T): T {
    this.materials.add(m);
    this.collecting?.push(m);
    return m;
  }

  /** Builds an entry and records which geometries/materials belong to it alone. */
  private build<T extends { owned: Owned[] }>(make: () => Omit<T, 'owned'>): T {
    const owned: Owned[] = [];
    this.collecting = owned;
    try {
      return { ...make(), owned } as T;
    } finally {
      this.collecting = null;
    }
  }

  /** Fortresses come and go as the ship flies – their own resources must not pile up on the GPU. */
  private release(owned: readonly Owned[]): void {
    for (const x of owned) {
      x.dispose();
      if ('isMaterial' in x) this.materials.delete(x as Material);
      else this.geometries.delete(x as BufferGeometry);
    }
  }

  /** Loads a model once (placeholders rebuild with it); resolves when it is in (or failed). */
  private request(key: ModelKey): Promise<void> {
    const known = this.loads.get(key);
    if (known || this.disposed) return known ?? Promise.resolve();
    const load = (async () => {
      try {
        const data = await fetchAsset(MODELS[key]);
        if (!data || this.disposed) return;
        const gltf = await createModelLoader().parseAsync(data, assetUrl(MODELS[key]).replace(/[^/]*$/, ''));
        if (this.disposed) return;
        guardPaletteMaterials(gltf.scene);
        gltf.scene.traverse((o) => {
          if (o instanceof Mesh) {
            this.geometries.add(o.geometry);
            for (const m of Array.isArray(o.material) ? o.material : [o.material]) this.materials.add(m);
          }
        });
        this.templates.set(key, gltf.scene);
        // rebuild placeholders with the model
        if (key === 'fortress') for (const [id, e] of [...this.fortresses]) if (!e.real) this.removeFortress(id);
        if (key === 'beacon') for (const [id, e] of [...this.beacons]) if (!e.real) this.removeBeacon(id);
      } catch (e) {
        console.warn(`Pirate model failed to load: ${MODELS[key]}`, e);
      }
    })();
    this.loads.set(key, load);
    return load;
  }

  private buildFortress(site: FortressSite): Omit<FortressEntry, 'owned'> {
    void this.request('fortress');
    const group = new Group();
    simToWorld(site.pos, 0, group.position);
    group.rotation.y = site.angle;
    const t = this.templates.get('fortress');
    const model = t ? t.clone(true) : this.placeholderFortress();
    group.add(model);
    const turrets: TurretRig[] = [];
    FORTRESS_LAYOUT.turrets.forEach((mount, i) => {
      // the turret empty of the model, or a holder placed from the layout
      let holder = model.getObjectByName(`turret_${i}`) ?? null;
      if (!holder) {
        holder = new Group();
        simToWorld({ x: mount.x, y: mount.y }, mount.z, holder.position);
        holder.rotation.y = (mount.yawDeg * Math.PI) / 180;
        model.add(holder);
      }
      const gun = this.library.part('cannon', tierMaterial(2));
      const node = gun ? gun.clone() : this.turretPlaceholder();
      node.scale.setScalar(TURRET_SCALE);
      applyLivery(node, 'pirate');
      holder.add(node);
      const head = node.getObjectByName('Cannon_Turret') ?? null;
      turrets.push({ holder: node, head, base: head ? head.quaternion.clone() : new Quaternion(), angle: 0 });
    });
    const lamps: Object3D[] = [];
    model.traverse((o) => {
      if (/^beacon_\d+$/.test(o.name)) lamps.push(o);
    });
    const domeMat = this.ownMat(domeMaterial());
    const dome = new Mesh(this.domeGeo, domeMat);
    simToWorld(FORTRESS_LAYOUT.core, 0.5, dome.position);
    dome.scale.set(1, 0.55, 1);
    model.add(dome);
    return {
      group,
      real: t !== undefined,
      core: model.getObjectByName('fortress_core') ?? null,
      gens: [0, 1].map((i) => model.getObjectByName(`shield_gen_${i}`) ?? null),
      turrets,
      lamps,
      dome,
      domeMat,
      flash: 0,
    };
  }

  /** Stand-in gun when the cannon model is missing: one geometry and material shared by every mount
   *  (the livery clones the material once per source, so a fresh one per turret would pile up). */
  private turretStandIn: { geometry: BufferGeometry; material: Material } | null = null;

  private turretPlaceholder(): Mesh {
    if (!this.turretStandIn) {
      const geometry = new CylinderGeometry(0.25, 0.35, 0.6, 8);
      const material = new MeshStandardMaterial({ color: 0x5a3a30 });
      this.geometries.add(geometry);
      this.materials.add(material);
      this.turretStandIn = { geometry, material };
    }
    return new Mesh(this.turretStandIn.geometry, this.turretStandIn.material);
  }

  private placeholderFortress(): Object3D {
    return new Mesh(this.own(new SphereGeometry(9.5, 16, 10)), this.ownMat(new MeshStandardMaterial({ color: 0x5b4a40, roughness: 0.9, flatShading: true })));
  }

  private buildBeacon(site: FortressSite): Omit<BeaconEntry, 'owned'> {
    void this.request('beacon');
    const group = new Group();
    simToWorld(site.beacon.pos, 0, group.position);
    const t = this.templates.get('beacon');
    if (t) {
      const model = t.clone(true);
      model.scale.setScalar(BEACON_SCALE);
      group.add(model);
      return { group, real: true, spin: model.getObjectByName('Beacon_Spin') ?? null, lamp: model.getObjectByName('beacon_0') ?? null };
    }
    const m = new Mesh(this.own(new CylinderGeometry(0.4, 0.8, 4, 6)), this.ownMat(new MeshStandardMaterial({ color: 0x6b2a22, emissive: 0xff3a2a, emissiveIntensity: 0.3 })));
    m.position.y = 2;
    group.add(m);
    return { group, real: false, spin: null, lamp: null };
  }

  private removeFortress(id: string): void {
    const e = this.fortresses.get(id);
    if (!e) return;
    this.object.remove(e.group);
    this.fortresses.delete(id);
    this.release(e.owned);
  }

  private removeBeacon(id: string): void {
    const e = this.beacons.get(id);
    if (!e) return;
    this.object.remove(e.group);
    this.beacons.delete(id);
    this.release(e.owned);
  }

  /** Shield flashes on hits at a shielded core. */
  onEvents(events: readonly SimEvent[]): void {
    for (const e of events) {
      if (e.type === 'projectileHit' && e.fortress && e.target === 'shield') {
        const f = this.fortresses.get(e.fortress);
        if (f) f.flash = 1;
      }
    }
  }

  update(state: SimState, frameDt: number): void {
    this.time += frameDt;
    const pos = state.player.body.pos;
    for (const site of fortressSites(state.seed)) {
      const near = length(sub(site.pos, pos)) <= VIEW_RANGE;
      if (!near) {
        this.removeFortress(site.id);
        this.removeBeacon(site.beacon.id);
        continue;
      }
      let f = this.fortresses.get(site.id);
      if (!f) {
        f = this.build<FortressEntry>(() => this.buildFortress(site));
        this.fortresses.set(site.id, f);
        this.object.add(f.group);
      }
      this.updateFortress(state, site, f, frameDt);
      if (length(sub(site.beacon.pos, pos)) <= VIEW_RANGE) {
        let b = this.beacons.get(site.beacon.id);
        if (!b) {
          b = this.build<BeaconEntry>(() => this.buildBeacon(site));
          this.beacons.set(site.beacon.id, b);
          this.object.add(b.group);
        }
        if (b.spin) b.spin.rotation.y = this.time * 2.4;
        if (b.lamp) b.lamp.visible = Math.sin(this.time * 6) > -0.2;
      }
    }
  }

  private updateFortress(state: SimState, site: FortressSite, f: FortressEntry, frameDt: number): void {
    const s = fortressStatus(state, site.id);
    const alive = fortressAlive(s);
    if (f.core) f.core.visible = alive;
    s.gens.forEach((hp, i) => {
      const g = f.gens[i];
      if (g) g.visible = hp > 0;
    });
    const shielded = alive && coreShielded(s);
    f.flash = Math.max(0, f.flash - frameDt * 3);
    f.dome.visible = shielded;
    f.domeMat.opacity = 0.07 + 0.05 * Math.sin(this.time * 2.2) + 0.3 * f.flash;
    // mast lamps blink (dark when the fortress is down)
    f.lamps.forEach((lamp, i) => {
      lamp.visible = alive && Math.sin(this.time * 3 + i * 1.3) > -0.3;
    });
    // turret guns aim at the player within their arc; destroyed ones vanish
    const player = state.player.body.pos;
    f.turrets.forEach((t, i) => {
      t.holder.visible = alive && (s.turrets[i] ?? 0) > 0;
      if (!t.head || !t.holder.visible) return;
      const mount = FORTRESS_LAYOUT.turrets[i]!;
      const from = fortressToWorld(site, mount);
      const rest = site.angle + (mount.yawDeg * Math.PI) / 180;
      const want = Math.atan2(player.y - from.y, player.x - from.x);
      const inReach = length(sub(player, from)) <= FORTRESS.turret.range * 1.4;
      const target = inReach ? clamp(normalizeAngle(want - rest), -TURRET_ARC, TURRET_ARC) : 0;
      t.angle += (target - t.angle) * (1 - Math.exp(-frameDt * 6));
      t.head.quaternion.copy(t.base).multiply(tmpQ.setFromAxisAngle(AXIS_Y, t.angle));
    });
  }

  stats(): { fortresses: number; beacons: number } {
    return { fortresses: this.fortresses.size, beacons: this.beacons.size };
  }

  dispose(): void {
    this.disposed = true;
    for (const id of [...this.fortresses.keys()]) this.removeFortress(id);
    for (const id of [...this.beacons.keys()]) this.removeBeacon(id);
    // shared palette textures (createModelLoader) belong to the whole app
    for (const g of this.geometries) g.dispose();
    for (const m of this.materials) m.dispose();
    this.geometries.clear();
    this.materials.clear();
    this.templates.clear();
    this.turretStandIn = null;
  }
}
