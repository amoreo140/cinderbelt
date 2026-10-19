// The hangar bay around the shipyard platform (art batch D, art/README.md §2.7.25): deck, walls,
// gantry towers, part racks and an open bay door, in the platform's frame (add to the hangar yard).
// The model obeys a height rule (nothing rises over the floor's view cone from any shipyard camera
// pose), so it is drawn solid, without clipping. Two assembly arms slide along their rails and weld
// in short bursts with sparks at `Arm_<i>_Tip` (hangarBayAnim.ts); reduced motion parks them, the
// graphics quality scales the spark count. Loaded on its own (only the shipyard shows it), so the
// game's loading screen does not wait for its 0.8 MB.
import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Group,
  Mesh,
  Points,
  PointsMaterial,
  Quaternion,
  Sprite,
  SpriteMaterial,
  Vector3,
  type Material,
  type Object3D,
} from 'three';
import { HANGAR_BAY_PATH } from './assets/catalog';
import { createModelLoader } from './assets/gltf';
import { loadModelScene } from './assets/ModelLibrary';
import { vfxTexture } from './fx/textures';
import { bayArmPose } from './hangarBayAnim';

const AXIS_Y = new Vector3(0, 1, 0);
/** Spark particles per arm at full quality, spawned per second while welding. */
const SPARKS_PER_ARM = 40;
const SPARK_RATE = 55;
const GRAVITY = -7;
const SPARK_COLOR = [1, 0.82, 0.45] as const;

interface Arm {
  carriage: Object3D;
  head: Object3D;
  headBase: Quaternion;
  tip: Object3D;
  glow: Sprite;
  /** Fractional sparks owed to the next frame. */
  owed: number;
}

export class HangarBay {
  readonly object = new Group();
  /** The model is in the scene (tests, screenshots). */
  loaded = false;
  /** Reduced motion: the arms stay parked and nothing sparks. */
  reducedMotion = false;
  private readonly arms: Arm[] = [];
  private time = 0;
  private particles = 1;
  private disposed = false;
  private model: Object3D | null = null;
  private loading: Promise<void> | null = null;
  private readonly sparks: Points;
  private readonly sparkGeometry = new BufferGeometry();
  private readonly sparkMaterial: PointsMaterial;
  private readonly glowMaterial: SpriteMaterial;
  private readonly pos: Float32Array;
  private readonly col: Float32Array;
  private readonly vel: Float32Array;
  private readonly life: Float32Array;
  private readonly maxLife: Float32Array;
  private next = 0;
  private readonly tmp = new Vector3();
  private readonly tmpQuat = new Quaternion();

  constructor() {
    this.object.name = 'hangar-bay';
    const count = SPARKS_PER_ARM * 2;
    this.pos = new Float32Array(count * 3);
    this.col = new Float32Array(count * 3);
    this.vel = new Float32Array(count * 3);
    this.life = new Float32Array(count);
    this.maxLife = new Float32Array(count).fill(1);
    this.sparkGeometry.setAttribute('position', new BufferAttribute(this.pos, 3));
    this.sparkGeometry.setAttribute('color', new BufferAttribute(this.col, 3));
    this.sparkMaterial = new PointsMaterial({
      size: 0.2,
      map: vfxTexture('spark'),
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
    });
    this.sparks = new Points(this.sparkGeometry, this.sparkMaterial);
    this.sparks.frustumCulled = false;
    this.sparks.visible = false;
    this.glowMaterial = new SpriteMaterial({ map: vfxTexture('glow_soft'), color: 0xffd8a0, transparent: true, depthWrite: false, blending: AdditiveBlending });
  }

  /** Starts loading the model (once); it appears in `object` when loaded. */
  load(): void {
    if (this.model || this.disposed || this.loading) return;
    this.loading = loadModelScene(createModelLoader(), HANGAR_BAY_PATH).then((scene) => {
      if (!scene || this.disposed) return;
      this.attach(scene);
    });
  }

  /** Resolves once the model has loaded (or failed) – at once when it is not loading (the shader warm-up). */
  ready(): Promise<void> {
    return this.loading ?? Promise.resolve();
  }

  private attach(scene: Object3D): void {
    this.model = scene;
    this.object.add(scene);
    for (let i = 0; ; i++) {
      const carriage = scene.getObjectByName(`Arm_${i}`);
      const head = scene.getObjectByName(`Arm_${i}_Head`);
      const tip = scene.getObjectByName(`Arm_${i}_Tip`);
      if (!carriage || !head || !tip) break;
      const glow = new Sprite(this.glowMaterial);
      glow.scale.setScalar(1.1);
      glow.visible = false;
      this.object.add(glow);
      this.arms.push({ carriage, head, headBase: head.quaternion.clone(), tip, glow, owed: 0 });
    }
    this.object.add(this.sparks);
    this.loaded = true;
  }

  /** Graphics quality: share of the sparks (QualityPreset.particles). */
  setParticles(k: number): void {
    this.particles = Math.min(1, Math.max(0, k));
  }

  update(dt: number): void {
    if (!this.loaded) return;
    const step = Math.min(dt, 0.1);
    if (!this.reducedMotion) this.time += step;
    this.object.updateMatrixWorld();
    this.arms.forEach((arm, i) => {
      const pose = bayArmPose(this.time, i);
      arm.carriage.position.x = pose.x;
      arm.head.quaternion.copy(arm.headBase).multiply(this.tmpQuat.setFromAxisAngle(AXIS_Y, pose.headYaw));
      const welding = pose.welding && !this.reducedMotion;
      arm.glow.visible = welding;
      if (!welding) {
        arm.owed = 0;
        return;
      }
      arm.carriage.updateMatrixWorld(true);
      const tip = this.object.worldToLocal(arm.tip.getWorldPosition(this.tmp));
      arm.glow.position.copy(tip);
      const flicker = 0.75 + 0.25 * Math.random();
      arm.glow.scale.setScalar(0.8 + 0.5 * flicker);
      arm.glow.material.opacity = 0.85 * flicker;
      arm.owed += SPARK_RATE * this.particles * step;
      while (arm.owed >= 1) {
        arm.owed -= 1;
        this.spawn(tip);
      }
    });
    this.stepSparks(step);
  }

  private spawn(at: Vector3): void {
    const n = this.life.length;
    const cap = Math.max(1, Math.round(n * this.particles));
    const i = this.next % cap;
    this.next = (i + 1) % cap;
    this.pos.set([at.x, at.y, at.z], i * 3);
    const a = Math.random() * Math.PI * 2;
    const s = 0.6 + Math.random() * 1.8;
    this.vel.set([Math.cos(a) * s, 0.4 + Math.random() * 2, Math.sin(a) * s], i * 3);
    this.maxLife[i] = 0.3 + Math.random() * 0.45;
    this.life[i] = this.maxLife[i]!;
  }

  private stepSparks(dt: number): void {
    let alive = 0;
    for (let i = 0; i < this.life.length; i++) {
      const left = this.life[i]!;
      if (left <= 0) {
        this.col.fill(0, i * 3, i * 3 + 3);
        continue;
      }
      alive++;
      this.life[i] = left - dt;
      this.vel[i * 3 + 1]! += GRAVITY * dt;
      for (let k = 0; k < 3; k++) this.pos[i * 3 + k]! += this.vel[i * 3 + k]! * dt;
      // hot white-yellow fading to dark orange (additive: dark = gone)
      const f = Math.max(0, this.life[i]! / this.maxLife[i]!);
      this.col[i * 3] = SPARK_COLOR[0] * f;
      this.col[i * 3 + 1] = SPARK_COLOR[1] * f * f;
      this.col[i * 3 + 2] = SPARK_COLOR[2] * f * f * f;
    }
    this.sparks.visible = alive > 0;
    (this.sparkGeometry.getAttribute('position') as BufferAttribute).needsUpdate = true;
    (this.sparkGeometry.getAttribute('color') as BufferAttribute).needsUpdate = true;
  }

  /** What the bay shows (tests). */
  stats(): { loaded: boolean; arms: number; welding: number; sparks: number } {
    return {
      loaded: this.loaded,
      arms: this.arms.length,
      welding: this.arms.filter((a) => a.glow.visible).length,
      sparks: Array.from(this.life).filter((l) => l > 0).length,
    };
  }

  dispose(): void {
    this.disposed = true;
    this.model?.traverse((o) => {
      if (!(o instanceof Mesh)) return;
      o.geometry.dispose();
      for (const m of (Array.isArray(o.material) ? o.material : [o.material]) as Material[]) m.dispose();
    });
    this.sparkGeometry.dispose();
    this.sparkMaterial.dispose();
    this.glowMaterial.dispose();
    this.object.removeFromParent();
  }
}
