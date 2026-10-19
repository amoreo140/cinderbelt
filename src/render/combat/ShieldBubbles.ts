// Shield bubble (M3a): a flattened ellipsoid around the ship with a hexagonal grid
// (shield_hex.png) and a fresnel. It shows on a hit – the hit spot lights up
// and then the whole bubble fades. The radius matches the sim (SHIELD_MARGIN above the ship's hull).
import { AdditiveBlending, Color, FrontSide, Group, Mesh, ShaderMaterial, SphereGeometry, Vector3, Vector4 } from 'three';
import { vfxTexture } from '../fx/textures';
import type { WarmUpZoo } from '../warmup';

const MAX_HITS = 4;
/** How fast the bubble fades after a hit (1/s) and how fast the hit spot fades. */
const FADE = 2.2;
const HIT_FADE = 3.2;
/** Bubble height as a share of the radius (ships are flat). */
const FLATTEN = 0.42;

const VERTEX = /* glsl */ `
varying vec3 vLocal;
varying vec3 vNormal;
varying vec3 vView;
void main() {
  vLocal = position;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  // normalMatrix = inverse transpose – correct normals for the flattened ellipsoid too
  vNormal = normalize(normalMatrix * normal);
  vView = normalize(-mv.xyz);
  gl_Position = projectionMatrix * mv;
}`;

const FRAGMENT = /* glsl */ `
uniform sampler2D uHex;
uniform vec3 uColor;
uniform float uStrength;
uniform float uTime;
uniform float uRadius;
uniform vec4 uHits[${MAX_HITS}];
varying vec3 vLocal;
varying vec3 vNormal;
varying vec3 vView;
void main() {
  float fres = pow(1.0 - abs(dot(normalize(vNormal), normalize(vView))), 2.2);
  vec3 dir = normalize(vLocal);
  float hit = 0.0;
  for (int i = 0; i < ${MAX_HITS}; i++) {
    float d = distance(dir, uHits[i].xyz);
    hit += uHits[i].w * (exp(-d * d * 6.0) + 0.6 * exp(-pow((d - (1.0 - uHits[i].w) * 0.9) * 9.0, 2.0)));
  }
  vec2 uv = vLocal.xz * uRadius * 0.42 + vec2(0.0, uTime * 0.04);
  float hex = texture2D(uHex, uv).r;
  float pulse = 0.8 + 0.2 * sin(uTime * 9.0 + vLocal.x * 7.0 + vLocal.z * 5.0);
  // the centre of the bubble is almost transparent (the ship stays readable), the rim and the grid glow on a hit
  float rim = smoothstep(0.3, 1.0, fres);
  float glow = uStrength * (0.22 * rim + hex * 0.55 * rim * pulse) + hit * (0.15 + hex * 1.6) * (0.4 + 0.6 * rim);
  gl_FragColor = vec4(uColor * glow, 1.0);
}`;

class Bubble {
  readonly mesh: Mesh;
  readonly material: ShaderMaterial;
  strength = 0;
  readonly hits: Vector4[] = Array.from({ length: MAX_HITS }, () => new Vector4());
  private next = 0;

  constructor(geometry: SphereGeometry) {
    this.material = new ShaderMaterial({
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      uniforms: {
        uHex: { value: vfxTexture('shield_hex') },
        uColor: { value: new Color(0.35, 1.25, 2.1) },
        uStrength: { value: 0 },
        uTime: { value: 0 },
        uRadius: { value: 3 },
        uHits: { value: this.hits },
      },
      transparent: true,
      depthWrite: false,
      side: FrontSide,
      blending: AdditiveBlending,
    });
    this.mesh = new Mesh(geometry, this.material);
    this.mesh.renderOrder = 9;
    this.mesh.visible = false;
  }

  hit(localDir: Vector3): void {
    this.strength = 1;
    const h = this.hits[this.next]!;
    this.next = (this.next + 1) % MAX_HITS;
    h.set(localDir.x, localDir.y, localDir.z, 1);
  }

  update(dt: number, time: number): void {
    this.strength = Math.max(0, this.strength - dt * FADE);
    for (const h of this.hits) h.w = Math.max(0, h.w - dt * HIT_FADE);
    this.material.uniforms.uStrength!.value = this.strength;
    this.material.uniforms.uTime!.value = time;
    this.mesh.visible = this.strength > 0.001 || this.hits.some((h) => h.w > 0.001);
  }
}

/** Ship shield bubbles by reference (player / pirate id). */
export class ShieldBubbles {
  readonly object = new Group();
  private readonly geometry = new SphereGeometry(1, 40, 20);
  private readonly bubbles = new Map<string, Bubble>();
  private readonly tmp = new Vector3();
  private time = 0;

  private bubble(ref: string): Bubble {
    let b = this.bubbles.get(ref);
    if (!b) {
      b = new Bubble(this.geometry);
      this.bubbles.set(ref, b);
      this.object.add(b.mesh);
    }
    return b;
  }

  /** Hit on the shield of ship `ref` at point `world` (Three.js). The bubble must have its current position. */
  hit(ref: string, world: Vector3): void {
    const b = this.bubble(ref);
    const local = b.mesh.worldToLocal(this.tmp.copy(world));
    if (local.lengthSq() < 1e-8) local.set(1, 0, 0);
    b.hit(local.normalize());
  }

  /** Position and size of the bubble (ship centre in Three.js, bubble radius, ship angle). */
  place(ref: string, center: Vector3, radius: number, angle: number): void {
    const b = this.bubble(ref);
    b.mesh.position.copy(center);
    b.mesh.rotation.set(0, angle, 0);
    b.mesh.scale.set(radius, radius * FLATTEN, radius);
    b.mesh.updateMatrixWorld();
    b.material.uniforms.uRadius!.value = radius;
  }

  /** Shader warm-up: one bubble (its own material – never disposed, so its program survives every fight). */
  warmUp(zoo: WarmUpZoo): void {
    zoo.add(new Bubble(this.geometry).mesh);
  }

  /** Bubbles of ships that no longer exist disappear. */
  update(dt: number, alive: ReadonlySet<string>): void {
    this.time += dt;
    for (const [ref, b] of this.bubbles) {
      if (!alive.has(ref)) {
        this.object.remove(b.mesh);
        b.material.dispose();
        this.bubbles.delete(ref);
        continue;
      }
      b.update(dt, this.time);
    }
  }

  has(ref: string): boolean {
    return this.bubbles.has(ref);
  }

  dispose(): void {
    for (const b of this.bubbles.values()) b.material.dispose();
    this.bubbles.clear();
    this.geometry.dispose();
  }
}
