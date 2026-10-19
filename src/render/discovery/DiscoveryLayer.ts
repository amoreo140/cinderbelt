// Discovery in the world (M3.5b): anomalies (4 models with animated nodes), giant asteroids (the
// Shell_0..6 plates fly apart when broken, mining shrinks the core), Echo beacons, ships in distress,
// located caches, the scanner pulse (wave and find rings, ScanPulseView) and the analysis beam. Models
// load through createModelLoader (meshopt + shared atlas) only at the first place that needs them.
import {
  AdditiveBlending,
  BufferGeometry,
  CylinderGeometry,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  IcosahedronGeometry,
  Line,
  LineBasicMaterial,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  RingGeometry,
  Vector3,
  type Material,
  type Object3D,
} from 'three';
import { ANOMALIES, GIANT_CORE_AMOUNT, GIANT_RADIUS, type AnomalyType } from '../../data/poi';
import { DISTRESS } from '../../data/events';
import type { ResourceId } from '../../data/resources';
import { distressNear } from '../../sim/discovery/events';
import { giantCore, shellHp } from '../../sim/discovery/giants';
import { echoSites, poisNear, type Poi } from '../../sim/discovery/poi';
import { findTarget } from '../../sim/discovery/scanner';
import type { SimEvent, SimState } from '../../sim/Simulation';
import { fetchAsset } from '../assets/ModelLibrary';
import { createModelLoader, guardPaletteMaterials } from '../assets/gltf';
import { assetUrl } from '../assets/url';
import { simToWorld } from '../coords';
import type { ScanView } from '../../game/discovery/scanFeedback';
import type { GraphicsQuality } from '../quality';
import { ScanPulseView } from './ScanPulseView';
import type { WarmUpZoo } from '../warmup';

type ModelKey = `anomaly_${AnomalyType}` | `giant_${ResourceId}` | 'echo' | 'trader' | 'cache';

const MODEL_PATHS: Record<ModelKey, string> = {
  anomaly_gravity: 'assets/models/anomalies/anomaly_gravity.glb',
  anomaly_ion: 'assets/models/anomalies/anomaly_ion.glb',
  anomaly_radiation: 'assets/models/anomalies/anomaly_radiation.glb',
  anomaly_time: 'assets/models/anomalies/anomaly_time.glb',
  giant_iron: 'assets/models/asteroids/asteroid_giant_iron.glb',
  giant_copper: 'assets/models/asteroids/asteroid_giant_copper.glb',
  giant_ice: 'assets/models/asteroids/asteroid_giant_ice.glb',
  giant_titanium: 'assets/models/asteroids/asteroid_giant_titanium.glb',
  echo: 'assets/models/kovaci/ozvena_beacon.glb',
  trader: 'assets/models/npc/trader.glb',
  cache: 'assets/models/props/cargo_container.glb',
};
/** Its model files – the boot list downloads them ahead of the game (assets/bootAssets.ts). */
export const DISCOVERY_MODEL_PATHS: readonly string[] = Object.values(MODEL_PATHS);

/** Places are drawn within this distance of the ship (u). */
const VIEW_RANGE = 650;
/** Giant model radius (~5.3 u) → radius in the game. */
const GIANT_MODEL_RADIUS = 5.3;
/** The anomaly model is ~10 u – the core in the game ~12 u. */
const ANOMALY_MODEL_SIZE = 9;
const ECHO_SCALE = 1.7;
const GLOW = 0x62d9f4;
const WARN = 0xffb547;
const EMBER = 0xff8a5c;
const SHELL_BREAK_SECONDS = 1.6;

interface Entry {
  group: Group;
  kind: string;
  /** Nodes to rotate: [node, speed rad/s, axis 'y' | 'step'] */
  spins: { node: Object3D; speed: number; step?: boolean }[];
  /** Pulsing markers (material, base). */
  pulse: { material: MeshBasicMaterial; base: number }[];
  /** Giant: shell plates, core, break time. */
  giant?: { id: string; plates: Object3D[]; shell: Object3D | null; core: Object3D | null; brokenAt: number | null; coreId: string };
  /** The model is already the real one (not a placeholder). */
  real: boolean;
  /** Geometries and materials built just for this place (rings, placeholders) – released with it. */
  owned?: (BufferGeometry | Material)[];
}

export class DiscoveryLayer {
  readonly object = new Group();
  private readonly templates = new Map<ModelKey, Object3D>();
  private readonly loads = new Map<ModelKey, Promise<void>>();
  private readonly entries = new Map<string, Entry>();
  /** Scanner pulse: the wave and the finds' rings (R6). */
  private readonly scan = new ScanPulseView();
  private readonly ownedGeometries = new Set<BufferGeometry>();
  private readonly ownedMaterials = new Set<Material>();
  private readonly beam: Line;
  private disposed = false;
  private time = 0;
  private readonly v = new Vector3();
  /** While a place is being built: collects what `own()` creates for it. */
  private collecting: (BufferGeometry | Material)[] | null = null;
  /** Per-frame scratch (no allocation in update). */
  private readonly wanted = new Set<string>();

  constructor() {
    this.object.name = 'discovery';
    const geo = this.own(new BufferGeometry());
    geo.setAttribute('position', new Float32BufferAttribute([0, 0, 0, 0, 0, 0], 3));
    this.beam = new Line(geo, this.own(new LineBasicMaterial({ color: GLOW, transparent: true, opacity: 0.7, blending: AdditiveBlending, depthWrite: false })));
    this.beam.visible = false;
    this.beam.frustumCulled = false;
    this.object.add(this.beam);
    this.object.add(this.scan.object);
  }

  /** The scanner pulse to draw this frame (the game's ScanView, null = none). */
  setScan(view: ScanView | null): void {
    this.scan.setView(view);
  }

  setQuality(level: GraphicsQuality): void {
    this.scan.setQuality(level);
  }

  private own<T extends BufferGeometry | Material>(x: T): T {
    if ('isMaterial' in x) this.ownedMaterials.add(x as Material);
    else this.ownedGeometries.add(x as BufferGeometry);
    this.collecting?.push(x);
    return x;
  }

  /** Builds a place and remembers which geometries/materials belong to it alone. */
  private build(make: () => Entry): Entry {
    const owned: (BufferGeometry | Material)[] = [];
    this.collecting = owned;
    try {
      const e = make();
      e.owned = owned;
      return e;
    } finally {
      this.collecting = null;
    }
  }

  /** Loads a model once (places rebuild with it); resolves when it is in (or failed). */
  private request(key: ModelKey): Promise<void> {
    const known = this.loads.get(key);
    if (known || this.disposed) return known ?? Promise.resolve();
    const load = (async () => {
      try {
        const path = MODEL_PATHS[key];
        const data = await fetchAsset(path);
        if (!data || this.disposed) return;
        const gltf = await createModelLoader().parseAsync(data, assetUrl(path).replace(/[^/]*$/, ''));
        if (this.disposed) return;
        guardPaletteMaterials(gltf.scene);
        gltf.scene.traverse((o) => {
          if (o instanceof Mesh) {
            this.ownedGeometries.add(o.geometry);
            for (const m of Array.isArray(o.material) ? o.material : [o.material]) this.ownedMaterials.add(m);
          }
        });
        this.templates.set(key, gltf.scene);
        // places with this model are built again
        for (const [id, e] of [...this.entries]) {
          if (!e.real && e.kind === key) this.remove(id);
        }
      } catch (e) {
        console.warn(`Discovery model failed to load: ${MODEL_PATHS[key]}`, e);
      }
    })();
    this.loads.set(key, load);
    return load;
  }

  /**
   * Shader warm-up: every place model (loaded now, not at the first place that needs it) and a ring.
   * Resolves when the models are in.
   */
  async warmUp(zoo: WarmUpZoo): Promise<void> {
    zoo.add(this.ring(1, 0.1, GLOW, 0.2).mesh);
    const keys = Object.keys(MODEL_PATHS) as ModelKey[];
    await Promise.all(keys.map((key) => this.request(key)));
    for (const key of keys) {
      const model = this.clone(key);
      if (model) zoo.add(model);
    }
  }

  private ring(radius: number, width: number, color: number, opacity: number): { mesh: Mesh; material: MeshBasicMaterial } {
    const material = this.own(new MeshBasicMaterial({ color, transparent: true, opacity, blending: AdditiveBlending, depthWrite: false, side: DoubleSide, forceSinglePass: true }));
    const mesh = new Mesh(this.own(new RingGeometry(Math.max(0.1, radius - width), radius, 96)), material);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.y = 0.05;
    return { mesh, material };
  }

  /** Template clone with its own materials where the emission or transparency changes. */
  private clone(key: ModelKey): Object3D | null {
    const t = this.templates.get(key);
    return t ? t.clone(true) : null;
  }

  private placeholder(color: number, radius: number): Object3D {
    const m = new Mesh(this.own(new IcosahedronGeometry(radius, 1)), this.own(new MeshStandardMaterial({ color, roughness: 0.8, flatShading: true })));
    return m;
  }

  private buildAnomaly(p: Extract<Poi, { kind: 'anomaly' }>): Entry {
    const key = `anomaly_${p.type}` as ModelKey;
    void this.request(key);
    const group = new Group();
    const model = this.clone(key);
    const def = ANOMALIES[p.type];
    const spins: Entry['spins'] = [];
    if (model) {
      model.scale.setScalar((def.core * 2) / ANOMALY_MODEL_SIZE);
      group.add(model);
      const names: Record<string, [number, boolean?]> = {
        Anomaly_Disk: [1.4],
        Anomaly_Debris: [0.25],
        Anomaly_Ring_0: [p.type === 'time' ? 0.5236 : 0.6, p.type === 'time'],
        Anomaly_Ring_1: [-0.4],
        Anomaly_Ring_2: [0.85],
        Anomaly_Shards: [0.3],
      };
      model.traverse((o) => {
        const n = names[o.name];
        if (n) spins.push({ node: o, speed: n[0], ...(n[1] ? { step: true } : {}) });
      });
    } else {
      group.add(this.placeholder(p.type === 'ion' ? GLOW : p.type === 'radiation' ? 0x7de36b : p.type === 'time' ? 0xf4c64e : 0x332a4a, def.core * 0.5));
    }
    // anomaly field: a faint ring on the plane; brighter core (flying through = bonus)
    const field = this.ring(def.field, 0.18, p.type === 'radiation' ? 0x9be36b : GLOW, 0.07);
    const core = this.ring(def.core, 0.22, GLOW, 0.22);
    group.add(field.mesh, core.mesh);
    return { group, kind: key, spins, pulse: [{ material: core.material, base: 0.3 }], real: model !== null };
  }

  private buildGiant(state: SimState, p: Extract<Poi, { kind: 'giant' }>): Entry {
    const key = `giant_${p.resource}` as ModelKey;
    void this.request(key);
    const group = new Group();
    const model = this.clone(key);
    const plates: Object3D[] = [];
    let shell: Object3D | null = null;
    let core: Object3D | null = null;
    if (model) {
      model.scale.setScalar(GIANT_RADIUS / GIANT_MODEL_RADIUS);
      model.rotation.y = p.variant * Math.PI * 2;
      group.add(model);
      shell = model.getObjectByName('Shell') ?? null;
      core = model.getObjectByName('Core') ?? null;
      for (let i = 0; i < 7; i++) {
        const plate = model.getObjectByName(`Shell_${i}`);
        if (plate) {
          plate.userData.home = plate.position.clone();
          plates.push(plate);
        }
      }
    } else {
      const ph = this.placeholder(0x6f655c, GIANT_RADIUS);
      shell = ph;
      group.add(ph);
    }
    const broken = shellHp(state, p.id) <= 0;
    if (broken && shell) shell.visible = false;
    return {
      group,
      kind: key,
      spins: [],
      pulse: [],
      giant: { id: p.id, plates, shell, core, brokenAt: null, coreId: giantCore(p).id },
      real: model !== null,
    };
  }

  private buildEcho(): Entry {
    void this.request('echo');
    const group = new Group();
    const model = this.clone('echo');
    const spins: Entry['spins'] = [];
    const pulse: Entry['pulse'] = [];
    if (model) {
      model.scale.setScalar(ECHO_SCALE);
      group.add(model);
      const r0 = model.getObjectByName('Ozvena_Ring_0');
      const r1 = model.getObjectByName('Ozvena_Ring_1');
      const crystal = model.getObjectByName('Ozvena_Crystal');
      if (r0) spins.push({ node: r0, speed: 0.5 });
      if (r1) spins.push({ node: r1, speed: -0.35 });
      if (crystal) spins.push({ node: crystal, speed: 0.9 });
    } else {
      const m = new Mesh(this.own(new CylinderGeometry(0.4, 1.6, 9, 3)), this.own(new MeshStandardMaterial({ color: 0x1a1720, emissive: EMBER, emissiveIntensity: 0.4 })));
      m.position.y = 4.5;
      group.add(m);
    }
    const halo = this.ring(11, 0.4, EMBER, 0.28);
    group.add(halo.mesh);
    pulse.push({ material: halo.material, base: 0.28 });
    return { group, kind: 'echo', spins, pulse, real: model !== null };
  }

  private buildDistress(angle: number): Entry {
    void this.request('trader');
    const group = new Group();
    const model = this.clone('trader') ?? new Mesh(this.own(new CylinderGeometry(1.6, 1.6, 12, 10)), this.own(new MeshStandardMaterial({ color: 0xc8ced8 })));
    model.rotation.y = angle;
    group.add(model);
    const r = this.ring(DISTRESS.shipRadius + 8, 0.45, WARN, 0.4);
    group.add(r.mesh);
    return { group, kind: 'trader', spins: [], pulse: [{ material: r.material, base: 0.4 }], real: this.templates.has('trader') };
  }

  private buildCache(): Entry {
    void this.request('cache');
    const group = new Group();
    const model = this.clone('cache') ?? this.placeholder(0x8d99ae, 1.2);
    model.scale.multiplyScalar(1.4);
    group.add(model);
    const r = this.ring(5, 0.3, GLOW, 0.35);
    group.add(r.mesh);
    return { group, kind: 'cache', spins: [{ node: model, speed: 0.3 }], pulse: [{ material: r.material, base: 0.35 }], real: this.templates.has('cache') };
  }

  private remove(id: string): void {
    const e = this.entries.get(id);
    if (!e) return;
    this.object.remove(e.group);
    this.entries.delete(id);
    // places come and go as the ship flies – their own rings and placeholders must not pile up on the GPU
    for (const x of e.owned ?? []) {
      x.dispose();
      if ('isMaterial' in x) this.ownedMaterials.delete(x as Material);
      else this.ownedGeometries.delete(x as BufferGeometry);
    }
  }

  /** Events of a step: a broken giant shell (the pulse comes from the game's ScanView). */
  onEvents(events: readonly SimEvent[]): void {
    for (const e of events) {
      if (e.type === 'giantBroken') {
        const entry = this.entries.get(e.id);
        if (entry?.giant && entry.giant.brokenAt === null) entry.giant.brokenAt = this.time;
      }
    }
  }

  /** `view` = camera distance (line widths) and reduced motion (no breathing rings). */
  update(state: SimState, frameDt: number, view: { cameraDistance: number; reducedMotion: boolean } = { cameraDistance: 50, reducedMotion: false }): void {
    this.time += frameDt;
    this.scan.update(frameDt, view.cameraDistance, view.reducedMotion);
    const pos = state.player.body.pos;
    const d = state.discovery;
    const wanted = this.wanted;
    wanted.clear();
    const place = (id: string, p: { x: number; y: number }, build: () => Entry) => {
      wanted.add(id);
      let e = this.entries.get(id);
      if (!e) {
        e = this.build(build);
        simToWorld(p, 0, e.group.position);
        this.entries.set(id, e);
        this.object.add(e.group);
      }
    };
    for (const p of poisNear(state.seed, pos, VIEW_RANGE)) {
      if (p.kind === 'anomaly') place(p.id, p.pos, () => this.buildAnomaly(p));
      else if (p.kind === 'giant') {
        const core = giantCore(p);
        if (shellHp(state, p.id) <= 0 && state.world.remaining(core) <= 0 && !this.entries.has(p.id)) continue;
        place(p.id, p.pos, () => this.buildGiant(state, p));
      } else if (p.kind === 'cache' && d.known.has(p.id) && !d.opened.has(p.id)) place(p.id, p.pos, () => this.buildCache());
    }
    for (const s of echoSites(state.seed)) if (Math.hypot(s.pos.x - pos.x, s.pos.y - pos.y) <= VIEW_RANGE) place(s.id, s.pos, () => this.buildEcho());
    for (const ds of distressNear(state.seed, pos, VIEW_RANGE, state.tick)) {
      if (!d.opened.has(ds.id) || ds.kind !== 'trap') place(ds.id, ds.pos, () => this.buildDistress(ds.angle));
    }
    // deleting the current key while iterating a Map is safe – no copy of the keys needed
    for (const id of this.entries.keys()) if (!wanted.has(id)) this.remove(id);

    // node animations and pulsing markers
    const k = 0.7 + 0.3 * Math.sin(this.time * 3);
    for (const e of this.entries.values()) {
      for (const s of e.spins) {
        s.node.rotation.y = s.step ? Math.floor(this.time) * s.speed : this.time * s.speed;
      }
      for (const p of e.pulse) p.material.opacity = p.base * k;
      if (e.giant) this.updateGiant(state, e.giant);
    }

    // analysis beam from the ship to the target
    const target = d.scanner.target ? findTarget(state, d.scanner.target) : null;
    if (target && state.player.dock.mode === 'flying') {
      const attr = this.beam.geometry.getAttribute('position') as Float32BufferAttribute;
      simToWorld(pos, 0.6, this.v);
      attr.setXYZ(0, this.v.x, this.v.y, this.v.z);
      simToWorld(target.pos, 0.6, this.v);
      attr.setXYZ(1, this.v.x, this.v.y, this.v.z);
      attr.needsUpdate = true;
      (this.beam.material as LineBasicMaterial).opacity = 0.35 + 0.35 * Math.abs(Math.sin(this.time * 9));
      this.beam.visible = true;
    } else {
      this.beam.visible = false;
    }
  }

  private updateGiant(state: SimState, g: NonNullable<Entry['giant']>): void {
    const broken = state.discovery.giants.get(g.id) === 0;
    if (broken && g.shell?.visible) {
      if (g.brokenAt === null) g.brokenAt = this.time - SHELL_BREAK_SECONDS;
      const t = (this.time - g.brokenAt) / SHELL_BREAK_SECONDS;
      if (t >= 1 || g.plates.length === 0) g.shell.visible = false;
      else {
        // the plates fly apart away from the centre and shrink
        for (const plate of g.plates) {
          const home = plate.userData.home as Vector3;
          plate.position.copy(home).multiplyScalar(1 + t * 2.2);
          plate.scale.setScalar(Math.max(0.05, 1 - t * 0.8));
          plate.rotation.x = t * 1.3;
        }
      }
    }
    if (g.core) {
      const left = state.world.remainingById.get(g.coreId) ?? GIANT_CORE_AMOUNT;
      const s = left <= 0 ? 0.001 : Math.max(0.35, Math.sqrt(left / GIANT_CORE_AMOUNT));
      g.core.scale.setScalar(s);
      g.core.visible = left > 0;
    }
  }

  stats(): { places: number; pulses: number; finds: number } {
    const scan = this.scan.stats();
    return { places: this.entries.size, pulses: scan.wave ? 1 : 0, finds: scan.finds };
  }

  dispose(): void {
    this.disposed = true;
    this.scan.dispose();
    for (const id of [...this.entries.keys()]) this.remove(id);
    // shared atlas textures (createModelLoader) are not freed – they belong to the whole application
    for (const g of this.ownedGeometries) g.dispose();
    for (const m of this.ownedMaterials) m.dispose();
    this.ownedGeometries.clear();
    this.ownedMaterials.clear();
    this.templates.clear();
  }
}
