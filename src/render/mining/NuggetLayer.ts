// Rich nuggets in the scene (Mining 2.0): a small chunk of the rock's ore (asteroid_frag_<res>_*
// scaled down, glowing in the ore colour) tumbling as it drifts, with a soft halo; it blinks before
// it is gone. Bursts of chips when one breaks off, a flash when the ship collects it.
import { Box3, Color, Group, Mesh, MeshStandardMaterial, Sphere, Vector3, type Material, type Object3D } from 'three';
import { NUGGET } from '../../data/ore';
import { RESOURCE_IDS, RESOURCES, type ResourceId } from '../../data/resources';
import { lerp } from '../../sim/math/vec2';
import type { SimEvent, SimState } from '../../sim/Simulation';
import { simToWorld } from '../coords';
import type { FxModels } from '../fx/fxModels';
import { Particles, SpriteBatch } from '../fx/Particles';
import { vfxTexture } from '../fx/textures';
import { cloneWithRim } from '../rimLight';
import type { WarmUpZoo } from '../warmup';

const HEIGHT = 0.3;
const TICKS = 60;
const rand = (min: number, max: number): number => min + Math.random() * (max - min);

interface Entry {
  obj: Object3D;
  axis: Vector3;
  resource: ResourceId;
  /** The model it was built from (rebuilt once the real fragment models are loaded). */
  template: Object3D;
}

export class NuggetLayer {
  readonly object = new Group();
  private readonly entries = new Map<number, Entry>();
  private readonly materials = new Map<string, MeshStandardMaterial>();
  private readonly glows = new SpriteBatch({ texture: vfxTexture('glow_soft'), additive: true, max: 32, renderOrder: 12 });
  private readonly sparks = new Particles({ texture: vfxTexture('spark'), additive: true, max: 160, renderOrder: 13 });
  private readonly dust = new Particles({ texture: vfxTexture('impact_dust'), additive: false, cols: 4, rows: 4, max: 24, renderOrder: 11 });
  private readonly flashes = new Particles({ texture: vfxTexture('flare_star'), additive: true, max: 16, renderOrder: 14 });
  private readonly sizes = new Map<Object3D, number>();
  private particles = 1;
  private time = 0;
  private readonly tmp = new Vector3();
  private readonly seen = new Set<number>();

  constructor(private readonly models: FxModels) {
    this.object.name = 'nuggets';
    this.object.add(this.glows.mesh, this.sparks.mesh, this.dust.mesh, this.flashes.mesh);
  }

  setQuality(particles: number): void {
    this.particles = particles;
  }

  /** A glowing copy of the fragment material (one per material and resource, shared by nuggets). */
  private material(m: Material, resource: ResourceId): Material {
    if (!(m instanceof MeshStandardMaterial)) return m;
    const key = `${m.uuid}:${resource}`;
    let out = this.materials.get(key);
    if (!out) {
      out = cloneWithRim(m);
      out.emissiveMap = null;
      out.emissive = new Color(RESOURCES[resource].color);
      out.emissiveIntensity = 0.9;
      this.materials.set(key, out);
    }
    return out;
  }

  /** Shader warm-up: a nugget (its glowing material copy) – the first rich vein must not compile it. */
  warmUp(zoo: WarmUpZoo): void {
    const resource = RESOURCE_IDS[0]!;
    const obj = this.models.fragmentTemplate(resource, 0).clone();
    obj.traverse((o) => {
      if (o instanceof Mesh) o.material = Array.isArray(o.material) ? o.material.map((m) => this.material(m, resource)) : this.material(o.material, resource);
    });
    zoo.add(obj);
  }

  /** Scale that makes the template about the nugget's size. */
  private scaleOf(template: Object3D): number {
    let s = this.sizes.get(template);
    if (s === undefined) {
      const sphere = new Box3().setFromObject(template).getBoundingSphere(new Sphere());
      s = sphere.radius > 1e-3 ? (NUGGET.radius * 1.7) / sphere.radius : 1;
      this.sizes.set(template, s);
    }
    return s;
  }

  private build(id: number, resource: ResourceId): Entry {
    const template = this.models.fragmentTemplate(resource, (id * 0.618) % 1);
    const obj = template.clone();
    obj.traverse((o) => {
      if (o instanceof Mesh) o.material = Array.isArray(o.material) ? o.material.map((m) => this.material(m, resource)) : this.material(o.material, resource);
    });
    obj.scale.setScalar(this.scaleOf(template));
    obj.rotation.set(id * 1.7, id * 2.3, id * 0.9);
    this.object.add(obj);
    const axis = new Vector3(Math.sin(id * 3.1), 0.6, Math.cos(id * 1.3)).normalize();
    return { obj, axis, resource, template };
  }

  onEvents(events: readonly SimEvent[]): void {
    const q = this.particles;
    for (const e of events) {
      if (e.type === 'nuggetSpawned') {
        const at = simToWorld(e.pos, HEIGHT, new Vector3());
        const ore = new Color(RESOURCES[e.resource].color).multiplyScalar(2.6);
        const out = new Vector3(e.vel.x, 0, -e.vel.y).normalize();
        for (let i = 0; i < Math.round(14 * q) + 2; i++) {
          const d = new Vector3(rand(-1, 1), rand(-0.3, 1), rand(-1, 1)).normalize().add(out);
          this.sparks.spawn({ pos: at, vel: d.multiplyScalar(rand(3, 9)), drag: 3, life: rand(0.2, 0.45), size: rand(0.3, 0.5), aspect: 0.15, stretch: true, color: ore });
        }
        const rock = new Color(RESOURCES[e.resource].rockColor).lerp(new Color(1, 1, 1), 0.35);
        this.dust.spawn({ pos: at, vel: out.clone().multiplyScalar(1.2), drag: 1.5, life: 0.7, size: 1.0, sizeEnd: 2.2, color: rock, alpha: 0.75, frameStart: 0, frameEnd: 15, rotation: Math.random() * 6.3 });
        this.flashes.spawn({ pos: at, life: 0.22, size: 1.8, sizeEnd: 0.6, color: ore, alpha: 0.8 });
      } else if (e.type === 'nuggetCollected') {
        const at = simToWorld(e.pos, HEIGHT, new Vector3());
        const ore = new Color(RESOURCES[e.resource].color).lerp(new Color(1, 0.9, 0.6), 0.4).multiplyScalar(3);
        this.flashes.spawn({ pos: at, life: 0.3, size: 2.4, sizeEnd: 0.4, color: ore, alpha: 1 });
        for (let i = 0; i < Math.round(10 * q) + 2; i++) {
          this.sparks.spawn({ pos: at, vel: new Vector3(rand(-1, 1), rand(0, 1), rand(-1, 1)).normalize().multiplyScalar(rand(2, 5)), drag: 4, life: rand(0.15, 0.35), size: 0.35, aspect: 0.2, stretch: true, color: ore });
        }
      } else if (e.type === 'nuggetLost' && e.reason === 'expired') {
        const at = simToWorld(e.pos, HEIGHT, new Vector3());
        this.dust.spawn({ pos: at, life: 0.6, size: 0.6, sizeEnd: 1.4, color: new Color(0.7, 0.68, 0.66), alpha: 0.6, frameStart: 0, frameEnd: 15, rotation: Math.random() * 6.3 });
      }
    }
  }

  update(state: SimState, alpha: number, dt: number): void {
    this.time += dt;
    this.seen.clear();
    this.glows.begin();
    // a slow pulse of the glow (shared materials)
    for (const m of this.materials.values()) m.emissiveIntensity = 0.75 + 0.35 * Math.sin(this.time * 5);
    for (const n of state.mining.nuggets) {
      this.seen.add(n.id);
      let e = this.entries.get(n.id);
      // rebuild once the real fragment models have loaded (the first nuggets may use the stand-in)
      if (e && e.template !== this.models.fragmentTemplate(n.resource, (n.id * 0.618) % 1)) {
        this.object.remove(e.obj);
        e = undefined;
      }
      if (!e) {
        e = this.build(n.id, n.resource);
        this.entries.set(n.id, e);
      }
      const p = lerp(n.prevBody.pos, n.body.pos, alpha);
      simToWorld(p, HEIGHT + 0.05 * Math.sin(this.time * 2 + n.id), e.obj.position);
      e.obj.rotateOnAxis(e.axis, n.body.angVel * dt * 0.8 + dt * 0.6);
      // blinks before it is gone, shrinks in the last half second
      const left = n.ttl / TICKS;
      const fading = left < NUGGET.fadeSeconds;
      const blink = fading ? (Math.sin(this.time * (8 + (NUGGET.fadeSeconds - left) * 2)) > -0.2 ? 1 : 0.25) : 1;
      e.obj.scale.setScalar(this.scaleOf(e.template) * Math.min(1, left / 0.5));
      const ore = new Color(RESOURCES[n.resource].color);
      this.glows.add(e.obj.position, null, 1.9, 1.9, 0, ore.clone().multiplyScalar(0.9), 0.75 * blink);
      this.glows.add(e.obj.position, null, 0.7, 0.7, 0, ore.lerp(new Color(1, 1, 1), 0.5).multiplyScalar(1.6), 0.8 * blink);
      // a sparkle now and then
      if (Math.random() < dt * 3 * this.particles) {
        this.tmp.copy(e.obj.position).add(new Vector3(rand(-0.3, 0.3), rand(0, 0.3), rand(-0.3, 0.3)));
        this.sparks.spawn({ pos: this.tmp, vel: new Vector3(0, rand(0.3, 0.8), 0), life: 0.35, size: 0.28, aspect: 0.3, color: new Color(RESOURCES[n.resource].color).multiplyScalar(2.4) });
      }
    }
    for (const [id, e] of this.entries) {
      if (this.seen.has(id)) continue;
      this.object.remove(e.obj);
      this.entries.delete(id);
    }
    this.glows.end();
    for (const s of [this.sparks, this.dust, this.flashes]) s.update(dt);
  }

  /** Nuggets on screen (tests). */
  get count(): number {
    return this.entries.size;
  }

  dispose(): void {
    for (const e of this.entries.values()) this.object.remove(e.obj);
    this.entries.clear();
    for (const m of this.materials.values()) m.dispose();
    this.glows.dispose();
    for (const s of [this.sparks, this.dust, this.flashes]) s.dispose();
  }
}
