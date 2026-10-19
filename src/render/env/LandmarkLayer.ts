// Far landmarks (readability plan 2026-10-18 §2, art/README §2.7.20): the huge scenery models deep
// below the gameplay plane (relay mast, ring shards, crystal walls, dead forges) at the world
// positions from `landmarkSites()`, and the Echo light columns over located Echo beacons.
//
// Look: the albedo is mixed ~50 % toward the zone haze colour and the emissive ~15 %, so the
// silhouettes sit in the distance while the lamps survive; additive glow sprites at the `glow_<i>`
// empties keep the night read at 1–2 world units per pixel. Animation (manifest notes): red lamps
// blink, pirate lamps blink irregularly, forge glyphs pulse, the forge ring spins, halos breathe.
// Low quality drops the glow sprites and the animation, the software Low (SOFTWARE_LOW) the models;
// reduced motion freezes everything at a steady level. Models load lazily once a site is near.
import {
  AdditiveBlending,
  Color,
  DoubleSide,
  Group,
  Matrix3,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  PlaneGeometry,
  ShaderMaterial,
  Sprite,
  SpriteMaterial,
  Vector3,
  type BufferGeometry,
  type Material,
  type PerspectiveCamera,
  type Texture,
} from 'three';
import { echoId, echoSites } from '../../sim/discovery/poi';
import type { SimState } from '../../sim/Simulation';
import { landmarkSites, type LandmarkKind, type LandmarkSite } from '../../sim/world/landmarks';
import { assetUrl } from '../assets/url';
import { createModelLoader } from '../assets/gltf';
import { vfxTexture } from '../fx/textures';
import { SOFTWARE_LOW, type QualityPreset } from '../quality';
import {
  boundingRadius,
  echoColumnFade,
  echoRhythm,
  parseLandmarkManifest,
  pulsePeriod,
  sphereInView,
  type EchoColumnDef,
  type LandmarkManifest,
  type LandmarkModelDef,
} from './landmarkView';
import type { WarmUpZoo } from '../warmup';

const MODELS_DIR = 'assets/models/landmarks/';
/** A model starts loading when one of its sites is this close to the view (world units, on the plane). */
const LOAD_RANGE = 7000;
/** The Echo ray widens with the ship's distance from its beacon beyond this (u), up to this factor. */
const ECHO_WIDEN_FROM = 120;
const ECHO_MAX_WIDEN = 5;
/**
 * Length of the lower half vs. the ship's distance from the beacon: the ray ends about halfway
 * between the screen edge and the centre (its end lies ~distance / (length·tan) off the view axis).
 */
const ECHO_LENGTH_PER_DISTANCE = 3.5;
const ECHO_MAX_LENGTH = 5000;
/** Extra margin of the view test: the model is shown a little before it enters the frame. */
const VIEW_MARGIN = 60;

/** How the emissive of a node animates (shader). */
type LightMode = 0 | 1 | 2 | 3;
const STEADY: LightMode = 0;
/** Red lamps blink 1 s (staggered per lamp), the other lamps breathe slowly (2.5 s). */
const BLINK: LightMode = 1;
/** Irregular pirate lamps: 0.6–1.4 s per lamp, random phase, a few stay dark. */
const IRREGULAR: LightMode = 2;
/** A slow dying pulse of the whole node (6–8 s, 0.4–1.0). */
const PULSE: LightMode = 3;

/** Animated child nodes by name (manifest `nodes`). */
const NODE_MODES: Readonly<Record<string, LightMode>> = {
  Relay_Beacons: BLINK,
  Shard_Lights: IRREGULAR,
  Forge_Glyphs: PULSE,
};
const SPIN_NODES: Readonly<Record<string, number>> = { Forge_Ring: 0.01 };

/** The landmark haze patch of a standard (atlas) material: the lit part toward the haze, emissive mostly kept. */
function patchMaterial(material: MeshStandardMaterial, mode: LightMode, shared: SharedUniforms, haze: { albedo: number; emissive: number }): void {
  const uniforms = {
    uLmHaze: shared.haze,
    uLmDim: shared.dim,
    uLmTime: shared.time,
    uLmAnim: shared.anim,
    uLmHazeAlbedo: { value: haze.albedo },
    uLmHazeEmissive: { value: haze.emissive },
  };
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vLmPos;\nvarying float vLmSeed;')
      .replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>\nvLmPos = position;\nvLmSeed = fract(dot(modelMatrix[3].xz, vec2(0.01237, 0.02171)));',
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
uniform vec3 uLmHaze;
uniform float uLmDim;
uniform float uLmTime;
uniform float uLmAnim;
uniform float uLmHazeAlbedo;
uniform float uLmHazeEmissive;
varying vec3 vLmPos;
varying float vLmSeed;
float lmHash(vec3 p) { return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }
float lmLight(vec3 e) {
  vec3 cell = floor(vLmPos / 6.0);
  float h1 = lmHash(cell + vLmSeed * 17.0);
  float h2 = lmHash(cell.zyx + 3.1 + vLmSeed * 5.0);
  float h3 = lmHash(cell.yxz + 7.7);
#if LM_MODE == 1
  bool red = e.r > (e.g * 2.0 + 0.01) && e.r > e.b * 2.0;
  if (uLmAnim < 0.5) return red ? 0.85 : 0.8;
  if (red) return 0.12 + 0.88 * smoothstep(0.0, 0.08, fract(uLmTime + h1)) * (1.0 - smoothstep(0.5, 0.58, fract(uLmTime + h1)));
  return 0.65 + 0.35 * (0.5 + 0.5 * sin(6.2832 * (uLmTime / 2.5 + h2)));
#elif LM_MODE == 2
  if (h3 < 0.22) return 0.06;
  if (uLmAnim < 0.5) return 0.8;
  float ph = fract(uLmTime / (0.6 + 0.8 * h1) + h2);
  return 0.08 + 0.92 * step(ph, 0.45 + 0.2 * h3);
#elif LM_MODE == 3
  if (uLmAnim < 0.5) return 0.75;
  return 0.4 + 0.6 * (0.5 + 0.5 * sin(6.2832 * (uLmTime / (6.0 + 2.0 * vLmSeed) + vLmSeed)));
#else
  return 1.0;
#endif
}`,
      )
      .replace(
        'vec3 outgoingLight = totalDiffuse + totalSpecular + totalEmissiveRadiance;',
        `vec3 lmLit = mix(totalDiffuse + totalSpecular, uLmHaze, uLmHazeAlbedo) * uLmDim;
vec3 lmEm = totalEmissiveRadiance * lmLight(totalEmissiveRadiance);
lmEm = mix(lmEm, uLmHaze * dot(lmEm, vec3(0.3333)) * 2.0, uLmHazeEmissive);
vec3 outgoingLight = lmLit + lmEm;`,
      );
  };
  material.defines = { ...(material.defines ?? {}), LM_MODE: mode };
  material.customProgramCacheKey = () => `cinder-landmark-v1-${mode}`;
  material.userData.noAO = true;
  material.needsUpdate = true;
}

interface SharedUniforms {
  haze: { value: Color };
  dim: { value: number };
  time: { value: number };
  anim: { value: number };
}

interface KindAssets {
  def: LandmarkModelDef;
  template: Object3D;
  radius: number;
}

interface GlowEntry {
  sprite: Sprite;
  material: SpriteMaterial;
  base: number;
  color: Color;
  /** Breathing period (s), null = steady. */
  period: number | null;
  phase: number;
}

interface Instance {
  site: LandmarkSite;
  group: Group;
  center: Vector3;
  radius: number;
  glows: GlowEntry[];
  spins: { node: Object3D; speed: number }[];
}

const ECHO_VERTEX = /* glsl */ `
uniform mat3 uUvTransform;
varying vec2 vUv;
varying float vY;
void main() {
  // the optimized GLB stores quantized texcoords + a texture transform (KHR_texture_transform)
  vUv = (uUvTransform * vec3(uv, 1.0)).xy;
  vY = position.y;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const ECHO_FRAGMENT = /* glsl */ `
uniform sampler2D uMap;
uniform float uIntensity;
varying vec2 vUv;
varying float vY;
void main() {
  // compass option: only the lower half (the down-ray along the view direction)
  if (vY > 0.0) discard;
  vec4 c = texture2D(uMap, vUv);
  // HDR: the white-hot core blooms, the ember halo stays readable at 1–2 world units per pixel
  gl_FragColor = vec4(c.rgb * c.a * uIntensity * 6.0, 1.0);
}`;

interface EchoColumn {
  id: string;
  mesh: Mesh;
  material: ShaderMaterial;
  pos: { x: number; y: number };
  phase: number;
}

export class LandmarkLayer {
  readonly object = new Group();
  private sites: readonly LandmarkSite[];
  private seed: number;
  private manifest: LandmarkManifest | null = null;
  private readonly kinds = new Map<LandmarkKind, KindAssets>();
  private readonly loading = new Set<LandmarkKind>();
  private readonly instances = new Map<string, Instance>();
  private readonly shared: SharedUniforms = { haze: { value: new Color() }, dim: { value: 1 }, time: { value: 0 }, anim: { value: 1 } };
  private readonly ownedMaterials = new Set<Material>();
  private readonly ownedGeometries = new Set<BufferGeometry>();
  private readonly loader = createModelLoader();
  private echoTemplate: { geometry: BufferGeometry; map: Texture | null; uvTransform: Matrix3; def: EchoColumnDef } | null = null;
  private echoLoading = false;
  private readonly echoes = new Map<string, EchoColumn>();
  private located: { id: string; pos: { x: number; y: number } }[] = [];
  private modelsOn = true;
  private glowsOn = true;
  private animOn = true;
  private reducedMotion = false;
  private time = 0;
  private disposed = false;
  private visibleCount = 0;
  private readonly tmp = new Vector3();
  private readonly tmpColor = new Color();

  constructor(seed: number) {
    this.object.name = 'landmarks';
    this.object.userData.noShadow = true;
    this.object.userData.noAO = true;
    this.seed = seed;
    this.sites = landmarkSites(seed);
    void fetch(assetUrl(`${MODELS_DIR}landmarks.json`))
      .then((r) => (r.ok ? r.json() : null))
      .then((json: unknown) => {
        if (!this.disposed) this.manifest = parseLandmarkManifest(json);
      })
      .catch((e: unknown) => console.warn('Landmark manifest missing – no far landmarks', e));
  }

  /**
   * The landmark list to show (world positions, kinds, yaw). Today the ring rules of
   * `landmarkSites(seed)`; the sectors feature will hand in its own per-sector list here.
   */
  setSites(sites: readonly LandmarkSite[]): void {
    if (sites === this.sites) return;
    this.sites = sites;
    for (const inst of this.instances.values()) this.dropInstance(inst);
    this.instances.clear();
  }

  /** The first site of a kind (the world-anchored gas giant reads its position here). */
  siteOf(kind: LandmarkKind): LandmarkSite | null {
    return this.sites.find((s) => s.kind === kind) ?? null;
  }

  /** Game state hook: the seed's sites, which Echo beacons are located, reduced motion. */
  sync(state: SimState, reducedMotion: boolean): void {
    if (state.seed !== this.seed) {
      this.seed = state.seed;
      this.setSites(landmarkSites(state.seed));
    }
    this.reducedMotion = reducedMotion;
    const known = state.discovery.known;
    let n = 0;
    for (const s of echoSites(state.seed)) if (known.has(echoId(s.index))) n++;
    if (n === this.located.length) return;
    this.located = echoSites(state.seed)
      .filter((s) => known.has(echoId(s.index)))
      .map((s) => ({ id: s.id, pos: s.pos }));
  }

  setQuality(preset: QualityPreset): void {
    this.modelsOn = preset !== SOFTWARE_LOW;
    // Low: no halos, no animation (static lights); Medium and High: everything
    this.glowsOn = preset.planetDetail;
    this.animOn = preset.planetDetail;
    if (!this.modelsOn) {
      for (const inst of this.instances.values()) this.dropInstance(inst);
      this.instances.clear();
    }
  }

  /**
   * Shader warm-up: the haze copy of an atlas material in every light mode, a halo and an Echo
   * column (the models load only when a landmark comes near). `palette` = an atlas mesh of the
   * gameplay models (the landmark GLBs share the atlas material layout).
   */
  warmUp(zoo: WarmUpZoo, palette: Mesh | null): void {
    const src = palette?.material;
    if (palette && src instanceof MeshStandardMaterial) {
      for (const mode of [STEADY, BLINK, IRREGULAR, PULSE]) {
        const copy = src.clone();
        patchMaterial(copy, mode, this.shared, { albedo: 0.5, emissive: 0.15 });
        zoo.addBackdrop(new Mesh(palette.geometry, copy));
      }
    }
    const halo = new SpriteMaterial({ map: vfxTexture('glow_soft'), transparent: true, blending: AdditiveBlending, depthWrite: false });
    halo.userData.noAO = true;
    zoo.addBackdrop(new Sprite(halo));
    const column = new ShaderMaterial({
      uniforms: { uMap: { value: null }, uIntensity: { value: 0 }, uUvTransform: { value: new Matrix3() } },
      vertexShader: ECHO_VERTEX,
      fragmentShader: ECHO_FRAGMENT,
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      side: DoubleSide,
      forceSinglePass: true,
    });
    column.userData.noAO = true;
    zoo.addBackdrop(new Mesh(zoo.geometry(new PlaneGeometry(1, 1)), column));
  }

  /** Background brightness: the multiplier of the lit (non-emissive) part. */
  setDim(dim: number): void {
    this.shared.dim.value = dim;
  }

  /** Landmarks in the view this frame (stats / tests). */
  get visible(): number {
    return this.visibleCount;
  }

  /** Echo columns currently shown (stats / tests). */
  get echoColumns(): number {
    let n = 0;
    for (const e of this.echoes.values()) if (e.mesh.visible) n++;
    return n;
  }

  /** `target` = the point the camera looks at on the plane, `haze` = the zone haze colour (hex, cross-faded). */
  update(camera: PerspectiveCamera, target: Vector3, dt: number, haze: number): void {
    const animate = this.animOn && !this.reducedMotion;
    if (animate) this.time += dt;
    this.shared.time.value = this.time;
    this.shared.anim.value = animate ? 1 : 0;
    this.shared.haze.value.setHex(haze);
    this.visibleCount = 0;
    if (this.manifest && this.modelsOn) this.updateModels(camera, target, dt, animate, haze);
    this.updateEchoes(target);
  }

  private updateModels(camera: PerspectiveCamera, target: Vector3, dt: number, animate: boolean, haze: number): void {
    const manifest = this.manifest!;
    for (const site of this.sites) {
      if (site.kind === 'gas_giant') continue;
      const def = manifest.models[site.kind];
      if (!def) continue;
      const near = Math.hypot(site.pos.x - target.x, -site.pos.y - target.z) < LOAD_RANGE;
      let inst = this.instances.get(site.id);
      if (!inst) {
        if (!near) continue;
        const kind = this.kinds.get(site.kind);
        if (!kind) {
          this.requestKind(site.kind, def);
          continue;
        }
        inst = this.createInstance(site, kind);
      }
      const show = near && sphereInView(camera.position, target, camera.fov, camera.aspect, camera.far, inst.center, inst.radius + VIEW_MARGIN);
      inst.group.visible = show;
      if (!show) continue;
      this.visibleCount++;
      if (animate) for (const s of inst.spins) s.node.rotateY(s.speed * dt);
      for (const g of inst.glows) {
        g.sprite.visible = this.glowsOn;
        if (!this.glowsOn) continue;
        const breathe = g.period && animate ? 0.7 + 0.3 * Math.sin((this.time / g.period + g.phase) * Math.PI * 2) : 0.85;
        g.material.opacity = g.base * breathe;
        // halos keep their colour, only a touch of the haze (manifest: 15 % on the emissive)
        g.material.color.copy(g.color).lerp(this.tmpColor.setHex(haze), def.haze.emissive);
      }
    }
  }

  private requestKind(kind: LandmarkKind, def: LandmarkModelDef): void {
    if (this.loading.has(kind)) return;
    this.loading.add(kind);
    this.loader
      .loadAsync(assetUrl(`${MODELS_DIR}${def.file}`))
      .then((gltf) => {
        if (this.disposed) return;
        const template = gltf.scene;
        // one haze material per node class, shared by every instance of the kind
        const byMode = new Map<LightMode, Material>();
        const originals = new Set<Material>();
        template.traverse((o) => {
          if (!(o instanceof Mesh)) return;
          originals.add(o.material as Material);
          let mode: LightMode = STEADY;
          for (let p: Object3D | null = o; p; p = p.parent) if (NODE_MODES[p.name] !== undefined) mode = NODE_MODES[p.name]!;
          let mat = byMode.get(mode);
          if (!mat) {
            const src = o.material as Material;
            const copy = src instanceof MeshStandardMaterial ? src.clone() : new MeshStandardMaterial({ color: 0x555566 });
            patchMaterial(copy, mode, this.shared, def.haze);
            this.ownedMaterials.add(copy);
            mat = copy;
            byMode.set(mode, mat);
          }
          o.material = mat;
          o.castShadow = false;
          o.receiveShadow = false;
          this.ownedGeometries.add(o.geometry as BufferGeometry);
        });
        // the GLB's own materials are replaced (their textures are the shared atlas – kept)
        for (const m of originals) m.dispose();
        this.kinds.set(kind, { def, template, radius: boundingRadius(def.worldSize) });
      })
      .catch((e: unknown) => console.warn(`Landmark ${def.file} failed to load`, e))
      .finally(() => this.loading.delete(kind));
  }

  private createInstance(site: LandmarkSite, kind: KindAssets): Instance {
    const { def } = kind;
    const group = new Group();
    group.name = `landmark:${site.id}`;
    const model = kind.template.clone(true);
    group.add(model);
    group.position.set(site.pos.x, -def.depth, -site.pos.y);
    group.rotation.y = site.yaw;
    group.scale.setScalar(def.scale);
    group.userData.noShadow = true;
    group.userData.noAO = true;
    this.object.add(group);
    group.updateMatrixWorld(true);
    // bounding sphere centre: the model's own bounds may sit off its origin (crystal wall, relay)
    const center = new Vector3();
    let count = 0;
    model.traverse((o) => {
      if (!(o instanceof Mesh)) return;
      const g = o.geometry as BufferGeometry;
      g.computeBoundingSphere();
      if (!g.boundingSphere) return;
      center.add(o.localToWorld(this.tmp.copy(g.boundingSphere.center)));
      count++;
    });
    if (count > 0) center.divideScalar(count);
    else center.copy(group.position);

    const glows: GlowEntry[] = [];
    def.glows.forEach((gd, i) => {
      const node = model.getObjectByName(gd.node);
      if (!node) return;
      const color = new Color(gd.color);
      const material = new SpriteMaterial({ map: vfxTexture('glow_soft'), color, transparent: true, opacity: gd.opacity, blending: AdditiveBlending, depthWrite: false });
      material.userData.noAO = true;
      this.ownedMaterials.add(material);
      const sprite = new Sprite(material);
      sprite.scale.setScalar(gd.size / def.scale);
      sprite.renderOrder = 2;
      sprite.userData.noAO = true;
      node.add(sprite);
      const seed = Math.abs(Math.sin(site.pos.x * 0.013 + site.pos.y * 0.029 + i * 1.7));
      glows.push({ sprite, material, base: gd.opacity, color, period: pulsePeriod(gd.pulse, seed), phase: seed });
    });
    const spins: Instance['spins'] = [];
    for (const [name, speed] of Object.entries(SPIN_NODES)) {
      const node = model.getObjectByName(name);
      if (node) spins.push({ node, speed });
    }
    const inst: Instance = { site, group, center, radius: kind.radius, glows, spins };
    this.instances.set(site.id, inst);
    return inst;
  }

  private dropInstance(inst: Instance): void {
    for (const g of inst.glows) {
      g.material.dispose();
      this.ownedMaterials.delete(g.material);
    }
    inst.group.removeFromParent();
  }

  private requestEcho(): void {
    const def = this.manifest?.echoColumn;
    if (!def || this.echoLoading || this.echoTemplate) return;
    this.echoLoading = true;
    this.loader
      .loadAsync(assetUrl(`${MODELS_DIR}${def.file}`))
      .then((gltf) => {
        if (this.disposed) return;
        let mesh: Mesh | null = null;
        gltf.scene.traverse((o) => {
          if (!mesh && o instanceof Mesh) mesh = o;
        });
        if (!mesh) return;
        const m = mesh as Mesh;
        const src = m.material as MeshStandardMaterial;
        const map = src.emissiveMap ?? src.map ?? null;
        const uvTransform = new Matrix3();
        if (map) {
          map.updateMatrix();
          uvTransform.copy(map.matrix);
        }
        this.ownedGeometries.add(m.geometry as BufferGeometry);
        this.echoTemplate = { geometry: m.geometry as BufferGeometry, map, uvTransform, def };
      })
      .catch((e: unknown) => console.warn('Echo column failed to load', e))
      .finally(() => (this.echoLoading = false));
  }

  private updateEchoes(target: Vector3): void {
    if (this.located.length === 0 && this.echoes.size === 0) return;
    if (!this.echoTemplate) {
      this.requestEcho();
      return;
    }
    const t = this.echoTemplate;
    for (const e of this.located) {
      if (this.echoes.has(e.id)) continue;
      const material = new ShaderMaterial({
        uniforms: { uMap: { value: t.map }, uIntensity: { value: 0 }, uUvTransform: { value: t.uvTransform } },
        vertexShader: ECHO_VERTEX,
        fragmentShader: ECHO_FRAGMENT,
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
        side: DoubleSide,
        forceSinglePass: true,
      });
      material.userData.noAO = true;
      this.ownedMaterials.add(material);
      const mesh = new Mesh(t.geometry, material);
      mesh.name = `echo-column:${e.id}`;
      mesh.userData.noAO = true;
      mesh.userData.noShadow = true;
      mesh.renderOrder = 3;
      mesh.position.set(e.pos.x, 0, -e.pos.y);
      mesh.scale.set(t.def.scale.width, t.def.scale.height, t.def.scale.width);
      // compass option: the top leans toward the camera, the lower half runs along the view direction
      mesh.rotation.x = (t.def.tiltDeg.compass * Math.PI) / 180;
      this.object.add(mesh);
      this.echoes.set(e.id, { id: e.id, mesh, material, pos: e.pos, phase: (e.pos.x * 0.37 + e.pos.y * 0.11) % 1.6 });
    }
    for (const col of this.echoes.values()) {
      const distance = Math.hypot(col.pos.x - target.x, -col.pos.y - target.z);
      const fade = echoColumnFade(distance);
      // a far beacon's ray grows longer and wider so it still reaches well into the view as a needle
      const width = t.def.scale.width * Math.min(ECHO_MAX_WIDEN, Math.max(1, distance / ECHO_WIDEN_FROM));
      const height = Math.min(ECHO_MAX_LENGTH, Math.max(t.def.scale.height, distance * ECHO_LENGTH_PER_DISTANCE));
      col.mesh.scale.set(width, height, width);
      const intensity = fade * echoRhythm(this.time + col.phase, this.reducedMotion || !this.animOn);
      col.material.uniforms.uIntensity!.value = intensity;
      col.mesh.visible = intensity > 0.002;
    }
  }

  dispose(): void {
    this.disposed = true;
    for (const inst of this.instances.values()) this.dropInstance(inst);
    this.instances.clear();
    for (const m of this.ownedMaterials) m.dispose();
    for (const g of this.ownedGeometries) g.dispose();
    this.object.removeFromParent();
  }
}
