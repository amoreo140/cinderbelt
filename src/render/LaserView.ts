// Mining beams (Mining 2.0, plan 2026-10-17-tazba-2). Every laser draws its own beam from its own
// Muzzle: a camera-facing ribbon with a white-hot core and a coloured glow (cross-section from
// vfx/beam.png), energy flowing along it (scrolling vfx/flame_noise) and a breathing width. The beam
// shoots out of the muzzle and pulls back into it. Where it bites the rock: a molten spot lying on
// the surface, a glow, sparks and embers in the ore colour, chips and dust (impact_dust), and a small
// point light that lights the rock (only Medium / High – graphics quality). On the vein bonus the
// beam warms to gold, near overheating it flickers toward red, out of energy it sputters, a cooling
// laser smokes at the muzzle. Look by state: render/mining/beamLook.ts (pure, tested).
import {
  AdditiveBlending,
  BufferGeometry,
  Color,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  PointLight,
  Quaternion,
  ShaderMaterial,
  Vector3,
} from 'three';
import { RESOURCES, type ResourceId } from '../data/resources';
import type { MiningBeam } from '../sim/mining/mining';
import { simToWorld } from './coords';
import { Particles, SpriteBatch } from './fx/Particles';
import { vfxTexture } from './fx/textures';
import { beamLook, stepExtend, type BeamLook, type Rgb } from './mining/beamLook';
import type { QualityPreset } from './quality';

const BEAM_HEIGHT = 0.3;
const Z = new Vector3(0, 0, 1);

/** World position of the laser's muzzle (from the ship model), or null – then the sim position is used. */
export type MuzzleLookup = (laser: number, out: Vector3) => Vector3 | null;
/**
 * World position of the beam's end (on a vein / on the rock surface) and the surface normal there,
 * or null – then the end is at BEAM_HEIGHT and the normal points back at the ship.
 */
export type BeamEndLookup = (beam: MiningBeam, out: Vector3, normal: Vector3) => Vector3 | null;

/** What the view needs to know about each laser of the ship (index = ShipProperties.lasers). */
export interface LaserSlotInfo {
  /** Heat 0..1. */
  heat: number;
  cooling: boolean;
  heavy: boolean;
}

export interface LaserFrame {
  beams: readonly MiningBeam[];
  lasers: readonly LaserSlotInfo[];
  /** Mining is held but the battery cannot keep the lasers running (they sputter). */
  starved: boolean;
  time: number;
  dt: number;
  muzzle?: MuzzleLookup;
  end?: BeamEndLookup;
}

const VERTEX = /* glsl */ `
attribute vec2 aBeam;
uniform vec3 uFrom;
uniform vec3 uTo;
uniform float uWidth;
uniform float uExtend;
varying vec2 vBeam;
varying float vAlong;
void main() {
  vec3 axis = uTo - uFrom;
  float len = max(length(axis), 1e-4);
  vec3 dir = axis / len;
  float u = aBeam.x * uExtend;
  vec3 p = uFrom + axis * u;
  vec3 toCam = normalize(cameraPosition - p);
  vec3 side = cross(dir, toCam);
  float sl = length(side);
  side = sl > 1e-4 ? side / sl : vec3(1.0, 0.0, 0.0);
  // a little narrower right at the muzzle, the full width a short way out
  float w = uWidth * (0.45 + 0.55 * smoothstep(0.0, 0.6, u * len));
  p += side * aBeam.y * w;
  vBeam = vec2(u, aBeam.y);
  vAlong = u * len;
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
}`;

const FRAGMENT = /* glsl */ `
uniform sampler2D uProfile;
uniform sampler2D uNoise;
uniform vec3 uCore;
uniform vec3 uGlow;
uniform float uIntensity;
uniform float uTime;
uniform float uFlow;
uniform float uCoreFrac;
uniform float uExtend;
uniform float uLen;
uniform float uOpenEnd;
varying vec2 vBeam;
varying float vAlong;
void main() {
  float s = vBeam.y;
  float a = abs(s);
  float halo = texture2D(uProfile, vec2(0.5, s * 0.5 + 0.5)).a;
  float core = 1.0 - smoothstep(uCoreFrac * 0.45, uCoreFrac, a);
  // energy flowing from the muzzle to the rock: two scrolling noise layers and travelling bands
  float n1 = texture2D(uNoise, vec2(vAlong * 0.16 - uTime * uFlow * 0.16, s * 0.3 + 0.37)).r;
  float n2 = texture2D(uNoise, vec2(vAlong * 0.43 - uTime * uFlow * 0.29, s * 0.55 + 0.71)).g;
  float energy = 0.45 + 1.6 * n1 * n2;
  float bands = 0.8 + 0.2 * sin(vAlong * 3.1 - uTime * uFlow * 0.8);
  float glow = halo * halo * energy * bands;
  // the glow's edge is eroded by the noise – it is plasma, not a tube
  glow *= 1.0 - smoothstep(0.45 + 0.35 * n2, 1.0, a);
  float start = smoothstep(0.0, 0.4, vAlong);
  float tip = uExtend < 0.999 ? exp(-max(0.0, (uExtend - vBeam.x) * uLen) * 2.5) : 0.0;
  vec3 col = uGlow * (glow * 1.1 + core * 0.6) + uCore * core * (0.7 + 0.4 * n1);
  col += (uCore * 0.6 + uGlow * 0.4) * tip * (1.0 - a);
  // a beam into empty space thins out over its last third
  float end = mix(1.0, 1.0 - smoothstep(0.62, 1.0, vBeam.x), uOpenEnd);
  col *= uIntensity * mix(0.55, 1.0, start) * end;
  gl_FragColor = vec4(col, 1.0);
}`;

interface Slot {
  mesh: Mesh;
  material: ShaderMaterial;
  decal: Mesh;
  decalMaterial: MeshBasicMaterial;
  from: Vector3;
  to: Vector3;
  normal: Vector3;
  extend: number;
  /** The beam bites a rock or a wreck (impact effects). */
  hit: boolean;
  resource: ResourceId | null;
  /** Mining multiplier of the last beam (a retracting beam keeps its colour). */
  bonus: number;
  look: BeamLook;
  /** Time the laser last fired (sputter keeps a starved beam alive between bursts). */
  seen: number;
  sparks: number;
  embers: number;
  dust: number;
  smoke: number;
}

const rand = (min: number, max: number): number => min + Math.random() * (max - min);
const rgb = (c: Rgb, k = 1): Color => new Color(c[0] * k, c[1] * k, c[2] * k);

function ribbon(): BufferGeometry {
  const g = new BufferGeometry();
  // x = along (0 muzzle, 1 end), y = across (−1 … 1)
  g.setAttribute('aBeam', new Float32BufferAttribute([0, -1, 1, -1, 1, 1, 0, 1], 2));
  g.setAttribute('position', new Float32BufferAttribute(new Array(12).fill(0), 3));
  g.setIndex([0, 1, 2, 0, 2, 3]);
  return g;
}

/** Point lights at beam hits by quality: High 2, Medium 1, Low (and software) none. */
export const hitLightsFor = (p: Pick<QualityPreset, 'particles'>): number => (p.particles >= 1 ? 2 : p.particles >= 0.5 ? 1 : 0);

export class LaserView {
  readonly object = new Group();
  private readonly slots: Slot[] = [];
  private readonly geometry = ribbon();
  private readonly decalGeometry = new PlaneGeometry(1, 1);
  private readonly sparks = new Particles({ texture: vfxTexture('spark'), additive: true, max: 384, renderOrder: 13 });
  private readonly embers = new Particles({ texture: vfxTexture('ember'), additive: true, max: 192, renderOrder: 13 });
  private readonly dust = new Particles({ texture: vfxTexture('impact_dust'), additive: false, cols: 4, rows: 4, max: 64, renderOrder: 11 });
  private readonly smoke = new Particles({ texture: vfxTexture('smoke_puff'), additive: false, max: 48, renderOrder: 10 });
  /** Glows redrawn every frame: muzzle flares and the halo at the hit. */
  private readonly glows = new SpriteBatch({ texture: vfxTexture('glow_soft'), additive: true, max: 48, renderOrder: 12 });
  private readonly lights: PointLight[] = [];
  private particles = 1;
  private lightCount = 1;
  private readonly tmp = new Vector3();
  private readonly tmp2 = new Vector3();
  private readonly q = new Quaternion();
  private readonly white = new Color(1, 1, 1);

  constructor() {
    this.object.name = 'mining-beams';
    this.object.add(this.sparks.mesh, this.embers.mesh, this.dust.mesh, this.smoke.mesh, this.glows.mesh);
    // the halos sit on the bitten surface – a rock is not the sphere the hit point assumes, so they
    // must not sink into it (the beam always hits the side facing the camera)
    (this.glows.mesh.material as ShaderMaterial).depthTest = false;
    this.setQuality({ particles: 1, lights: 2 });
  }

  /**
   * Graphics quality: particle counts follow the preset; the point light at the hit (it lights the
   * rock) exists on Medium (one) and High (two) only. The number of lights is fixed between quality
   * changes – adding a light recompiles every lit material.
   */
  setQuality(q: { particles: number; lights: number }): void {
    this.particles = q.particles;
    this.lightCount = q.lights;
    while (this.lights.length > q.lights) this.object.remove(this.lights.pop()!);
    while (this.lights.length < q.lights) {
      const l = new PointLight(0xffffff, 0, 7, 2);
      l.castShadow = false;
      this.lights.push(l);
      this.object.add(l);
    }
  }

  /** Quality from a preset (GameRenderer). */
  applyPreset(p: QualityPreset): void {
    this.setQuality({ particles: p.particles, lights: hitLightsFor(p) });
  }

  /** Shader warm-up: the beam and its decal (hidden, kept for the first beam). */
  warmUp(): void {
    this.slot(0);
  }

  /** Point lights in the scene (tests of the quality setting). */
  get lightsInScene(): number {
    return this.lightCount;
  }

  private slot(i: number): Slot {
    let s = this.slots[i];
    if (s) return s;
    const material = new ShaderMaterial({
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      uniforms: {
        uFrom: { value: new Vector3() },
        uTo: { value: new Vector3() },
        uWidth: { value: 0.3 },
        uExtend: { value: 0 },
        uProfile: { value: vfxTexture('beam') },
        uNoise: { value: vfxTexture('flame_noise') },
        uCore: { value: new Color() },
        uGlow: { value: new Color() },
        uIntensity: { value: 1 },
        uTime: { value: 0 },
        uFlow: { value: 24 },
        uCoreFrac: { value: 0.16 },
        uLen: { value: 1 },
        uOpenEnd: { value: 0 },
      },
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      // the ribbon turns to the camera in the shader – its winding is not known up front
      side: DoubleSide,
      forceSinglePass: true,
    });
    const mesh = new Mesh(this.geometry, material);
    mesh.frustumCulled = false;
    mesh.renderOrder = 12;
    mesh.visible = false;
    const decalMaterial = new MeshBasicMaterial({
      map: vfxTexture('glow_soft'),
      side: DoubleSide,
      forceSinglePass: true,
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      polygonOffset: true,
      polygonOffsetFactor: -2,
    });
    const decal = new Mesh(this.decalGeometry, decalMaterial);
    decal.visible = false;
    decal.renderOrder = 11;
    this.object.add(mesh, decal);
    s = {
      mesh, material, decal, decalMaterial,
      from: new Vector3(), to: new Vector3(), normal: new Vector3(0, 1, 0),
      extend: 0, hit: false, resource: null, bonus: 1, look: beamLook({ bonus: 1, heat: 0, starved: false, heavy: false, time: 0, phase: i }),
      seen: -Infinity, sparks: 0, embers: 0, dust: 0, smoke: 0,
    };
    this.slots[i] = s;
    return s;
  }

  update(f: LaserFrame): void {
    const count = Math.max(f.lasers.length, f.beams.reduce((m, b) => Math.max(m, b.laser + 1), 0));
    const byLaser: (MiningBeam | undefined)[] = [];
    for (const b of f.beams) byLaser[b.laser] = b;
    this.glows.begin();
    const lit: { slot: Slot; weight: number }[] = [];
    for (let i = 0; i < Math.max(count, this.slots.length); i++) {
      const info = f.lasers[i];
      const beam = i < count ? byLaser[i] : undefined;
      if (!beam && !this.slots[i]) {
        if (info?.cooling) this.cooldownSmoke(this.slot(i), i, f);
        continue;
      }
      const s = this.slot(i);
      if (beam) {
        s.seen = f.time;
        if (!f.muzzle?.(i, s.from)) simToWorld(beam.from, BEAM_HEIGHT, s.from);
        const hasEnd = f.end?.(beam, s.to, s.normal);
        if (!hasEnd) {
          simToWorld(beam.to, BEAM_HEIGHT, s.to);
          s.normal.subVectors(s.from, s.to).setY(0).normalize();
        }
        s.hit = beam.asteroidId !== null || beam.wreck !== undefined || beam.mover !== undefined;
        s.resource = beam.resource;
        s.bonus = beam.bonus;
      } else if (f.muzzle?.(i, this.tmp)) {
        // the retracting beam stays attached to the moving muzzle
        s.from.copy(this.tmp);
      }
      // a starved laser sputters towards where it last bit (also between the bursts it can pay)
      const starved = f.starved && f.time - s.seen < 3;
      const on = !!beam || starved;
      s.extend = stepExtend(s.extend, on, f.dt);
      s.look = beamLook({ bonus: beam ? beam.bonus : starved ? 1 : s.bonus, heat: info?.heat ?? 0, starved, heavy: info?.heavy ?? false, time: f.time, phase: i });
      this.drawBeam(s, f);
      if (info?.cooling) this.cooldownSmoke(s, i, f);
      if (s.extend > 0.98 && s.hit && s.look.intensity > 0.05) {
        this.impact(s, beam ? beam.bonus : 1, f);
        lit.push({ slot: s, weight: (beam && beam.bonus > 1 ? 2 : 1) * s.look.intensity });
      } else {
        s.decal.visible = false;
      }
    }
    this.glows.end();
    this.updateLights(lit, f.time);
    for (const p of [this.sparks, this.embers, this.dust, this.smoke]) p.update(f.dt);
  }

  private drawBeam(s: Slot, f: LaserFrame): void {
    const u = s.material.uniforms;
    const visible = s.extend > 0.001 && s.look.intensity > 0.001;
    s.mesh.visible = visible;
    if (!visible) return;
    const look = s.look;
    (u.uFrom!.value as Vector3).copy(s.from);
    (u.uTo!.value as Vector3).copy(s.to);
    u.uWidth!.value = look.glowWidth;
    u.uCoreFrac!.value = look.coreWidth / look.glowWidth;
    u.uExtend!.value = s.extend;
    u.uLen!.value = s.from.distanceTo(s.to);
    u.uOpenEnd!.value = s.hit ? 0 : 1;
    (u.uCore!.value as Color).setRGB(look.core[0], look.core[1], look.core[2]);
    (u.uGlow!.value as Color).setRGB(look.glow[0], look.glow[1], look.glow[2]);
    u.uIntensity!.value = look.intensity;
    u.uTime!.value = f.time;
    u.uFlow!.value = look.flow;
    // muzzle flare: a tight hot glow plus a wider coloured one
    const k = look.intensity * Math.min(1, s.extend * 3);
    this.glows.add(s.from, null, look.glowWidth * 3, look.glowWidth * 3, 0, rgb(look.glow, 0.5), k);
    this.glows.add(s.from, null, look.coreWidth * 9, look.coreWidth * 9, 0, rgb(look.core, 0.4), k);
  }

  private impact(s: Slot, bonus: number, f: LaserFrame): void {
    const look = s.look;
    const k = look.intensity;
    const ore = new Color(s.resource ? RESOURCES[s.resource].color : 0xffc080);
    const spark = rgb(look.spark).lerp(ore.clone().multiplyScalar(2.6), 0.35);
    // molten spot lying on the rock surface (slightly off it so it is not swallowed by the rock)
    const size = (bonus > 1 ? 1.15 : 0.85) * (0.9 + 0.1 * Math.sin(f.time * 17));
    s.decal.visible = true;
    s.decal.position.copy(s.to).addScaledVector(s.normal, 0.06);
    s.decal.quaternion.copy(this.q.setFromUnitVectors(Z, s.normal));
    s.decal.scale.setScalar(size);
    s.decalMaterial.color.setRGB(1.7 * k, 0.72 * k, 0.24 * k);
    // halo at the hit: hot white inside, the beam's colour outside
    const at = this.tmp.copy(s.to).addScaledVector(s.normal, 0.18);
    this.glows.add(at, null, 1.1 * size, 1.1 * size, 0, rgb(look.glow, 0.5), 0.8 * k);
    this.glows.add(at, null, 0.45 * size, 0.45 * size, 0, rgb(look.core, 0.45), k);
    // sparks, embers, chips and dust in the ore colour (fewer on Low)
    const q = this.particles;
    const hot = bonus > 1 ? 2.2 : 1;
    s.sparks += f.dt * 70 * hot * q;
    s.embers += f.dt * 12 * hot * q;
    s.dust += f.dt * (bonus > 1 ? 4.5 : 2.8) * Math.max(0.5, q);
    while (s.sparks >= 1) {
      s.sparks--;
      const d = this.tmp2.set(rand(-1, 1), rand(-1, 1), rand(-1, 1)).normalize().multiplyScalar(0.85).add(s.normal).normalize();
      this.sparks.spawn({ pos: at, vel: d.multiplyScalar(rand(5, 14)), drag: 2.4, life: rand(0.18, 0.45), size: rand(0.45, 0.8), aspect: 0.12, stretch: true, color: spark });
    }
    while (s.embers >= 1) {
      s.embers--;
      const d = this.tmp2.set(rand(-1, 1), rand(-0.2, 1), rand(-1, 1)).normalize().add(s.normal);
      this.embers.spawn({ pos: at, vel: d.multiplyScalar(rand(0.8, 2.6)), drag: 1.1, life: rand(0.5, 1.1), size: rand(0.1, 0.2), color: spark.clone().multiplyScalar(0.8), fadePower: 2 });
    }
    while (s.dust >= 1) {
      s.dust--;
      const rock = new Color(s.resource ? RESOURCES[s.resource].rockColor : 0x777777).lerp(this.white, 0.3);
      const vel = this.tmp2.copy(s.normal).multiplyScalar(rand(0.6, 1.6)).add(new Vector3(rand(-0.4, 0.4), rand(0, 0.3), rand(-0.4, 0.4)));
      this.dust.spawn({ pos: at, vel, drag: 1.4, life: rand(0.5, 0.8), size: rand(0.6, 0.9), sizeEnd: rand(1.4, 2.0), color: rock, alpha: 0.6, frameStart: 0, frameEnd: 15, rotation: Math.random() * 6.3 });
    }
  }

  /** A cooling laser smokes at its muzzle. */
  private cooldownSmoke(s: Slot, i: number, f: LaserFrame): void {
    if (!f.muzzle?.(i, this.tmp)) return;
    s.smoke += f.dt * 7 * Math.max(0.5, this.particles);
    while (s.smoke >= 1) {
      s.smoke--;
      this.smoke.spawn({ pos: this.tmp, vel: new Vector3(rand(-0.3, 0.3), rand(0.4, 0.9), rand(-0.3, 0.3)), drag: 0.6, life: rand(0.7, 1.2), size: rand(0.25, 0.35), sizeEnd: rand(0.8, 1.1), color: new Color(0.42, 0.4, 0.42), alpha: 0.45, rotation: Math.random() * 6.3, spin: rand(-1, 1) });
    }
  }

  /** The point lights go to the brightest hits (bonus first); the rest are dark. */
  private updateLights(lit: { slot: Slot; weight: number }[], time: number): void {
    lit.sort((a, b) => b.weight - a.weight);
    this.lights.forEach((l, i) => {
      const h = lit[i];
      if (!h) {
        l.intensity = 0;
        return;
      }
      const look = h.slot.look;
      l.position.copy(h.slot.to).addScaledVector(h.slot.normal, 0.7);
      l.color.setRGB(Math.min(1, look.glow[0] / 4 + 0.35), Math.min(1, look.glow[1] / 4 + 0.3), Math.min(1, look.glow[2] / 4 + 0.2));
      l.intensity = 7 * look.intensity * (0.85 + 0.15 * Math.sin(time * 31 + i));
    });
  }

  /** Visible beams and live particles (tests). */
  stats(): { beams: number; particles: number; lights: number } {
    return {
      beams: this.slots.filter((s) => s.mesh.visible).length,
      particles: this.sparks.count + this.embers.count + this.dust.count + this.smoke.count,
      lights: this.lights.filter((l) => l.intensity > 0).length,
    };
  }

  /** Releases GPU resources (the renderer is shared between games). */
  dispose(): void {
    this.geometry.dispose();
    this.decalGeometry.dispose();
    for (const s of this.slots) {
      s.material.dispose();
      s.decalMaterial.dispose();
    }
    for (const p of [this.sparks, this.embers, this.dust, this.smoke]) p.dispose();
    this.glows.dispose();
    for (const l of this.lights) l.dispose();
    this.object.clear();
  }
}
