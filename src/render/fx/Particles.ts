// Billboards and particles for combat effects. SpriteBatch = one draw call per texture and blending
// mode; a sprite faces the camera, optionally stretched along an axis (sparks, shots)
// and can play a flipbook (explosions, dust). Particles = a simple CPU simulation on top of it.
import {
  AdditiveBlending,
  Color,
  DynamicDrawUsage,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  Mesh,
  NormalBlending,
  PlaneGeometry,
  ShaderMaterial,
  Vector3,
  type Texture,
} from 'three';
import { uploadPrefix } from '../uploads';

export interface BatchOptions {
  texture: Texture;
  additive: boolean;
  /** Flipbook grid (columns × rows), 1 × 1 by default. */
  cols?: number;
  rows?: number;
  max?: number;
  /** Draw order (transparent effects above the ships). */
  renderOrder?: number;
}

const VERTEX = /* glsl */ `
attribute vec3 iCenter;
attribute vec3 iAxis;
attribute vec2 iSize;
attribute float iRotation;
attribute vec4 iColor;
attribute float iFrame;
uniform vec2 uGrid;
varying vec2 vUv;
varying vec4 vColor;
void main() {
  vec4 center = modelViewMatrix * vec4(iCenter, 1.0);
  vec2 dir = vec2(cos(iRotation), sin(iRotation));
  if (dot(iAxis, iAxis) > 1e-8) {
    vec3 a = mat3(modelViewMatrix) * iAxis;
    if (dot(a.xy, a.xy) > 1e-8) dir = normalize(a.xy);
  }
  vec2 side = vec2(-dir.y, dir.x);
  vec2 offset = dir * position.x * iSize.x + side * position.y * iSize.y;
  gl_Position = projectionMatrix * (center + vec4(offset, 0.0, 0.0));
  float frame = floor(iFrame + 0.5);
  float col = mod(frame, uGrid.x);
  float row = floor(frame / uGrid.x);
  vUv = vec2((col + uv.x) / uGrid.x, 1.0 - (row + 1.0 - uv.y) / uGrid.y);
  vColor = iColor;
}`;

const FRAGMENT = /* glsl */ `
uniform sampler2D uMap;
uniform float uAdditive;
varying vec2 vUv;
varying vec4 vColor;
void main() {
  vec4 t = texture2D(uMap, vUv);
  float a = t.a * vColor.a;
  if (a < 0.002) discard;
  vec3 rgb = t.rgb * vColor.rgb;
  gl_FragColor = uAdditive > 0.5 ? vec4(rgb * a, 1.0) : vec4(rgb, a);
}`;

/** Sprites rewritten from scratch every frame (begin → add… → end). */
export class SpriteBatch {
  readonly mesh: Mesh;
  readonly max: number;
  private n = 0;
  private readonly center: InstancedBufferAttribute;
  private readonly axis: InstancedBufferAttribute;
  private readonly size: InstancedBufferAttribute;
  private readonly rotation: InstancedBufferAttribute;
  private readonly color: InstancedBufferAttribute;
  private readonly frame: InstancedBufferAttribute;
  private readonly geometry: InstancedBufferGeometry;
  private readonly material: ShaderMaterial;
  /** The per-instance attributes (end() walks them every frame – no array literal there). */
  private readonly attrs: InstancedBufferAttribute[];

  constructor(options: BatchOptions) {
    this.max = options.max ?? 512;
    const quad = new PlaneGeometry(1, 1);
    this.geometry = new InstancedBufferGeometry();
    this.geometry.index = quad.index;
    this.geometry.setAttribute('position', quad.getAttribute('position'));
    this.geometry.setAttribute('uv', quad.getAttribute('uv'));
    const attr = (size: number) => {
      const a = new InstancedBufferAttribute(new Float32Array(this.max * size), size);
      a.setUsage(DynamicDrawUsage);
      return a;
    };
    this.center = attr(3);
    this.axis = attr(3);
    this.size = attr(2);
    this.rotation = attr(1);
    this.color = attr(4);
    this.frame = attr(1);
    this.geometry.setAttribute('iCenter', this.center);
    this.geometry.setAttribute('iAxis', this.axis);
    this.geometry.setAttribute('iSize', this.size);
    this.geometry.setAttribute('iRotation', this.rotation);
    this.geometry.setAttribute('iColor', this.color);
    this.geometry.setAttribute('iFrame', this.frame);
    this.geometry.instanceCount = 0;
    this.attrs = [this.center, this.axis, this.size, this.rotation, this.color, this.frame];
    this.material = new ShaderMaterial({
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      uniforms: {
        uMap: { value: options.texture },
        uGrid: { value: [options.cols ?? 1, options.rows ?? 1] },
        uAdditive: { value: options.additive ? 1 : 0 },
      },
      transparent: true,
      depthWrite: false,
      blending: options.additive ? AdditiveBlending : NormalBlending,
    });
    this.mesh = new Mesh(this.geometry, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = options.renderOrder ?? 10;
  }

  begin(): void {
    this.n = 0;
  }

  /** Adds a sprite; `axis` = stretch direction in the world (null = by `rotation` on screen). */
  add(center: Vector3, axis: Vector3 | null, width: number, height: number, rotation: number, color: Color, alpha: number, frame = 0): void {
    if (this.n >= this.max) return;
    const i = this.n++;
    this.center.setXYZ(i, center.x, center.y, center.z);
    if (axis) this.axis.setXYZ(i, axis.x, axis.y, axis.z);
    else this.axis.setXYZ(i, 0, 0, 0);
    this.size.setXY(i, width, height);
    this.rotation.setX(i, rotation);
    this.color.setXYZW(i, color.r, color.g, color.b, alpha);
    this.frame.setX(i, frame);
  }

  end(): void {
    this.geometry.instanceCount = this.n;
    // nothing drawn: nothing to upload
    for (const a of this.attrs) uploadPrefix(a, this.n);
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
  }
}

export interface ParticleSpec {
  pos: Vector3;
  vel?: Vector3;
  /** Deceleration (share of the speed per second). */
  drag?: number;
  life: number;
  /** Width at the start and at the end (height = width × aspect). */
  size: number;
  sizeEnd?: number;
  aspect?: number;
  rotation?: number;
  spin?: number;
  /** Colour (can be HDR > 1 – glows through the bloom). */
  color: Color;
  alpha?: number;
  alphaEnd?: number;
  /** Stretch along the velocity (sparks). */
  stretch?: boolean;
  /** Fixed stretch direction in the world (muzzle flash). */
  axis?: Vector3;
  /** Flipbook: the first and the last frame over the lifetime. */
  frameStart?: number;
  frameEnd?: number;
  /** Fade curve: 1 = linear, > 1 = holds the brightness longer. */
  fadePower?: number;
  /** Display delay (s). */
  delay?: number;
}

interface Live {
  pos: Vector3;
  vel: Vector3;
  drag: number;
  life: number;
  size: number;
  sizeEnd: number;
  aspect: number;
  rotation: number;
  spin: number;
  color: Color;
  alpha: number;
  alphaEnd: number;
  axis: Vector3 | null;
  stretch: boolean;
  frameStart: number;
  frameEnd: number;
  fadePower: number;
  age: number;
  /** The record's own axis vector (`axis` points at it when the spec had one). */
  ownAxis?: Vector3;
}

const newLive = (): Live => ({
  pos: new Vector3(),
  vel: new Vector3(),
  drag: 0,
  life: 1,
  size: 1,
  sizeEnd: 1,
  aspect: 1,
  rotation: 0,
  spin: 0,
  color: new Color(),
  alpha: 1,
  alphaEnd: 0,
  axis: null,
  stretch: false,
  frameStart: 0,
  frameEnd: 0,
  fadePower: 1,
  age: 0,
});

/**
 * Particles on top of SpriteBatch – movement, drag, growth, fade, flipbook. Live particles are in a ring
 * buffer (spawn order): a full buffer overwrites the oldest particle in O(1).
 */
export class Particles {
  readonly batch: SpriteBatch;
  private readonly ring: (Live | undefined)[];
  /** Index of the oldest live particle and the count of live ones. */
  private head = 0;
  private size = 0;
  /** Records of dead particles, reused by spawn(). */
  private readonly spare: Live[] = [];

  constructor(options: BatchOptions) {
    this.batch = new SpriteBatch(options);
    this.ring = new Array<Live | undefined>(this.batch.max);
  }

  get mesh(): Mesh {
    return this.batch.mesh;
  }

  get count(): number {
    return this.size;
  }

  spawn(spec: ParticleSpec): void {
    const max = this.ring.length;
    if (max === 0) return;
    let slot: number;
    if (this.size >= max) {
      slot = this.head;
      this.head = (this.head + 1) % max;
    } else {
      slot = (this.head + this.size) % max;
      this.size++;
    }
    // a dead particle's record (and its vectors) is reused – no garbage per spark
    const p = this.ring[slot] ?? this.spare.pop() ?? newLive();
    p.pos.copy(spec.pos);
    if (spec.vel) p.vel.copy(spec.vel);
    else p.vel.set(0, 0, 0);
    p.drag = spec.drag ?? 0;
    p.life = spec.life;
    p.size = spec.size;
    p.sizeEnd = spec.sizeEnd ?? spec.size;
    p.aspect = spec.aspect ?? 1;
    p.rotation = spec.rotation ?? 0;
    p.spin = spec.spin ?? 0;
    p.color.copy(spec.color);
    p.alpha = spec.alpha ?? 1;
    p.alphaEnd = spec.alphaEnd ?? 0;
    if (spec.axis) p.axis = (p.ownAxis ??= new Vector3()).copy(spec.axis);
    else p.axis = null;
    p.stretch = spec.stretch ?? false;
    p.frameStart = spec.frameStart ?? 0;
    p.frameEnd = spec.frameEnd ?? spec.frameStart ?? 0;
    p.fadePower = spec.fadePower ?? 1;
    p.age = -(spec.delay ?? 0);
    this.ring[slot] = p;
  }

  update(dt: number): void {
    // compaction in spawn order: a write never overtakes a read
    const max = this.ring.length;
    let n = 0;
    for (let i = 0; i < this.size; i++) {
      const p = this.ring[(this.head + i) % max]!;
      p.age += dt;
      if (p.age >= p.life) {
        // its record goes back to the pool (a moved live record is never put there)
        if (this.spare.length < max) this.spare.push(p);
        continue;
      }
      if (p.age >= 0) {
        if (p.drag > 0) p.vel.multiplyScalar(Math.max(0, 1 - p.drag * dt));
        p.pos.addScaledVector(p.vel, dt);
        p.rotation += p.spin * dt;
      }
      this.ring[(this.head + n++) % max] = p;
    }
    for (let i = n; i < this.size; i++) this.ring[(this.head + i) % max] = undefined;
    this.size = n;

    const b = this.batch;
    b.begin();
    for (let i = 0; i < this.size; i++) {
      const p = this.ring[(this.head + i) % max]!;
      if (p.age < 0) continue;
      const t = p.age / p.life;
      const size = p.size + (p.sizeEnd - p.size) * t;
      const fade = 1 - Math.pow(t, p.fadePower);
      const alpha = p.alphaEnd + (p.alpha - p.alphaEnd) * fade;
      const axis = p.axis ?? (p.stretch ? p.vel : null);
      b.add(p.pos, axis, size, size * p.aspect, p.rotation, p.color, alpha, p.frameStart + (p.frameEnd - p.frameStart) * t);
    }
    b.end();
  }

  clear(): void {
    this.ring.fill(undefined);
    this.head = 0;
    this.size = 0;
    this.batch.begin();
    this.batch.end();
  }

  dispose(): void {
    this.batch.dispose();
  }
}
