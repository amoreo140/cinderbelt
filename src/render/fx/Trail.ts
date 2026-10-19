// Engine trail (visual polish): a fading ribbon laid flat along the path of a nozzle. Points live in
// world space (the mesh ignores its parents' transform), the newest point follows the nozzle every
// frame, older ones fade out over `life` seconds. Additive, soft edges from beam.png, colour from
// the vertex colours (black = invisible), so one material serves all trails of an owner.
import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  DoubleSide,
  Mesh,
  MeshBasicMaterial,
  type Vector3,
} from 'three';
import { vfxTexture } from './textures';
import { uploadPrefix } from '../uploads';
import { trailFade, trailNeedsPoint, trailSpread } from './trailMath';

export function createTrailMaterial(): MeshBasicMaterial {
  const m = new MeshBasicMaterial({
    map: vfxTexture('beam'),
    vertexColors: true,
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    side: DoubleSide,
    forceSinglePass: true,
  });
  m.userData.noAO = true;
  return m;
}

export class Trail {
  readonly mesh: Mesh;
  private readonly px: Float32Array;
  private readonly py: Float32Array;
  private readonly pz: Float32Array;
  private readonly born: Float32Array;
  private readonly power: Float32Array;
  private count = 0;
  private readonly positions: Float32Array;
  private readonly colors: Float32Array;
  private readonly posAttr: BufferAttribute;
  private readonly colAttr: BufferAttribute;
  private readonly geometry = new BufferGeometry();
  private lastEmit = -Infinity;
  private emitting = false;

  constructor(
    material: MeshBasicMaterial,
    private readonly capacity: number,
    readonly color: Color,
    public width: number,
    public life: number,
  ) {
    this.px = new Float32Array(capacity);
    this.py = new Float32Array(capacity);
    this.pz = new Float32Array(capacity);
    this.born = new Float32Array(capacity);
    this.power = new Float32Array(capacity);
    this.positions = new Float32Array(capacity * 6);
    this.colors = new Float32Array(capacity * 6);
    const uvs = new Float32Array(capacity * 4);
    const index = new Uint16Array(Math.max(0, capacity - 1) * 6);
    for (let i = 0; i < capacity; i++) {
      uvs.set([i / Math.max(1, capacity - 1), 0, i / Math.max(1, capacity - 1), 1], i * 4);
      if (i < capacity - 1) {
        const v = i * 2;
        index.set([v, v + 1, v + 2, v + 1, v + 3, v + 2], i * 6);
      }
    }
    this.posAttr = new BufferAttribute(this.positions, 3);
    this.colAttr = new BufferAttribute(this.colors, 3);
    this.geometry.setAttribute('position', this.posAttr);
    this.geometry.setAttribute('color', this.colAttr);
    this.geometry.setAttribute('uv', new BufferAttribute(uvs, 2));
    this.geometry.setIndex(new BufferAttribute(index, 1));
    this.geometry.setDrawRange(0, 0);
    this.mesh = new Mesh(this.geometry, material);
    this.mesh.frustumCulled = false;
    this.mesh.matrixAutoUpdate = false;
    this.mesh.matrixWorldAutoUpdate = false;
    this.mesh.userData.noAO = true;
    this.mesh.renderOrder = 5;
  }

  private push(x: number, y: number, z: number, now: number, power: number): void {
    if (this.count === this.capacity) {
      this.px.copyWithin(0, 1);
      this.py.copyWithin(0, 1);
      this.pz.copyWithin(0, 1);
      this.born.copyWithin(0, 1);
      this.power.copyWithin(0, 1);
      this.count--;
    }
    const i = this.count++;
    this.px[i] = x;
    this.py[i] = y;
    this.pz[i] = z;
    this.born[i] = now;
    this.power[i] = power;
  }

  /**
   * The nozzle at `pos` with engine output `power` (0..1) at time `now` (s). Call every frame;
   * zero power stops laying the ribbon (the old part fades out).
   */
  emit(pos: Vector3, power: number, now: number): void {
    const on = power > 0.03;
    if (!on) {
      if (this.emitting && this.count > 0) {
        // close the ribbon with an invisible point where the burn ended
        this.push(pos.x, pos.y, pos.z, now, 0);
      }
      this.emitting = false;
      return;
    }
    if (!this.emitting) {
      // a new burn starts with an invisible point – no bridge to the previous ribbon
      this.push(pos.x, pos.y, pos.z, now, 0);
      this.push(pos.x, pos.y, pos.z, now, power);
      this.lastEmit = now;
      this.emitting = true;
      return;
    }
    const last = this.count - 1;
    const prev = this.count - 2;
    const mx = prev >= 0 ? pos.x - this.px[prev]! : 0;
    const mz = prev >= 0 ? pos.z - this.pz[prev]! : 0;
    const moved = prev >= 0 ? Math.sqrt(mx * mx + mz * mz) : Infinity;
    if (trailNeedsPoint(now - this.lastEmit, moved)) {
      this.push(pos.x, pos.y, pos.z, now, power);
      this.lastEmit = now;
    } else {
      // the head follows the nozzle between laid points
      this.px[last] = pos.x;
      this.py[last] = pos.y;
      this.pz[last] = pos.z;
      this.born[last] = now;
      this.power[last] = power;
    }
  }

  /** Rebuilds the ribbon for time `now`. */
  update(now: number): void {
    // drop points that faded out (keep one so the ribbon tail closes)
    let dead = 0;
    while (dead < this.count - 1 && now - this.born[dead + 1]! >= this.life) dead++;
    if (dead > 0) {
      this.px.copyWithin(0, dead);
      this.py.copyWithin(0, dead);
      this.pz.copyWithin(0, dead);
      this.born.copyWithin(0, dead);
      this.power.copyWithin(0, dead);
      this.count -= dead;
    }
    if (this.count === 1 && now - this.born[0]! >= this.life) this.count = 0;
    const n = this.count;
    this.mesh.visible = n >= 2;
    if (n < 2) return;
    const { r, g, b } = this.color;
    for (let i = 0; i < n; i++) {
      const a = Math.max(0, i - 1);
      const c = Math.min(n - 1, i + 1);
      let dx = this.px[c]! - this.px[a]!;
      let dz = this.pz[c]! - this.pz[a]!;
      // not Math.hypot: the variadic builtin allocates per call (issue #10)
      const len = Math.sqrt(dx * dx + dz * dz);
      if (len > 1e-5) {
        dx /= len;
        dz /= len;
      } else {
        dx = 1;
        dz = 0;
      }
      const age = now - this.born[i]!;
      const half = this.width * 0.5 * trailSpread(age, this.life);
      const k = trailFade(age, this.life) * this.power[i]!;
      const x = this.px[i]!;
      const y = this.py[i]!;
      const z = this.pz[i]!;
      // written in place – an array literal per point would allocate every frame
      const o = i * 6;
      const pos = this.positions;
      pos[o] = x - dz * half;
      pos[o + 1] = y;
      pos[o + 2] = z + dx * half;
      pos[o + 3] = x + dz * half;
      pos[o + 4] = y;
      pos[o + 5] = z - dx * half;
      const col = this.colors;
      col[o] = col[o + 3] = r * k;
      col[o + 1] = col[o + 4] = g * k;
      col[o + 2] = col[o + 5] = b * k;
    }
    // two vertices per point; only the live points reach the GPU
    uploadPrefix(this.posAttr, n * 2);
    uploadPrefix(this.colAttr, n * 2);
    this.geometry.setDrawRange(0, (n - 1) * 6);
  }

  clear(): void {
    this.count = 0;
    this.emitting = false;
    this.mesh.visible = false;
  }

  dispose(): void {
    this.geometry.dispose();
    this.mesh.removeFromParent();
  }
}
