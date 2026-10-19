import { Vector3 } from 'three';
import type { Vec2 } from '../sim/math/vec2';

/** Sim plane (x, y) → Three.js (x, height, -y). With rotation.y = sim angle. */
export function simToWorld(p: Vec2, height = 0, out = new Vector3()): Vector3 {
  return out.set(p.x, height, -p.y);
}
