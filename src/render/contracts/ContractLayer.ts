// Contract objects in the world (M3.5a): the Institute's survey buoys (placed) and survey point markers,
// a stranded trader (Rescue) and the circles of a hunt area. The models of the buoys and the trader are
// loaded once when the layer is created (public/assets/models/props, npc); placeholder shapes without them.
// Models load through createModelLoader (meshopt + shared palette atlas, M3.6).
import {
  AdditiveBlending,
  CylinderGeometry,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  RingGeometry,
  Texture,
  type BufferGeometry,
  type Material,
  type Object3D,
} from 'three';
import type { Contract } from '../../sim/career/types';
import type { SimState } from '../../sim/Simulation';
import { fetchAsset } from '../assets/ModelLibrary';
import { createModelLoader, guardPaletteMaterials } from '../assets/gltf';
import { assetUrl } from '../assets/url';
import { simToWorld } from '../coords';

const MODELS = {
  survey: 'assets/models/props/buoy_survey.glb',
  marker: 'assets/models/props/buoy_marker.glb',
  trader: 'assets/models/npc/trader.glb',
} as const;
type ModelKey = keyof typeof MODELS;

/** Buoy scale-up (~1.2 u) – so it is visible in flight. */
const BUOY_SCALE = 2.2;
const MARKER_RADIUS = 9;
const AREA_RADIUS = 40;
const GLOW = 0x62d9f4;
const WARN = 0xffb547;

interface Entry {
  group: Group;
  /** Rotating buoy sensor. */
  spin: Object3D | null;
  /** Pulsing markers (material and base opacity). */
  pulse: { material: MeshBasicMaterial; base: number }[];
}

interface Owned {
  geometries: BufferGeometry[];
  materials: Material[];
}

export class ContractLayer {
  readonly object = new Group();
  private readonly templates = new Map<ModelKey, Object3D>();
  private readonly entries = new Map<string, Entry>();
  /** Sources of the model templates (freed with the layer). */
  private readonly templateOwned: Owned = { geometries: [], materials: [] };
  /** Sources of the current markers (freed on rebuild). */
  private built: Owned = { geometries: [], materials: [] };
  private disposed = false;
  private signature = '';

  /** Models are loaded only at the first contract that needs them. */
  private loading = false;

  constructor() {
    this.object.name = 'contracts';
  }

  private async load(): Promise<void> {
    // meshopt + the shared palette atlas (one texture for all models)
    const loader = createModelLoader();
    await Promise.all(
      (Object.keys(MODELS) as ModelKey[]).map(async (key) => {
        try {
          const data = await fetchAsset(MODELS[key]);
          if (!data || this.disposed) return;
          const gltf = await loader.parseAsync(data, assetUrl(MODELS[key]).replace(/[^/]*$/, ''));
          if (this.disposed) return;
          guardPaletteMaterials(gltf.scene);
          this.templates.set(key, gltf.scene);
          gltf.scene.traverse((o) => {
            if (o instanceof Mesh) {
              this.templateOwned.geometries.push(o.geometry);
              for (const m of Array.isArray(o.material) ? o.material : [o.material]) this.templateOwned.materials.push(m);
            }
          });
          // objects are rebuilt with the models
          this.signature = '';
        } catch (e) {
          console.warn(`Contract model failed to load: ${MODELS[key]}`, e);
        }
      }),
    );
  }

  private own<T extends BufferGeometry | Material>(x: T): T {
    if ('isMaterial' in x) this.built.materials.push(x as Material);
    else this.built.geometries.push(x as BufferGeometry);
    return x;
  }

  private model(key: ModelKey, fallback: () => Object3D, scale = 1): Object3D {
    const t = this.templates.get(key);
    const o = t ? t.clone() : fallback();
    o.scale.setScalar(scale);
    return o;
  }

  private ring(radius: number, color: number, opacity: number): { mesh: Mesh; material: MeshBasicMaterial } {
    const material = this.own(new MeshBasicMaterial({ color, transparent: true, opacity, blending: AdditiveBlending, depthWrite: false, side: DoubleSide, forceSinglePass: true }));
    const mesh = new Mesh(this.own(new RingGeometry(radius - 0.35, radius, 64)), material);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.y = 0.05;
    return { mesh, material };
  }

  private placeholderBuoy(): Object3D {
    const m = new Mesh(this.own(new CylinderGeometry(0.25, 0.4, 1.2, 8)), this.own(new MeshStandardMaterial({ color: 0xd9dee6, emissive: GLOW, emissiveIntensity: 0.3 })));
    m.position.y = 0.6;
    return m;
  }

  private placeholderTrader(): Object3D {
    const m = new Mesh(this.own(new CylinderGeometry(1.6, 1.6, 12, 10)), this.own(new MeshStandardMaterial({ color: 0xc8ced8 })));
    m.rotation.z = Math.PI / 2;
    return m;
  }

  private build(c: Contract): Entry[] {
    const out: Entry[] = [];
    const t = c.target;
    if (t.kind === 'survey') {
      t.points.forEach((p, i) => {
        const group = new Group();
        simToWorld(p, 0, group.position);
        const pulse: Entry['pulse'] = [];
        let spin: Object3D | null = null;
        if (i < c.progress) {
          const buoy = this.model('survey', () => this.placeholderBuoy(), BUOY_SCALE);
          spin = buoy.getObjectByName('Buoy_Sensor') ?? null;
          group.add(buoy);
        } else {
          // survey point marker – the next point glows brighter
          const next = i === c.progress;
          const r = this.ring(MARKER_RADIUS, GLOW, next ? 0.4 : 0.15);
          group.add(r.mesh);
          pulse.push({ material: r.material, base: next ? 0.4 : 0.15 });
          if (next) group.add(this.model('marker', () => this.placeholderBuoy(), 1.6));
        }
        out.push({ group, spin, pulse });
      });
    } else if (t.kind === 'rescue') {
      const group = new Group();
      simToWorld(t.pos, 0, group.position);
      const ship = this.model('trader', () => this.placeholderTrader());
      ship.rotation.y = t.angle;
      group.add(ship);
      const pulse: Entry['pulse'] = [];
      if (!c.ready) {
        const r = this.ring(MARKER_RADIUS + 6, WARN, 0.35);
        group.add(r.mesh);
        pulse.push({ material: r.material, base: 0.35 });
      }
      out.push({ group, spin: null, pulse });
    } else if ((t.kind === 'hunt' || t.kind === 'captain' || t.kind === 'fortress') && !c.ready) {
      const group = new Group();
      simToWorld(t.pos, 0, group.position);
      const r = this.ring(AREA_RADIUS, WARN, 0.16);
      group.add(r.mesh);
      out.push({ group, spin: null, pulse: [{ material: r.material, base: 0.16 }] });
    }
    return out;
  }

  /** Rebuilds the objects when the contracts change (accept, buoy, hand-in). */
  update(state: SimState, time: number): void {
    const contracts = state.career.contracts;
    if (!this.loading && contracts.some((c) => c.target.kind === 'survey' || c.target.kind === 'rescue')) {
      this.loading = true;
      void this.load();
    }
    const signature = `${this.templates.size}|${contracts.map((c) => `${c.serial}:${c.progress}:${c.ready ? 1 : 0}`).join(',')}`;
    if (signature !== this.signature) {
      this.signature = signature;
      this.clear();
      for (const c of contracts) {
        this.build(c).forEach((e, i) => {
          this.entries.set(`${c.serial}:${i}`, e);
          this.object.add(e.group);
        });
      }
    }
    const k = 0.75 + 0.25 * Math.sin(time * 3);
    for (const e of this.entries.values()) {
      if (e.spin) e.spin.rotation.y = time * 1.4;
      for (const p of e.pulse) p.material.opacity = p.base * k;
    }
  }

  private clear(): void {
    for (const e of this.entries.values()) this.object.remove(e.group);
    this.entries.clear();
    release(this.built);
    this.built = { geometries: [], materials: [] };
  }

  dispose(): void {
    this.disposed = true;
    this.clear();
    // template textures are the shared palette (createModelLoader) – they belong to the whole app
    release(this.templateOwned, false);
    this.templates.clear();
  }
}

/** Frees geometries, materials and their textures (model clones share them with the template). */
function release(owned: Owned, textures = true): void {
  for (const g of new Set(owned.geometries)) g.dispose();
  for (const m of new Set(owned.materials)) {
    if (textures) for (const v of Object.values(m)) if (v instanceof Texture) v.dispose();
    m.dispose();
  }
  owned.geometries.length = 0;
  owned.materials.length = 0;
}
