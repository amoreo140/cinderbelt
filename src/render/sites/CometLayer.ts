// Comets (M4b plan T12): the nucleus (`comets/comet_nucleus.glb`, slow tumble, shrinking as its core
// is mined), the ion tail (`comet_tail.glb` ribbons with AF_CometTail's texture – additive, unlit, no
// depth write) pointing away from home and stretched by speed, a fainter dust tail bent towards the
// trailing side, the coma, vent glows and gas jets, sublimation motes blown down the tail, 24 tail
// shards instanced (ice fragments, mined ones hidden, a burst when one shatters; placement is the
// sim's `cometShards`), a point light on High, mining beams stuck to the moving nucleus/shards. The
// pose is interpolated by alpha between sim steps (cometLook.renderPose) and fades in/out at the pass
// ends. Only comets within 1 500 u are built.
//
// Draw calls per comet: nucleus 1 (+1 in the shadow pass where shadows are on), ion tail 1, dust tail
// 1, shards 1; the coma, glows, jets and motes of every comet share one sprite batch – 6 at High. Every material is sampled in
// `warmUp` (the opaque and the fading nucleus, the tails, the instanced shards); the sprite batch is
// the shared effect shader.
import {
  AdditiveBlending,
  Box3,
  Color,
  DoubleSide,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  PointLight,
  Quaternion,
  Raycaster,
  Vector3,
  type BufferGeometry,
  type Material,
  type Texture,
} from 'three';
import { COMET } from '../../data/sites';
import type { MiningBeam } from '../../sim/mining/mining';
import { fnv1a32 } from '../../sim/math/fnv1a';
import { cometById, cometLeft, cometShards, cometsNear } from '../../sim/sites/comets';
import type { CometPose } from '../../sim/sites/types';
import type { SimEvent, SimState } from '../../sim/Simulation';
import { createModelLoader, guardPaletteMaterials } from '../assets/gltf';
import { fetchAsset } from '../assets/ModelLibrary';
import { assetUrl } from '../assets/url';
import { simToWorld } from '../coords';
import type { FxModels } from '../fx/fxModels';
import { SpriteBatch } from '../fx/Particles';
import { vfxTexture } from '../fx/textures';
import type { QualityPreset } from '../quality';
import type { WarmUpZoo } from '../warmup';
import {
  awayFromHome,
  COMET_LOOK,
  cometFade,
  cometLightsFor,
  dustTailDir,
  moverTarget,
  newlyMined,
  nucleusShrink,
  renderPose,
  sublimationRate,
  tailLength,
  tailYaw,
} from './cometLook';

const NUCLEUS_PATH = 'assets/models/comets/comet_nucleus.glb';
const TAIL_PATH = 'assets/models/comets/comet_tail.glb';
/** Its model files – the boot list downloads them ahead of the game (assets/bootAssets.ts). */
export const COMET_MODEL_PATHS: readonly string[] = [NUCLEUS_PATH, TAIL_PATH];
const TICK_SECONDS = 1 / 60;

/** The nucleus model's longest half-extent fills this share of the collision radius. */
const NUCLEUS_FIT = 0.92;
/** Tumble speed (rad/s) and its share under reduced motion. */
const TUMBLE = { rate: 0.16, reduced: 0.3 };
/** Look of the tails: tint, opacity and the width of the ribbons (× the model). */
const ION = { color: new Color(0.55, 0.8, 1.2), opacity: 0.5, width: 1.35 };
const DUST = { color: new Color(1.1, 0.85, 0.6), opacity: 0.42, width: 2.1, length: 0.72 };
/** Coma: width (u, × the shrink), opacity; the bright inner core. */
const COMA = { size: 30, alpha: 0.42, core: 13, coreAlpha: 0.22, color: new Color(0.55, 0.85, 1.1), coreColor: new Color(0.85, 1.05, 1.25) };
/** Vent glows and gas jets (u). */
const JET = { glow: 2.6, glowAlpha: 0.9, length: 9, width: 2.6, alpha: 0.55, color: new Color(0.8, 1.0, 1.2) };
/** Tail shard look: size over the sim radius, glint sprite. */
const SHARD = { scale: 0.85, glint: 2.8, glintAlpha: 0.5, color: new Color(0.75, 0.95, 1.25) };
/** The comet's point light (High only). */
const LIGHT = { color: 0x9fdcff, intensity: 170, distance: 70, height: 11 };
/** Motes (sublimation, shard bursts): pool size. */
const MOTES_MAX = 480;

interface Mote {
  pos: Vector3;
  vel: Vector3;
  acc: Vector3;
  age: number;
  life: number;
  size0: number;
  size1: number;
  alpha: number;
  color: Color;
}

interface Entry {
  id: string;
  passTicks: number;
  root: Group;
  /** Tumble + scale of the nucleus. */
  body: Group;
  opaque: Mesh;
  faded: Mesh;
  fadedMaterial: MeshStandardMaterial;
  jets: Object3D[];
  ion: Mesh;
  dust: Mesh;
  ionMaterial: MeshBasicMaterial;
  dustMaterial: MeshBasicMaterial;
  shards: InstancedMesh | null;
  /** Per-shard look: height, tumble axis and phase (from the comet id). */
  shardLook: { height: number; axis: Vector3; phase: number }[];
  tumbleAxis: Vector3;
  phase: number;
  /** The pass and the mined-shard mask last seen (bursts on new bits). */
  pass: number;
  tail: number;
  /** Smoothed nucleus shrink. */
  shrink: number;
  fade: number;
  /** Render pose (interpolated) and the sim pose at `tick` (mining beams are computed there). */
  pose: CometPose | null;
  simPos: { x: number; y: number };
  /** Distance to the ship (u) – emission and the light go to the nearest. */
  distance: number;
  emit: number;
}

interface Templates {
  nucleus: Mesh;
  /** Scale that fits the nucleus model to COMET.nucleusRadius. */
  fit: number;
  tailGeometry: BufferGeometry;
  tailTexture: Texture | null;
  owned: { geometries: BufferGeometry[]; materials: Material[]; textures: Texture[] };
}

/** Deterministic 0..1 values from a string (the look of a comet never flickers between builds). */
function rand01(key: string, i: number): number {
  return (fnv1a32(`${key}/${i}`) >>> 0) / 4294967296;
}

export class CometLayer {
  readonly object = new Group();
  private templates: Templates | null = null;
  private loading: Promise<void> | null = null;
  private readonly entries = new Map<string, Entry>();
  private readonly batch: SpriteBatch;
  private readonly motes: Mote[] = [];
  private readonly spare: Mote[] = [];
  private readonly lights: PointLight[] = [];
  private particles = 1;
  private disposed = false;
  private seed = 0;
  /** Sim time of the last drawn frame (s) – motes and smoothing run on the sim clock, still when paused. */
  private lastClock = -1;

  // scratch
  private readonly v = new Vector3();
  private readonly w = new Vector3();
  private readonly q = new Quaternion();
  private readonly m = new Matrix4();
  private readonly s = new Vector3();
  private readonly c = new Color();
  private readonly raycaster = new Raycaster();
  private readonly away = new Vector3();
  private readonly velWorld = new Vector3();

  constructor(private readonly fx: FxModels | null = null) {
    this.object.name = 'comets';
    this.batch = new SpriteBatch({ texture: vfxTexture('comet_coma'), additive: true, max: 900, renderOrder: 9 });
    this.batch.mesh.name = 'comet-glows';
    this.object.add(this.batch.mesh);
    this.setQuality({ particles: 1 });
  }

  /**
   * Graphics quality: mote counts follow the preset's particle multiplier; the comet's point light
   * exists on High only. The number of lights changes only here – adding a light recompiles every lit
   * material, so it is fixed between quality changes (as LaserView).
   */
  setQuality(p: Pick<QualityPreset, 'particles'>): void {
    this.particles = p.particles;
    const n = cometLightsFor(p);
    while (this.lights.length > n) {
      const l = this.lights.pop()!;
      this.object.remove(l);
      l.dispose();
    }
    while (this.lights.length < n) {
      const l = new PointLight(LIGHT.color, 0, LIGHT.distance, 2);
      l.castShadow = false;
      l.name = 'comet-light';
      this.object.add(l);
      this.lights.push(l);
    }
  }

  private ensureLoaded(): Promise<void> {
    this.loading ??= this.load().catch((e) => console.warn('Comet models failed to load', e));
    return this.loading;
  }

  private async load(): Promise<void> {
    const loader = createModelLoader();
    const parse = async (path: string) => {
      const data = await fetchAsset(path);
      if (!data || this.disposed) return null;
      return loader.parseAsync(data, assetUrl(path).replace(/[^/]*$/, ''));
    };
    const [nucleusGltf, tailGltf] = await Promise.all([parse(NUCLEUS_PATH), parse(TAIL_PATH)]);
    if (this.disposed || !nucleusGltf || !tailGltf) return;
    guardPaletteMaterials(nucleusGltf.scene);
    const owned: Templates['owned'] = { geometries: [], materials: [], textures: [] };
    const nucleus = nucleusGltf.scene.getObjectByName('Comet_Nucleus');
    const tail = tailGltf.scene.getObjectByName('Comet_Tail');
    if (!(nucleus instanceof Mesh) || !(tail instanceof Mesh)) {
      console.warn('Comet models: Comet_Nucleus / Comet_Tail missing');
      return;
    }
    for (const gltf of [nucleusGltf, tailGltf]) {
      gltf.scene.traverse((o) => {
        if (!(o instanceof Mesh)) return;
        owned.geometries.push(o.geometry);
        for (const mat of Array.isArray(o.material) ? o.material : [o.material]) owned.materials.push(mat);
      });
    }
    // the tail texture is AF_CometTail's own (embedded); the palette atlas is shared and never freed
    const tailMaterial = tail.material as MeshStandardMaterial;
    const tailTexture = tailMaterial.map ?? tailMaterial.emissiveMap ?? null;
    if (tailTexture) owned.textures.push(tailTexture);
    nucleus.removeFromParent();
    nucleus.position.set(0, 0, 0);
    nucleus.geometry.computeBoundingBox();
    const box = nucleus.geometry.boundingBox ?? new Box3();
    const size = box.getSize(new Vector3());
    const half = Math.max(size.x, size.y, size.z) / 2;
    const fit = half > 1e-6 ? (COMET.nucleusRadius * NUCLEUS_FIT) / half : 1;
    this.templates = { nucleus, fit, tailGeometry: tail.geometry, tailTexture, owned };
  }

  /** Builds the scene objects of one comet (also the warm-up sample). */
  private build(id: string, t: Templates): Entry {
    const root = new Group();
    root.name = `comet:${id}`;
    const body = new Group();
    const opaque = t.nucleus.clone();
    opaque.name = 'comet-nucleus';
    // a lone rock in its own glow: no AO pass (keeps a comet at ≤ 6 draw calls with shadows and AO)
    opaque.userData.noAO = true;
    const fadedMaterial = (t.nucleus.material as MeshStandardMaterial).clone();
    fadedMaterial.transparent = true;
    fadedMaterial.opacity = 0;
    const faded = new Mesh(t.nucleus.geometry, fadedMaterial);
    faded.name = 'comet-nucleus-fading';
    faded.visible = false;
    body.add(opaque, faded);
    body.scale.setScalar(t.fit);
    const jets: Object3D[] = [];
    opaque.traverse((o) => {
      if (o.name.startsWith('Comet_Jet_')) jets.push(o);
    });
    const tailMat = (color: Color, opacity: number): MeshBasicMaterial =>
      new MeshBasicMaterial({
        map: t.tailTexture,
        color,
        transparent: true,
        opacity,
        blending: AdditiveBlending,
        depthWrite: false,
        side: DoubleSide,
        forceSinglePass: true,
      });
    const ionMaterial = tailMat(ION.color, ION.opacity);
    const dustMaterial = tailMat(DUST.color, DUST.opacity);
    const ion = new Mesh(t.tailGeometry, ionMaterial);
    const dust = new Mesh(t.tailGeometry, dustMaterial);
    ion.name = 'comet-ion-tail';
    dust.name = 'comet-dust-tail';
    ion.renderOrder = 8;
    dust.renderOrder = 7;
    root.add(body, dust, ion);

    let shards: InstancedMesh | null = null;
    const shardLook: Entry['shardLook'] = [];
    const frag = this.fragment();
    if (frag) {
      shards = new InstancedMesh(frag.geometry, frag.material, COMET.tail.shards);
      shards.name = 'comet-shards';
      // small and many: no shadow and no AO (one draw call fewer in each of those passes)
      shards.userData.noShadow = true;
      shards.userData.noAO = true;
      shards.userData.unit = frag.radius;
      root.add(shards);
    }
    for (let i = 0; i < COMET.tail.shards; i++) {
      const a = new Vector3(rand01(id, 3 * i) - 0.5, rand01(id, 3 * i + 1) - 0.5, rand01(id, 3 * i + 2) - 0.5);
      if (a.lengthSq() < 1e-6) a.set(0, 1, 0);
      shardLook.push({ height: (rand01(id, 100 + i) - 0.5) * 1.6, axis: a.normalize(), phase: rand01(id, 200 + i) * Math.PI * 2 });
    }
    const tumbleAxis = new Vector3(rand01(id, 300) - 0.5, 0.6 + rand01(id, 301), rand01(id, 302) - 0.5).normalize();
    return {
      id,
      passTicks: cometById(this.seed, id)?.passTicks ?? 1,
      root,
      body,
      opaque,
      faded,
      fadedMaterial,
      jets,
      ion,
      dust,
      ionMaterial,
      dustMaterial,
      shards,
      shardLook,
      tumbleAxis,
      phase: rand01(id, 303) * Math.PI * 2,
      pass: -1,
      tail: 0,
      shrink: 1,
      fade: 0,
      pose: null,
      simPos: { x: 0, y: 0 },
      distance: Infinity,
      emit: 0,
    };
  }

  /** The ice fragment (geometry, material, radius) for the tail shards, once the fx models loaded. */
  private fragment(): { geometry: BufferGeometry; material: Material; radius: number } | null {
    if (!this.fx) return null;
    let found: Mesh | null = null;
    this.fx.fragmentTemplate('ice', 0).traverse((o) => {
      if (!found && o instanceof Mesh) found = o;
    });
    const mesh = found as Mesh | null;
    if (!mesh) return null;
    const g = mesh.geometry;
    if (!g.boundingSphere) g.computeBoundingSphere();
    return { geometry: g, material: mesh.material as Material, radius: Math.max(0.05, g.boundingSphere?.radius ?? 0.5) };
  }

  /** Per frame: the comets in their pass near the ship (alpha = interpolation between sim steps). */
  update(state: SimState, alpha: number, _frameDt: number, reducedMotion = false): void {
    this.seed = state.seed;
    const t = this.templates;
    if (!t) {
      // nothing to draw yet; start loading at the first comet near the ship
      if (cometsNear(state.seed, state.player.body.pos, COMET_LOOK.range, state.tick).length > 0) void this.ensureLoaded();
      this.batch.begin();
      this.batch.end();
      for (const l of this.lights) l.intensity = 0;
      return;
    }
    const ship = state.player.body.pos;
    // sim time of the drawn moment (tumble, shard spin) and the sim time since the last frame: the
    // motes ride with the comet, which moves by sim steps (frameDt may be clamped or the sim paused)
    const clock = Math.max(0, state.tick - 1 + alpha) * TICK_SECONDS;
    const dt = this.lastClock < 0 ? 0 : Math.min(0.25, Math.max(0, clock - this.lastClock));
    this.lastClock = clock;
    const near = cometsNear(state.seed, ship, COMET_LOOK.range, state.tick);
    const seen = new Set<string>();
    for (const now of near) {
      const pose = renderPose(state.seed, now.id, state.tick, alpha);
      if (!pose) continue;
      seen.add(now.id);
      let e = this.entries.get(now.id);
      if (!e) {
        e = this.build(now.id, t);
        this.entries.set(now.id, e);
        this.object.add(e.root);
      } else if (!e.shards && this.fragment()) {
        // the fx models arrived after the comet was built
        this.object.remove(e.root);
        this.release(e);
        e = this.build(now.id, t);
        this.entries.set(now.id, e);
        this.object.add(e.root);
      }
      e.pose = pose;
      e.simPos = now.pos;
      e.distance = Math.hypot(pose.pos.x - ship.x, pose.pos.y - ship.y);
      this.pose(e, state, pose, clock, dt, reducedMotion);
    }
    for (const [id, e] of this.entries) {
      if (seen.has(id)) continue;
      this.object.remove(e.root);
      this.release(e);
      this.entries.delete(id);
    }
    this.object.updateMatrixWorld();
    this.effects(dt, reducedMotion, state);
    this.light();
  }

  /** Places one comet: nucleus, tails, shards; bursts for shards mined since the last frame. */
  private pose(e: Entry, state: SimState, pose: CometPose, clock: number, dt: number, reducedMotion: boolean): void {
    const fade = cometFade(pose.t, e.passTicks);
    e.fade = fade;
    simToWorld(pose.pos, 0, e.root.position);
    e.root.visible = fade > 0.001;

    // nucleus: tumble, shrink with the core left, opaque unless fading
    const left = cometLeft(state, e.id, pose.pass);
    const target = nucleusShrink(left.core);
    if (e.pass !== pose.pass) e.shrink = target;
    else e.shrink += (target - e.shrink) * (1 - Math.exp(-dt * 3));
    const tumble = TUMBLE.rate * (reducedMotion ? TUMBLE.reduced : 1);
    e.body.quaternion.setFromAxisAngle(e.tumbleAxis, e.phase + clock * tumble);
    e.body.scale.setScalar((this.templates?.fit ?? 1) * e.shrink);
    const fading = fade < 0.999;
    e.opaque.visible = !fading;
    e.faded.visible = fading;
    e.fadedMaterial.opacity = fade;

    // tails: the ion tail straight away from home, the dust tail bent back along the orbit
    const axis = awayFromHome(pose.pos);
    const speed = Math.hypot(pose.vel.x, pose.vel.y);
    const length = tailLength(speed) / COMET_LOOK.tailModelLength;
    e.ion.rotation.set(0, tailYaw(axis), 0);
    e.ion.scale.set(length, ION.width, ION.width);
    e.ionMaterial.opacity = ION.opacity * fade;
    const dustDir = dustTailDir(axis, pose.vel);
    e.dust.rotation.set(0, tailYaw(dustDir), 0);
    e.dust.scale.set(length * DUST.length, DUST.width, DUST.width);
    e.dustMaterial.opacity = DUST.opacity * fade;

    // tail shards (the sim's placement at the drawn pose), mined ones hidden
    const shards = cometShards(pose);
    if (e.pass === pose.pass) {
      for (const i of newlyMined(e.tail, left.tail)) {
        const s = shards[i];
        if (s) this.burst(s.pos, e.shardLook[i]?.height ?? 0, pose.vel);
      }
    }
    e.pass = pose.pass;
    e.tail = left.tail;
    if (e.shards) {
      const unit = (e.shards.userData.unit as number) || 0.5;
      for (const s of shards) {
        const look = e.shardLook[s.index]!;
        if (left.tail & (1 << s.index) || fade <= 0.001) {
          this.m.makeScale(0, 0, 0);
        } else {
          this.v.set(s.pos.x - pose.pos.x, look.height, -(s.pos.y - pose.pos.y));
          this.q.setFromAxisAngle(look.axis, look.phase + clock * (reducedMotion ? 0.15 : 0.5));
          this.s.setScalar(((s.radius * SHARD.scale) / unit) * (0.3 + 0.7 * fade));
          this.m.compose(this.v, this.q, this.s);
        }
        e.shards.setMatrixAt(s.index, this.m);
      }
      e.shards.instanceMatrix.needsUpdate = true;
      e.shards.computeBoundingSphere();
    }
  }

  /** Coma, vent glows, jets, shard glints and the motes – all in the one sprite batch. */
  private effects(dt: number, reducedMotion: boolean, state: SimState): void {
    const b = this.batch;
    b.begin();
    const time = state.tick * TICK_SECONDS;
    for (const e of this.entries.values()) {
      if (!e.pose || e.fade <= 0.001) continue;
      const fade = e.fade;
      const pulse = reducedMotion ? 1 : 0.92 + 0.08 * Math.sin(time * 1.7 + e.phase);
      const center = e.root.position;
      this.c.copy(COMA.color);
      b.add(this.v.copy(center).setY(0.6), null, COMA.size * e.shrink, COMA.size * e.shrink, e.phase, this.c, COMA.alpha * fade * pulse);
      this.c.copy(COMA.coreColor);
      b.add(this.v.copy(center).setY(1.2), null, COMA.core * e.shrink, COMA.core * e.shrink, 0, this.c, COMA.coreAlpha * fade);
      // vents: a glow at the vent and a gas jet along its local +X
      for (let j = 0; j < e.jets.length; j++) {
        const jet = e.jets[j]!;
        jet.getWorldPosition(this.v);
        this.w.set(1, 0, 0).transformDirection(jet.matrixWorld);
        const flicker = reducedMotion ? 1 : 0.8 + 0.2 * Math.sin(time * 9 + j * 2.1 + e.phase);
        this.c.copy(JET.color);
        b.add(this.v, null, JET.glow, JET.glow, 0, this.c, JET.glowAlpha * fade * flicker);
        this.s.copy(this.v).addScaledVector(this.w, JET.length * 0.5 * e.shrink);
        b.add(this.s, this.w, JET.length * e.shrink, JET.width * e.shrink, 0, this.c, JET.alpha * fade * flicker);
      }
      // shard glints (the ice catches the light; hidden with the mined shard)
      if (e.shards) {
        const left = e.tail;
        for (let i = 0; i < COMET.tail.shards; i++) {
          if (left & (1 << i)) continue;
          e.shards.getMatrixAt(i, this.m);
          this.v.setFromMatrixPosition(this.m).applyMatrix4(e.root.matrixWorld);
          const tw = reducedMotion ? 1 : 0.6 + 0.4 * Math.sin(time * 2.3 + e.shardLook[i]!.phase * 3);
          this.c.copy(SHARD.color);
          b.add(this.v, null, SHARD.glint, SHARD.glint, 0, this.c, SHARD.glintAlpha * fade * tw);
        }
      }
      // sublimation: motes from the vents and the coma, blown down the tail
      if (e.distance <= COMET_LOOK.emitRange && this.particles > 0) {
        e.emit += sublimationRate(this.particles, reducedMotion) * fade * dt;
        const axis = awayFromHome(e.pose.pos);
        simToWorld(axis, 0, this.away);
        simToWorld(e.pose.vel, 0, this.velWorld);
        while (e.emit >= 1) {
          e.emit -= 1;
          this.sublimate(e);
        }
      } else {
        e.emit = 0;
      }
    }
    this.stepMotes(dt);
    b.end();
  }

  private mote(): Mote | null {
    if (this.motes.length >= MOTES_MAX * Math.max(0.25, this.particles)) return null;
    const m =
      this.spare.pop() ??
      ({ pos: new Vector3(), vel: new Vector3(), acc: new Vector3(), age: 0, life: 1, size0: 1, size1: 1, alpha: 1, color: new Color() } satisfies Mote);
    m.age = 0;
    this.motes.push(m);
    return m;
  }

  /** One sublimation mote: from a vent along its jet (most) or off the coma, pushed away from home. */
  private sublimate(e: Entry): void {
    const m = this.mote();
    if (!m) return;
    const r = Math.random();
    if (r < 0.65 && e.jets.length > 0) {
      const jet = e.jets[Math.floor(Math.random() * e.jets.length)]!;
      jet.getWorldPosition(m.pos);
      this.w.set(1, 0, 0).transformDirection(jet.matrixWorld);
      m.vel.copy(this.velWorld).addScaledVector(this.w, 4 + Math.random() * 5);
      m.size0 = 0.9;
      m.size1 = 2.6 + Math.random() * 1.6;
      m.alpha = 0.32;
      m.color.copy(JET.color);
    } else {
      this.w.set(Math.random() - 0.5, (Math.random() - 0.5) * 0.6, Math.random() - 0.5).normalize();
      m.pos.copy(e.root.position).addScaledVector(this.w, COMET.nucleusRadius * 0.8 * e.shrink);
      m.vel.copy(this.velWorld).addScaledVector(this.w, 1.5 + Math.random() * 2);
      m.size0 = 1.6;
      m.size1 = 3.5 + Math.random() * 2;
      m.alpha = 0.16;
      m.color.copy(COMA.color);
    }
    m.acc.copy(this.away).multiplyScalar(5 + Math.random() * 5);
    m.life = 1.8 + Math.random() * 1.2;
  }

  /** A tail shard shattered under the beam: an ice flash and glittering chips. */
  private burst(pos: { x: number; y: number }, height: number, vel: { x: number; y: number }): void {
    simToWorld(vel, 0, this.velWorld);
    const at = simToWorld(pos, height, new Vector3());
    const flash = this.mote();
    if (flash) {
      flash.pos.copy(at);
      flash.vel.copy(this.velWorld);
      flash.acc.set(0, 0, 0);
      flash.size0 = 4;
      flash.size1 = 10;
      flash.alpha = 0.9;
      flash.life = 0.45;
      flash.color.setRGB(1.4, 1.7, 2.0);
    }
    const chips = Math.max(4, Math.round(16 * Math.max(0.35, this.particles)));
    for (let i = 0; i < chips; i++) {
      const m = this.mote();
      if (!m) return;
      this.w.set(Math.random() - 0.5, Math.random() - 0.3, Math.random() - 0.5).normalize();
      m.pos.copy(at);
      m.vel.copy(this.velWorld).addScaledVector(this.w, 3 + Math.random() * 7);
      m.acc.set(0, 0, 0);
      m.size0 = 0.9;
      m.size1 = 0.3;
      m.alpha = 0.95;
      m.life = 0.8 + Math.random() * 0.7;
      m.color.setRGB(1.2, 1.5, 1.9);
    }
  }

  private stepMotes(dt: number): void {
    const b = this.batch;
    let n = 0;
    for (let i = 0; i < this.motes.length; i++) {
      const m = this.motes[i]!;
      m.age += dt;
      if (m.age >= m.life) {
        this.spare.push(m);
        continue;
      }
      m.vel.addScaledVector(m.acc, dt);
      m.pos.addScaledVector(m.vel, dt);
      this.motes[n++] = m;
      const k = m.age / m.life;
      const size = m.size0 + (m.size1 - m.size0) * k;
      b.add(m.pos, null, size, size, 0, m.color, m.alpha * (1 - k) * (1 - k));
    }
    this.motes.length = n;
  }

  /** The point light goes to the nearest visible comet. */
  private light(): void {
    if (this.lights.length === 0) return;
    let best: Entry | null = null;
    for (const e of this.entries.values()) if (e.fade > 0.001 && (!best || e.distance < best.distance)) best = e;
    for (const l of this.lights) {
      if (!best) {
        l.intensity = 0;
        continue;
      }
      l.position.copy(best.root.position).setY(LIGHT.height);
      l.intensity = LIGHT.intensity * best.fade * (0.6 + 0.4 * best.shrink);
    }
  }

  /**
   * End of a mining beam on a moving target (`beam.mover`): the sim computed `beam.to` with the comet
   * at the current tick, the comet is drawn interpolated – the end moves with it; on the nucleus it
   * lands on the drawn rock's surface (raycast), with that surface's normal.
   */
  beamEnd(beam: MiningBeam, out: Vector3, normal: Vector3): Vector3 | null {
    if (!beam.mover) return null;
    const target = moverTarget(beam.mover);
    const e = this.entries.get(target.id);
    if (!e || !e.pose) return null;
    const dx = e.pose.pos.x - e.simPos.x;
    const dy = e.pose.pos.y - e.simPos.y;
    const to = { x: beam.to.x + dx, y: beam.to.y + dy };
    if (target.shard === null) {
      const from = simToWorld(beam.from, 0.3, this.v);
      const end = simToWorld(to, 0.3, this.w);
      const dir = this.s.subVectors(end, from);
      const length = dir.length();
      if (length > 1e-6) {
        dir.divideScalar(length);
        this.raycaster.set(from, dir);
        this.raycaster.far = length + COMET.nucleusRadius * 2;
        const mesh = e.opaque.visible ? e.opaque : e.faded;
        const hit = this.raycaster.intersectObject(mesh, false)[0];
        if (hit) {
          out.copy(hit.point);
          if (hit.face) normal.copy(hit.face.normal).transformDirection(mesh.matrixWorld);
          else normal.copy(dir).negate();
          return out;
        }
      }
      simToWorld(to, 0.3, out);
      normal.copy(dir).negate().setY(0).normalize();
      return out;
    }
    // a tail shard: on the drawn chunk's near side (the mining circle is a little larger than the chunk)
    const shard = cometShards(e.pose)[target.shard];
    if (!shard) return null;
    const height = e.shardLook[target.shard]?.height ?? 0;
    const fx = beam.from.x - shard.pos.x;
    const fy = beam.from.y - shard.pos.y;
    const d = Math.hypot(fx, fy) || 1;
    const r = shard.radius * SHARD.scale * 0.8;
    simToWorld({ x: shard.pos.x + (fx / d) * r, y: shard.pos.y + (fy / d) * r }, height, out);
    normal.set(fx / d, 0.3, -fy / d).normalize();
    return out;
  }

  /** Effects from the step's sim events (the shard bursts come from the mined-shard mask). */
  onEvents(_events: readonly SimEvent[]): void {}

  /** Shader warm-up: one sample of every material the layer makes later. */
  async warmUp(zoo: WarmUpZoo): Promise<void> {
    await this.ensureLoaded();
    if (this.fx) await this.fx.ready;
    const t = this.templates;
    if (this.disposed || !t) return;
    const sample = this.build('cm:warmup', t);
    sample.faded.visible = true;
    sample.fadedMaterial.opacity = 0.5;
    if (sample.shards) {
      sample.shards.count = 1;
      sample.shards.setMatrixAt(0, this.m.identity());
    }
    zoo.add(sample.root);
  }

  /** Comets built, drawn and the motes alive (tests, tuning). */
  stats(): { comets: number; visible: number; shards: number; motes: number; lights: number } {
    let visible = 0;
    let shards = 0;
    for (const e of this.entries.values()) {
      if (e.fade <= 0.001) continue;
      visible++;
      for (let i = 0; i < COMET.tail.shards; i++) if (!(e.tail & (1 << i))) shards++;
    }
    return { comets: this.entries.size, visible, shards, motes: this.motes.length, lights: this.lights.length };
  }

  private release(e: Entry): void {
    e.fadedMaterial.dispose();
    e.ionMaterial.dispose();
    e.dustMaterial.dispose();
    // the instance buffer is the entry's own; geometry and material are the shared fx fragment's
    e.shards?.dispose();
  }

  dispose(): void {
    this.disposed = true;
    for (const e of this.entries.values()) this.release(e);
    this.entries.clear();
    this.object.clear();
    this.batch.dispose();
    for (const l of this.lights) l.dispose();
    this.lights.length = 0;
    const t = this.templates;
    if (t) {
      for (const g of new Set(t.owned.geometries)) g.dispose();
      for (const m of new Set(t.owned.materials)) m.dispose();
      for (const x of t.owned.textures) x.dispose();
    }
    this.templates = null;
  }
}
