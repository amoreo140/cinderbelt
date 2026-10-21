import { AdditiveBlending, BufferAttribute, BufferGeometry, DoubleSide, Float32BufferAttribute, Mesh, MeshBasicMaterial, Points, PointsMaterial, Uint16BufferAttribute, Vector3 } from 'three';
import { createRng } from '../sim/math/rng';
import { wrapAround } from './wrap';

const AREA = 220;

/** Speed (j/s) where the dust starts to streak, and where the streaks are at full length (M3.8). */
export const STREAK_FROM = 20;
export const STREAK_FULL = 55;
/** Longest streak (world units) and its width. */
const STREAK_MAX = 2.2;
const STREAK_WIDTH = 0.07;

/** Streak length and opacity for a ship speed: nothing when slow, long faint lines when fast. */
export function streakFor(speed: number): { length: number; opacity: number } {
  const t = Math.min(1, Math.max(0, (speed - STREAK_FROM) / (STREAK_FULL - STREAK_FROM)));
  return { length: t * STREAK_MAX, opacity: t * 0.25 };
}

/** Dust in the colour of the default (depth 1) zone look. */
const DUST_DEFAULT = 0x9fb4ff;

/**
 * Dust below the gameplay plane – parallax and a sense of speed while moving; at high speed it
 * streaks into lines (M3.8). Its colour follows the zone look of the player's sector (`setColor`).
 */
export class SpaceDust {
  readonly object: Points;
  /**
   * Streaks of each grain at speed (child of the points – moves and hides with them): thin flat quads
   * on the plane, bright at the grain and fading to nothing (additive, the tail colour is black).
   */
  private readonly streaks: Mesh;
  private readonly base: Float32Array;
  private readonly positions: Float32Array;
  private readonly attribute: BufferAttribute;
  private readonly streakPositions: Float32Array;
  private readonly streakAttribute: BufferAttribute;
  private readonly streakMaterial: MeshBasicMaterial;
  private colorHex = -1;

  constructor(seed: number, private readonly count = 600) {
    const rng = createRng(seed ^ 0x9e3779b9);
    this.base = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      this.base[i * 3] = (rng() - 0.5) * AREA;
      this.base[i * 3 + 1] = -2 - rng() * 40;
      this.base[i * 3 + 2] = (rng() - 0.5) * AREA;
    }
    this.positions = this.base.slice();
    // BufferAttribute keeps the array (Float32BufferAttribute would copy it and the wrap below would
    // never reach the GPU – the dust used to stay around the origin)
    this.attribute = new BufferAttribute(this.positions, 3);
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', this.attribute);
    this.object = new Points(
      geometry,
      new PointsMaterial({ color: DUST_DEFAULT, size: 0.35, transparent: true, opacity: 0.55, depthWrite: false }),
    );
    this.object.frustumCulled = false;

    this.streakPositions = new Float32Array(count * 12);
    this.streakAttribute = new BufferAttribute(this.streakPositions, 3);
    const colors = new Float32Array(count * 12);
    const index = new Uint16Array(count * 6);
    for (let i = 0; i < count; i++) {
      // head (2 vertices) in the dust colour (material colour, setColor), tail (2 vertices) black
      colors.set([1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0], i * 12);
      const v = i * 4;
      index.set([v, v + 1, v + 2, v + 1, v + 3, v + 2], i * 6);
    }
    const streakGeometry = new BufferGeometry();
    streakGeometry.setAttribute('position', this.streakAttribute);
    streakGeometry.setAttribute('color', new Float32BufferAttribute(colors, 3));
    streakGeometry.setIndex(new Uint16BufferAttribute(index, 1));
    this.streakMaterial = new MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0, depthWrite: false, blending: AdditiveBlending, side: DoubleSide, forceSinglePass: true });
    this.streaks = new Mesh(streakGeometry, this.streakMaterial);
    this.setColor(DUST_DEFAULT);
    this.streaks.frustumCulled = false;
    this.streaks.visible = false;
    this.object.add(this.streaks);
  }

  /** Grain colour (sRGB hex) – the zone look's dust, cross-faded by the zone environment. */
  setColor(hex: number): void {
    if (hex === this.colorHex) return;
    this.colorHex = hex;
    (this.object.material as PointsMaterial).color.setHex(hex);
    // the streak heads take the sRGB values as linear (brighter, like the hand-picked heads before)
    this.streakMaterial.color.setRGB((((hex >> 16) & 0xff) / 255) * 0.95, (((hex >> 8) & 0xff) / 255) * 0.95, ((hex & 0xff) / 255) * 0.95);
  }

  /** `velocity` = ship velocity in Three.js coordinates (x, 0, z) – streaks trail behind the motion. */
  update(center: Vector3, velocity?: Vector3): void {
    for (let i = 0; i < this.count; i++) {
      this.positions[i * 3] = wrapAround(this.base[i * 3]!, center.x, AREA);
      this.positions[i * 3 + 2] = wrapAround(this.base[i * 3 + 2]!, center.z, AREA);
    }
    this.attribute.needsUpdate = true;

    const speed = velocity ? Math.hypot(velocity.x, velocity.z) : 0;
    const streak = streakFor(speed);
    this.streaks.visible = streak.opacity > 0.01;
    if (!this.streaks.visible || !velocity) return;
    this.streakMaterial.opacity = streak.opacity;
    // the grain streams backwards past the ship, so its smear reaches forward – to where it was
    const ux = velocity.x / speed;
    const uz = velocity.z / speed;
    const dx = ux * streak.length;
    const dz = uz * streak.length;
    // half width across the motion, on the plane
    const wx = -uz * STREAK_WIDTH * 0.5;
    const wz = ux * STREAK_WIDTH * 0.5;
    for (let i = 0; i < this.count; i++) {
      const x = this.positions[i * 3]!;
      const y = this.positions[i * 3 + 1]!;
      const z = this.positions[i * 3 + 2]!;
      // written in place – an array literal per grain would allocate 600 arrays every frame
      const sp = this.streakPositions;
      const o = i * 12;
      sp[o] = x - wx;
      sp[o + 1] = y;
      sp[o + 2] = z - wz;
      sp[o + 3] = x + wx;
      sp[o + 4] = y;
      sp[o + 5] = z + wz;
      sp[o + 6] = x + dx - wx;
      sp[o + 7] = y;
      sp[o + 8] = z + dz - wz;
      sp[o + 9] = x + dx + wx;
      sp[o + 10] = y;
      sp[o + 11] = z + dz + wz;
    }
    this.streakAttribute.needsUpdate = true;
  }

  /** Frees the GPU resources (the renderer is shared between games). */
  dispose(): void {
    this.object.geometry.dispose();
    (this.object.material as PointsMaterial).dispose();
    this.streaks.geometry.dispose();
    this.streakMaterial.dispose();
  }
}
